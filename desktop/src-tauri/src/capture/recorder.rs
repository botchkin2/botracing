// The recorder loop, ported from tools/capture/recorder.py: waits for the
// game, records every session to a folder of its own, idles between.
//
// `tick` is one poll and returns how long to sleep before the next. It reads
// only on a new frame (the scoring clock or the player's elapsed time
// changed), so a poll that finds nothing new costs a few small reads.

use crate::capture::frame::{self, View};
use crate::capture::layout::Layout;
use crate::capture::probe::{f64_at, i32_at, text_at, u8_at, Probe};
use crate::capture::sanity::{self, Verdict};
use crate::capture::store::{dir_bytes, iso, write_json, Capture};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(4); // 250 Hz: every 100 Hz telemetry frame
const IDLE: Duration = Duration::from_millis(500);
const NO_GAME: Duration = Duration::from_secs(5);
const GAME_CHECK_MS: u64 = 5_000;
/// No scoring update this long: the session is over. Long enough that a pause
/// or a garage wait with the clock frozen stays in one capture.
const SESSION_GONE_MS: u64 = 10 * 60_000;
/// A refused session is checked again after this, so a glitch while the game
/// loads the field recovers instead of losing the whole session.
const REFUSE_RETRY_MS: u64 = 10_000;
const STATUS_MS: u64 = 30_000;
/// Recount disk use while idle: the uploader prunes old captures.
const RECOUNT_MS: u64 = 5 * 60_000;
/// A frame is suspect when speed changes faster than this between frames
/// (m/s per s, about 20 g) or the car moves further than speed allows.
/// Counted, not dropped: it tells how often reads tear.
const SUSPECT_ACCEL: f64 = 200.0;

/// What the recorder is doing: the same fields as the Python recorder's
/// status.json, for the uploader's heartbeat. `session_dir` is the capture's
/// folder name relative to the root: the heartbeat is served without sign-in,
/// so no user path leaves the PC.
#[derive(Clone, Debug, PartialEq)]
pub struct Status {
    /// no-game | waiting | recording | refused | stopped
    pub state: &'static str,
    pub game_version: Option<i32>,
    pub layout_ok: Option<bool>,
    pub layout_reason: String,
    pub last_chunk_at: Option<String>,
    pub session_dir: Option<String>,
    pub capture_bytes: u64,
    /// Share of the open capture's player frames missed, in percent.
    pub dropped_pct: f64,
}

impl Status {
    pub fn new() -> Status {
        Status {
            state: "no-game",
            game_version: None,
            layout_ok: None,
            layout_reason: String::new(),
            last_chunk_at: None,
            session_dir: None,
            capture_bytes: 0,
            dropped_pct: 0.0,
        }
    }

    fn json(&self, now: u64) -> Value {
        json!({
            "state": self.state,
            "gameVersion": self.game_version,
            "layoutOk": self.layout_ok,
            "layoutReason": self.layout_reason,
            "lastChunkAt": self.last_chunk_at,
            "sessionDir": self.session_dir,
            "captureBytes": self.capture_bytes,
            "droppedPct": self.dropped_pct,
            "pid": std::process::id(),
            "updatedAt": iso(now),
        })
    }
}

pub trait Source {
    type V: View;
    /// The game is up with its shared memory.
    fn game_running(&mut self) -> bool;
    /// Opens the game's mapping read-only; never creates it.
    fn open(&mut self) -> Result<Self::V, String>;
}

pub struct Recorder<S: Source> {
    layout: Layout,
    probe: Probe,
    root: PathBuf,
    source: S,
    chunk_ms: u64,
    view: Option<S::V>,
    capture: Option<Capture>,
    key: Option<(String, i32)>,
    refused_key: Option<(String, i32)>,
    refused_at: u64,
    player_ok: Option<bool>,
    last_scoring_et: Option<f64>,
    last_scoring_ms: u64,
    last_player_et: Option<f64>,
    last_game_check: Option<u64>,
    last_field: Option<(Vec<u8>, Vec<u8>, usize)>,
    /// (elapsed time, speed, position) of the last player frame.
    prev_motion: Option<(f64, f64, [f64; 3])>,
    /// Player frames written and missed in the open capture.
    frames: (u64, u64),
    /// Frames missed before the frame being added (set by `suspect`).
    missed: u64,
    pub status: Status,
    status_written: Option<u64>,
    recounted: Option<u64>,
}

impl<S: Source> Recorder<S> {
    pub fn new(layout: Layout, root: PathBuf, source: S, chunk_ms: u64) -> Result<Self, String> {
        let probe = Probe::new(&layout)?;
        let mut status = Status::new();
        status.capture_bytes = dir_bytes(&root);
        Ok(Recorder {
            layout,
            probe,
            root,
            source,
            chunk_ms,
            view: None,
            capture: None,
            key: None,
            refused_key: None,
            refused_at: 0,
            player_ok: None,
            last_scoring_et: None,
            last_scoring_ms: 0,
            last_player_et: None,
            last_game_check: None,
            last_field: None,
            prev_motion: None,
            frames: (0, 0),
            missed: 0,
            status,
            status_written: None,
            recounted: None,
        })
    }

    // Status ---------------------------------------------------------------

    fn set(&mut self, now: u64, change: impl FnOnce(&mut Status)) {
        let before = self.status.clone();
        change(&mut self.status);
        let due = self
            .status_written
            .map_or(true, |at| now.saturating_sub(at) >= STATUS_MS);
        if before != self.status || due {
            let _ = std::fs::create_dir_all(&self.root);
            let _ = write_json(&self.root.join("status.json"), &self.status.json(now));
            self.status_written = Some(now);
        }
    }

    /// Walks the capture root for its size. Only while no capture is open: the
    /// walk grows with every capture kept, and must not stall recording.
    fn recount(&mut self, now: u64) {
        if self
            .recounted
            .map_or(true, |at| now.saturating_sub(at) >= RECOUNT_MS)
        {
            self.recounted = Some(now);
            self.status.capture_bytes = dir_bytes(&self.root);
        }
    }

    // Captures -------------------------------------------------------------

    fn open_capture(&mut self, now: u64, info: &[u8], key: (String, i32)) {
        let p = &self.probe;
        let mut meta = Map::new();
        meta.insert("track".into(), json!(key.0));
        meta.insert("session".into(), json!(key.1));
        meta.insert("gameVersion".into(), json!(self.status.game_version));
        meta.insert("playerName".into(), json!(text_at(info, p.s_player)));
        meta.insert("serverName".into(), json!(text_at(info, p.s_server)));
        meta.insert("gameMode".into(), json!(u8_at(info, p.s_game_mode)));
        match Capture::new(&self.root, &self.layout, meta, now) {
            Ok(capture) => {
                let dir = capture
                    .dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned());
                self.capture = Some(capture);
                self.key = Some(key);
                self.player_ok = None;
                self.prev_motion = None;
                self.frames = (0, 0);
                self.set(now, |s| {
                    s.dropped_pct = 0.0;
                    s.state = "recording";
                    s.session_dir = dir;
                });
            }
            Err(why) => self.refuse(now, Some(key), &write_reason(&why)),
        }
    }

    fn close_capture(&mut self, now: u64) {
        if let Some(mut capture) = self.capture.take() {
            match capture.close(&self.layout, now) {
                Ok(bytes) => {
                    self.status.capture_bytes += bytes;
                    self.set(now, |s| s.last_chunk_at = Some(iso(now)));
                }
                Err(why) => self.refuse(now, self.key.clone(), &write_reason(&why)),
            }
        }
        self.key = None;
    }

    /// The capture is dropped. A sanity refusal removes its folder; a write
    /// error keeps the chunks already on disk (meta.json then has no endUtc).
    fn refuse(&mut self, now: u64, key: Option<(String, i32)>, reason: &str) {
        self.capture = None;
        self.key = None;
        self.refused_key = key;
        self.refused_at = now;
        let reason = reason.to_string();
        self.set(now, |s| {
            s.state = "refused";
            s.layout_ok = Some(false);
            s.layout_reason = reason;
            s.session_dir = None;
        });
    }

    fn refuse_and_remove(&mut self, now: u64, key: Option<(String, i32)>, reason: &str) {
        if let Some(capture) = self.capture.take() {
            self.status.capture_bytes = self.status.capture_bytes.saturating_sub(capture.bytes);
            let _ = std::fs::remove_dir_all(&capture.dir);
        }
        self.refuse(now, key, reason);
    }

    // The loop -------------------------------------------------------------

    /// One poll. Returns how long to sleep before the next.
    pub fn tick(&mut self, now: u64) -> Duration {
        if self
            .last_game_check
            .map_or(true, |at| now.saturating_sub(at) >= GAME_CHECK_MS)
        {
            self.last_game_check = Some(now);
            if !self.source.game_running() {
                self.close_capture(now);
                self.view = None;
                self.recount(now);
                self.set(now, |s| s.state = "no-game");
                return NO_GAME;
            }
        }
        if self.view.is_none() {
            match self.source.open() {
                Ok(view) => self.view = Some(view),
                Err(why) => {
                    self.set(now, |s| {
                        s.state = "refused";
                        s.layout_ok = Some(false);
                        s.layout_reason = why;
                    });
                    return NO_GAME;
                }
            }
            let version = self.read_game_version();
            self.set(now, |s| s.game_version = version);
        }

        let et = self.scoring_clock();
        if et != self.last_scoring_et {
            self.scoring(now);
        } else if self.capture.is_some()
            && now.saturating_sub(self.last_scoring_ms) > SESSION_GONE_MS
        {
            self.close_capture(now);
            self.set(now, |s| {
                s.state = "waiting";
                s.session_dir = None;
            });
        }

        if self.capture.is_some() {
            self.player(now);
        }
        if let Some(capture) = &self.capture {
            if capture.due(now, self.chunk_ms) {
                let flushed = self.capture.as_mut().map(|c| c.flush(&self.layout, now));
                match flushed {
                    Some(Ok(bytes)) => {
                        self.status.capture_bytes += bytes;
                        self.set(now, |s| s.last_chunk_at = Some(iso(now)));
                    }
                    Some(Err(why)) => {
                        let key = self.key.clone();
                        self.refuse(now, key, &write_reason(&why));
                    }
                    None => {}
                }
            } else {
                self.set(now, |_| {});
            }
            if self.capture.is_some() {
                return POLL;
            }
            return IDLE;
        }
        self.recount(now);
        if self.status.state != "refused" {
            self.set(now, |s| s.state = "waiting");
        } else {
            self.set(now, |_| {});
        }
        IDLE
    }

    /// The tray is quitting: finish the open chunk and mark the capture ended.
    pub fn shutdown(&mut self, now: u64) {
        self.close_capture(now);
        self.view = None;
        self.set(now, |s| {
            if s.state != "refused" {
                s.state = "stopped";
            }
        });
    }

    fn read(&mut self, at: usize, len: usize) -> Option<Vec<u8>> {
        self.view.as_mut()?.read(at, len)
    }

    /// LMU's mInRealtime: true while the player is on track, not at the monitor
    /// or in a replay. Read from the layout, not a fixed offset.
    fn in_realtime(&mut self) -> bool {
        let at = self.layout.offsets["scoringInfo"] + self.layout.in_realtime;
        self.read(at, 1).map_or(false, |b| b[0] != 0)
    }

    fn read_game_version(&mut self) -> Option<i32> {
        let at = self.layout.offsets["gameVersion"];
        Some(i32_at(&self.read(at, 4)?, 0))
    }

    fn scoring_clock(&mut self) -> Option<f64> {
        let at = self.layout.offsets["scoringInfo"] + self.layout.scoring_et;
        Some(f64_at(&self.read(at, 8)?, 0))
    }

    /// The player's slot and elapsed time, or None when not in a car.
    fn player_clock(&mut self) -> Option<f64> {
        let o = &self.layout.offsets;
        let (has_at, idx_at, telem_at) =
            (o["playerHasVehicle"], o["playerVehicleIdx"], o["telemInfo"]);
        if self.read(has_at, 1)?[0] == 0 {
            return None;
        }
        let idx = self.read(idx_at, 1)?[0] as usize;
        if idx >= self.layout.max_vehicles {
            return None;
        }
        let slot = telem_at + idx * self.layout.telem_size + self.layout.telem_et;
        Some(f64_at(&self.read(slot, 8)?, 0))
    }

    fn scoring(&mut self, now: u64) {
        let layout = &self.layout;
        let Some(view) = self.view.as_mut() else {
            return;
        };
        let Some(sample) = frame::scoring(view, layout) else {
            return;
        };
        let (info, vehicles, n, et) = (sample.info, sample.vehicles, sample.count, sample.et);
        let restarted = self.last_scoring_et.is_some_and(|last| et < last - 1.0);
        // Steps of 0.3 to 1 s on the 200 ms scoring clock are updates slept through.
        let skipped = self.last_scoring_et.map_or(0, |last| {
            let step = et - last;
            if step > 0.3 && step < 1.0 {
                ((step / 0.2).round() as u64).saturating_sub(1)
            } else {
                0
            }
        });
        self.last_scoring_et = Some(et);
        self.last_scoring_ms = now;
        if n == 0 {
            return;
        }
        let key = (
            text_at(&info, self.probe.s_track),
            i32_at(&info, self.probe.s_session),
        );
        if self.capture.is_some() && (self.key.as_ref() != Some(&key) || restarted) {
            self.close_capture(now);
        }
        if self.capture.is_none() {
            if self.refused_key.as_ref() == Some(&key)
                && !restarted
                && now.saturating_sub(self.refused_at) < REFUSE_RETRY_MS
            {
                return;
            }
            if let Err(reason) =
                sanity::check_scoring(&self.layout, &self.probe, &info, &vehicles, n)
            {
                self.refuse_and_remove(now, Some(key), &reason);
                return;
            }
            self.refused_key = None;
            self.set(now, |s| {
                s.layout_ok = Some(true);
                s.layout_reason = String::new();
            });
            self.open_capture(now, &info, key);
        }
        let Some(capture) = self.capture.as_mut() else {
            return;
        };
        capture.add_scoring(&info, &vehicles, n, et, now);
        capture.count("scoringUpdates", 1);
        capture.count("missedUpdates", skipped);
        self.last_field = Some((info, vehicles, n));
        self.note_models();
    }

    /// Looks up car models once per new car id, from the telemetry slots.
    fn note_models(&mut self) {
        let Some((_, vehicles, n)) = self.last_field.clone() else {
            return;
        };
        let size = vehicles.len() / n.max(1);
        let ids: Vec<i32> = (0..n)
            .map(|i| i32_at(&vehicles[i * size..], self.probe.v_id))
            .collect();
        let known = |c: &mut Capture| {
            ids.iter()
                .all(|id| c.models().contains_key(&id.to_string()))
        };
        if self.capture.as_mut().map_or(true, known) {
            return;
        }
        let o = &self.layout.offsets;
        let (active_at, telem_at) = (o["activeVehicles"], o["telemInfo"]);
        let Some(active) = self.read(active_at, 1).map(|b| b[0] as usize) else {
            return;
        };
        for i in 0..active.min(self.layout.max_vehicles) {
            let slot = telem_at + i * self.layout.telem_size;
            let Some(raw) = self.read(slot, self.layout.telem_size) else {
                continue;
            };
            let id = i32_at(&raw, self.probe.t_id);
            let model = text_at(&raw, self.probe.t_model).trim().to_string();
            if !model.is_empty() && ids.contains(&id) {
                if let Some(capture) = self.capture.as_mut() {
                    capture.models().insert(id.to_string(), json!(model));
                }
            }
        }
    }

    fn player(&mut self, now: u64) {
        let Some(et) = self.player_clock() else {
            return;
        };
        if Some(et) == self.last_player_et {
            return;
        }
        // Only on track: not at the monitor, not in a replay. playerHasVehicle
        // is checked in frame::player.
        if !self.in_realtime() {
            return;
        }
        let layout = &self.layout;
        let Some(view) = self.view.as_mut() else {
            return;
        };
        let Some(sample) = frame::player(view, layout) else {
            return;
        };
        self.last_player_et = Some(sample.et);
        if self.player_ok.is_none() {
            let Some((info, vehicles, n)) = self.last_field.as_ref() else {
                return;
            };
            match sanity::check_player(&self.probe, info, vehicles, *n, &sample.raw) {
                Verdict::Ok => self.player_ok = Some(true),
                Verdict::Wait => {}
                Verdict::Bad(reason) => {
                    self.player_ok = Some(false);
                    let key = self.key.clone();
                    self.refuse_and_remove(now, key, &reason);
                    return;
                }
            }
        }
        let suspect = self.suspect(&sample.raw);
        let missed = std::mem::take(&mut self.missed);
        self.frames.0 += 1;
        self.frames.1 += missed;
        let pct = 100.0 * self.frames.1 as f64 / (self.frames.0 + self.frames.1) as f64;
        if let Some(capture) = self.capture.as_mut() {
            if suspect {
                capture.note_suspect();
            }
            capture.count("playerFrames", 1);
            capture.count("missedFrames", missed);
            capture.add_player(&sample.raw, now);
        }
        // The menu shows it only past 1%: set on a change of whole percent.
        if pct.floor() != self.status.dropped_pct.floor() {
            self.set(now, |s| s.dropped_pct = pct);
        } else {
            self.status.dropped_pct = pct;
        }
    }

    /// Does this frame break physical continuity with the previous one?
    fn suspect(&mut self, raw: &[u8]) -> bool {
        let p = &self.probe;
        let et = f64_at(raw, p.t_et);
        let v = p.t_vel.map(|at| f64_at(raw, at));
        let speed = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        let pos = p.t_pos.map(|at| f64_at(raw, at));
        let prev = self.prev_motion.replace((et, speed, pos));
        let Some((prev_et, prev_speed, prev_pos)) = prev else {
            return false;
        };
        let dt = et - prev_et;
        // A step over 1.5 periods, under a second, is frames the loop slept
        // through; longer is a pause or a reset.
        if dt > 0.015 && dt < 1.0 {
            self.missed = ((dt / 0.01).round() as u64).saturating_sub(1);
        }
        if !(0.0 < dt && dt < 0.1) {
            return false; // a pause or a reset, not a torn read
        }
        let moved = pos
            .iter()
            .zip(prev_pos.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        (speed - prev_speed).abs() / dt > SUSPECT_ACCEL
            || moved > speed.max(prev_speed) * dt * 2.0 + 1.0
    }
}

/// A disk that is full says so in the status line; anything else says what failed.
fn write_reason(error: &str) -> String {
    if error.contains("os error 112") || error.to_lowercase().contains("no space") {
        "disk full".into()
    } else {
        format!("can't write the capture: {error}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::probe::offset_of;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn layout() -> Layout {
        Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap()
    }

    /// The game's memory, shared with the test so it can change under the recorder.
    #[derive(Clone)]
    struct Mem(Rc<RefCell<Vec<u8>>>);

    impl View for Mem {
        fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
            self.0
                .borrow()
                .get(offset..offset.checked_add(len)?)
                .map(<[u8]>::to_vec)
        }
    }

    struct Fake {
        mem: Mem,
        running: Rc<RefCell<bool>>,
    }

    impl Source for Fake {
        type V = Mem;
        fn game_running(&mut self) -> bool {
            *self.running.borrow()
        }
        fn open(&mut self) -> Result<Mem, String> {
            Ok(self.mem.clone())
        }
    }

    struct Rig {
        lay: Layout,
        mem: Mem,
        running: Rc<RefCell<bool>>,
        root: PathBuf,
    }

    impl Rig {
        fn new(name: &str) -> (Rig, Recorder<Fake>) {
            let lay = layout();
            let mem = Mem(Rc::new(RefCell::new(vec![0; lay.size])));
            let running = Rc::new(RefCell::new(true));
            let root =
                std::env::temp_dir().join(format!("botracing-rec-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            let rec = Recorder::new(
                layout(),
                root.clone(),
                Fake {
                    mem: mem.clone(),
                    running: running.clone(),
                },
                60_000,
            )
            .unwrap();
            (
                Rig {
                    lay,
                    mem,
                    running,
                    root,
                },
                rec,
            )
        }

        fn put(&self, at: usize, bytes: &[u8]) {
            self.mem.0.borrow_mut()[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn scoring(&self, path: &str) -> usize {
            self.lay.offsets["scoringInfo"] + offset_of(&self.lay, "ScoringInfoV01", path).unwrap()
        }

        fn vehicle(&self, i: usize, path: &str) -> usize {
            self.lay.offsets["vehScoringInfo"]
                + i * self.lay.veh_size
                + offset_of(&self.lay, "VehicleScoringInfoV01", path).unwrap()
        }

        fn telem(&self, path: &str) -> usize {
            self.lay.offsets["telemInfo"] + offset_of(&self.lay, "TelemInfoV01", path).unwrap()
        }

        /// A scoring update: one car on `track` in `session`, the clock at `et`.
        fn field(&self, track: &str, session: i32, et: f64) {
            self.put(self.scoring("mTrackName"), track.as_bytes());
            self.put(self.scoring("mTrackName") + track.len(), &[0]);
            self.put(self.scoring("mSession"), &session.to_le_bytes());
            self.put(self.scoring("mInRealtime"), &[1]);
            self.put(self.scoring("mNumVehicles"), &1_i32.to_le_bytes());
            self.put(self.scoring("mCurrentET"), &et.to_le_bytes());
            self.put(self.vehicle(0, "mVehicleName"), b"Car #1\0");
            self.put(self.vehicle(0, "mID"), &7_i32.to_le_bytes());
        }

        /// Whether the player is on track (mInRealtime) in the scoring info.
        fn realtime(&self, on: bool) {
            self.put(self.scoring("mInRealtime"), &[on as u8]);
        }

        /// The player in car 0 at elapsed time `et`, simulated.
        fn player(&self, track: &str, et: f64) {
            self.put(self.lay.offsets["playerHasVehicle"], &[1]);
            self.put(self.lay.offsets["activeVehicles"], &[1]);
            self.put(self.telem("mTrackName"), track.as_bytes());
            self.put(self.telem("mVehicleName"), b"Car #1\0");
            self.put(self.telem("mVehicleModel"), b"GT3 R\0");
            self.put(self.telem("mID"), &7_i32.to_le_bytes());
            self.put(self.telem("mElapsedTime"), &et.to_le_bytes());
            self.put(self.telem("mGear"), &3_i32.to_le_bytes());
            for w in 0..4 {
                for k in 0..3 {
                    self.put(
                        self.telem(&format!("mWheel.{w}.mTemperature.{k}")),
                        &350.0_f64.to_le_bytes(),
                    );
                }
                self.put(
                    self.telem(&format!("mWheel.{w}.mTireCarcassTemperature")),
                    &340.0_f64.to_le_bytes(),
                );
                self.put(
                    self.telem(&format!("mWheel.{w}.mBrakeTemp")),
                    &500.0_f64.to_le_bytes(),
                );
            }
        }

        fn folders(&self) -> Vec<String> {
            let mut dirs: Vec<String> = std::fs::read_dir(&self.root)
                .map(|r| {
                    r.flatten()
                        .filter(|e| e.path().is_dir())
                        .map(|e| e.file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            dirs.sort();
            dirs
        }

        fn meta(&self, folder: &str) -> Value {
            serde_json::from_str(
                &std::fs::read_to_string(self.root.join(folder).join("meta.json")).unwrap(),
            )
            .unwrap()
        }

        fn status_file(&self) -> Value {
            serde_json::from_str(&std::fs::read_to_string(self.root.join("status.json")).unwrap())
                .unwrap()
        }
    }

    #[test]
    fn no_game_means_no_mapping_no_folder_and_a_no_game_status() {
        let (rig, mut rec) = Rig::new("nogame");
        *rig.running.borrow_mut() = false;
        assert_eq!(rec.tick(1_000), NO_GAME);
        assert_eq!(rec.status.state, "no-game");
        assert!(rig.folders().is_empty());
        assert_eq!(rig.status_file()["state"], "no-game");
    }

    #[test]
    fn lmu_menus_and_replays_are_not_recorded_and_driving_again_is_one_folder() {
        let (rig, mut rec) = Rig::new("realtime");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        let rows = |rec: &Recorder<_>| rec.capture.as_ref().unwrap().player_rows();
        let on_track = rows(&rec);
        // At the monitor (menu or replay): not realtime, no row added.
        rig.field("Road Atlanta", 10, 5.2);
        rig.realtime(false);
        rig.player("Road Atlanta", 5.2);
        rec.tick(1_010);
        assert_eq!(rows(&rec), on_track, "no row while not on track");
        rig.field("Road Atlanta", 10, 5.4);
        rig.realtime(true);
        rig.player("Road Atlanta", 5.4);
        rec.tick(1_020);
        assert!(rows(&rec) > on_track, "driving again records again");
        rec.shutdown(5_000);
        let folders = rig.folders();
        assert_eq!(folders.len(), 1, "a pause never splits the session folder");
    }

    #[test]
    fn a_session_is_recorded_into_a_folder_and_closed_with_an_end_time() {
        let (rig, mut rec) = Rig::new("session");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        assert_eq!(rec.tick(1_000), POLL);
        assert_eq!(rec.status.state, "recording");
        rig.field("Road Atlanta", 10, 5.2);
        rig.player("Road Atlanta", 5.01);
        rec.tick(1_010);
        let folders = rig.folders();
        assert_eq!(folders.len(), 1);
        assert!(folders[0].ends_with("_road-atlanta_10"), "{folders:?}");
        assert_eq!(rig.meta(&folders[0])["endUtc"], Value::Null);
        rec.shutdown(5_000);
        let meta = rig.meta(&folders[0]);
        assert!(meta["endUtc"].is_string());
        assert_eq!(meta["chunks"], 1);
        assert_eq!(meta["vehicleModels"]["7"], "GT3 R");
        for file in [
            "player-0000.parquet",
            "field-0000.parquet",
            "session-0000.parquet",
        ] {
            assert!(rig.root.join(&folders[0]).join(file).is_file(), "{file}");
        }
        assert_eq!(rec.status.state, "stopped");
        assert_eq!(rig.status_file()["state"], "stopped");
    }

    #[test]
    fn a_session_change_closes_the_folder_and_opens_a_new_one() {
        let (rig, mut rec) = Rig::new("change");
        rig.field("Road Atlanta", 1, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        rig.field("Road Atlanta", 5, 6.0);
        rec.tick(1_200);
        let folders = rig.folders();
        assert_eq!(folders.len(), 2, "{folders:?}");
        assert!(
            folders[0].ends_with("_1") && folders[1].ends_with("_5"),
            "{folders:?}"
        );
        assert!(rig.meta(&folders[0])["endUtc"].is_string());
        assert_eq!(rig.meta(&folders[1])["endUtc"], Value::Null);
    }

    #[test]
    fn the_game_exiting_ends_the_capture() {
        let (rig, mut rec) = Rig::new("exit");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        *rig.running.borrow_mut() = false;
        assert_eq!(rec.tick(7_000), NO_GAME);
        let folders = rig.folders();
        assert!(rig.meta(&folders[0])["endUtc"].is_string());
        assert_eq!(rec.status.state, "no-game");
    }

    #[test]
    fn a_layout_that_reads_garbage_is_refused_and_leaves_no_folder() {
        let (rig, mut rec) = Rig::new("refuse");
        rig.field("Road Atlanta", 10, 5.0);
        // A control byte where a car name should be.
        rig.put(rig.vehicle(0, "mVehicleName"), &[1, 2, 3, 0]);
        rec.tick(1_000);
        assert_eq!(rec.status.state, "refused");
        assert_eq!(rec.status.layout_ok, Some(false));
        assert!(
            rec.status.layout_reason.contains("car names are not text"),
            "{}",
            rec.status.layout_reason
        );
        assert!(rig.folders().is_empty());
    }

    #[test]
    fn a_disk_that_cannot_be_written_keeps_the_earlier_chunks_and_refuses() {
        let (rig, mut rec) = Rig::new("diskfull");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        // The first chunk is due at 61 s. Its player file name is taken by a
        // folder, so the write fails the way a full disk does.
        let folder = rig.folders().remove(0);
        std::fs::create_dir_all(rig.root.join(&folder).join("player-0000.parquet")).unwrap();
        rig.field("Road Atlanta", 10, 6.0);
        rig.player("Road Atlanta", 5.01);
        rec.tick(62_000);
        assert_eq!(rec.status.state, "refused");
        assert!(
            rec.status.layout_reason.contains("can't write"),
            "{}",
            rec.status.layout_reason
        );
        assert_eq!(rig.meta(&folder)["endUtc"], Value::Null);
    }

    #[test]
    fn a_chunk_is_written_every_chunk_ms_and_the_buffer_starts_again() {
        let (rig, mut rec) = Rig::new("chunks");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        rig.field("Road Atlanta", 10, 6.0);
        rig.player("Road Atlanta", 5.01);
        rec.tick(62_000);
        rig.field("Road Atlanta", 10, 7.0);
        rig.player("Road Atlanta", 5.02);
        rec.tick(100_000);
        rec.shutdown(130_000);
        let folder = rig.folders().remove(0);
        assert_eq!(rig.meta(&folder)["chunks"], 2);
        assert!(rig.root.join(&folder).join("player-0001.parquet").is_file());
        assert!(rec.status.capture_bytes > 0);
    }

    #[test]
    fn a_gap_in_the_player_clock_is_counted_as_missed_frames_and_shown_past_one_percent() {
        let (rig, mut rec) = Rig::new("missed");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.00);
        rec.tick(1_000);
        rig.player("Road Atlanta", 5.01);
        rec.tick(1_010);
        // 40 ms later: three frames were slept through.
        rig.player("Road Atlanta", 5.05);
        rec.tick(1_050);
        // A 5 s jump is a pause, not loss.
        rig.player("Road Atlanta", 10.05);
        rec.tick(1_060);
        rec.shutdown(2_000);
        let folder = rig.folders().remove(0);
        let meta = rig.meta(&folder);
        assert_eq!(meta["missedFrames"], 3);
        assert_eq!(meta["playerFrames"], 4);
        assert_eq!(meta["scoringUpdates"], 1);
        assert_eq!(meta["missedUpdates"], 0);
        // 3 of 7 is 43%.
        assert!(
            rec.status.dropped_pct > 40.0 && rec.status.dropped_pct < 45.0,
            "{}",
            rec.status.dropped_pct
        );
    }

    #[test]
    fn the_same_player_frame_is_not_written_twice() {
        let (rig, mut rec) = Rig::new("dup");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        rec.tick(1_004);
        rec.tick(1_008);
        rig.player("Road Atlanta", 5.01);
        rec.tick(1_012);
        // Two frames, not four ticks.
        assert_eq!(rec.capture.as_ref().unwrap().player_rows(), 2);
    }
}
