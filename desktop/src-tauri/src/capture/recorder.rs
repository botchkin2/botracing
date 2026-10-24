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
use std::sync::Arc;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(4); // 250 Hz: every 100 Hz telemetry frame
const IDLE: Duration = Duration::from_millis(500);
const NO_GAME: Duration = Duration::from_secs(5);
const GAME_CHECK_MS: u64 = 5_000;
/// No scoring update this long: the session is over. Long enough that a pause
/// or a garage wait with the clock frozen stays in one capture.
const SESSION_GONE_MS: u64 = 10 * 60_000;
/// The player's layout is looked at this often (game seconds).
const PLAYER_LOOK_S: f64 = 0.2;

/// A refused session is checked again after this, so a glitch while the game
/// loads the field recovers instead of losing the whole session.
const REFUSE_RETRY_MS: u64 = 10_000;
/// Two polls further apart than this mean the PC slept or the process stalled (an idle poll waits 5 s).
const GAP_MS: u64 = 15_000;
const STATUS_MS: u64 = 30_000;
/// Recount disk use while idle: the uploader prunes old captures.
const RECOUNT_MS: u64 = 5 * 60_000;
/// A frame is suspect when speed changes faster than this between frames
/// (m/s per s, about 20 g) or the car moves further than speed allows.
/// Counted, not dropped: it tells how often reads tear.
const SUSPECT_ACCEL: f64 = 200.0;
/// How long after a line crossing the lap's chunk is cut (seconds, player
/// clock): past the new lap's first frames and the next 5 Hz scoring row.
const LAP_CUT_AFTER_S: f64 = 1.0;

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
    /// When the chunk that ends at the player's last line crossing was on
    /// disk: a finished lap is readable from then (live laps, pit-wall thread 66).
    pub last_lap_at: Option<String>,
    pub session_dir: Option<String>,
    pub capture_bytes: u64,
    /// Share of the open capture's player frames missed, in percent.
    pub dropped_pct: f64,
    /// The last chunk that could not be written (a full disk); None once one is on disk again.
    pub write_error: Option<String>,
}

impl Status {
    pub fn new() -> Status {
        Status {
            state: "no-game",
            game_version: None,
            layout_ok: None,
            layout_reason: String::new(),
            last_chunk_at: None,
            last_lap_at: None,
            session_dir: None,
            capture_bytes: 0,
            dropped_pct: 0.0,
            write_error: None,
        }
    }

    fn json(&self, now: u64) -> Value {
        json!({
            "state": self.state,
            "gameVersion": self.game_version,
            "layoutOk": self.layout_ok,
            "layoutReason": self.layout_reason,
            "lastChunkAt": self.last_chunk_at,
            "lastLapAt": self.last_lap_at,
            "sessionDir": self.session_dir,
            "captureBytes": self.capture_bytes,
            "droppedPct": self.dropped_pct,
            "writeError": self.write_error,
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
    /// Shared with each capture's writer thread.
    layout: Arc<Layout>,
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
    /// What the latest scoring and player layout looks doubted, if anything.
    scoring_doubt: Option<String>,
    player_doubt: Option<String>,
    /// The player's clock at the last layout look (PLAYER_LOOK_S apart).
    last_player_look: Option<f64>,
    last_game_check: Option<u64>,
    last_tick_ms: Option<u64>,
    last_field: Option<(Vec<u8>, Vec<u8>, usize)>,
    /// (elapsed time, speed, position) of the last player frame.
    prev_motion: Option<(f64, f64, [f64; 3])>,
    /// Player frames written and missed in the open capture.
    frames: (u64, u64),
    /// Frames missed before the frame being added (set by `suspect`).
    missed: u64,
    /// The player's lap number in the open capture's last frame.
    last_lap: Option<i32>,
    /// Lap-end chunks handed to the writer and not yet on disk.
    laps_pending: usize,
    /// When (player clock) the chunk that holds the last crossing is cut.
    cut_due: Option<f64>,
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
            layout: Arc::new(layout),
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
            last_player_look: None,
            scoring_doubt: None,
            player_doubt: None,
            last_game_check: None,
            last_tick_ms: None,
            last_field: None,
            prev_motion: None,
            frames: (0, 0),
            missed: 0,
            last_lap: None,
            laps_pending: 0,
            cut_due: None,
            status,
            status_written: None,
            recounted: None,
        })
    }

    // Status ---------------------------------------------------------------

    fn set(&mut self, now: u64, change: impl FnOnce(&mut Status)) {
        let before = self.status.clone();
        change(&mut self.status);
        let due = self.status_written.map_or(true, |at| now.saturating_sub(at) >= STATUS_MS);
        if before != self.status || due {
            let _ = std::fs::create_dir_all(&self.root);
            let _ = write_json(&self.root.join("status.json"), &self.status.json(now));
            self.status_written = Some(now);
        }
    }

    /// Walks the capture root for its size. Only while no capture is open: the
    /// walk grows with every capture kept, and must not stall recording.
    fn recount(&mut self, now: u64) {
        if self.recounted.map_or(true, |at| now.saturating_sub(at) >= RECOUNT_MS) {
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
                let dir = capture.dir.file_name().map(|n| n.to_string_lossy().into_owned());
                self.capture = Some(capture);
                self.key = Some(key);
                // A new capture starts its own lap count: no cut on its first frame.
                self.last_lap = None;
                self.laps_pending = 0;
                self.cut_due = None;
                self.player_ok = None;
                self.last_player_look = None;
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
            match capture.close(now) {
                Ok(bytes) => {
                    self.status.capture_bytes += bytes;
                    self.set(now, |s| s.last_chunk_at = Some(iso(now)));
                }
                Err(why) => {
                    let reason = write_reason(&why);
                    self.set(now, |s| s.write_error = Some(reason));
                }
            }
        }
        self.key = None;
    }

    /// Status shows the latest looks: ok when neither doubts.
    fn show_layout(&mut self, now: u64) {
        let reason = self.scoring_doubt.clone().or_else(|| self.player_doubt.clone());
        self.set(now, |s| {
            s.layout_ok = Some(reason.is_none());
            s.layout_reason = reason.unwrap_or_default();
        });
    }

    /// The capture is dropped on a write error (a full disk): the chunks already
    /// on disk stay (meta.json then has no endUtc). A layout that looks wrong is
    /// not a refusal: it is recorded and marked (`layoutSuspect`).
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

    // The loop -------------------------------------------------------------

    /// One poll. Returns how long to sleep before the next.
    pub fn tick(&mut self, now: u64) -> Duration {
        // A long gap between two polls: the PC slept or the process stalled. Counted in the capture.
        if let (Some(last), Some(capture)) = (self.last_tick_ms.replace(now), self.capture.as_mut()) {
            if now.saturating_sub(last) > GAP_MS {
                capture.note_gap(now - last);
            }
        }
        if self.last_game_check.map_or(true, |at| now.saturating_sub(at) >= GAME_CHECK_MS) {
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
        if let Some(capture) = self.capture.as_mut() {
            // A due chunk goes to the writer thread; either way, what the writer
            // finished since the last poll is counted (store.rs ChunkWriter).
            let written = if capture.due(now, self.chunk_ms) {
                capture.flush(now)
            } else {
                capture.written()
            };
            self.chunks_written(now, written);
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
        let (has_at, idx_at, telem_at) = (o["playerHasVehicle"], o["playerVehicleIdx"], o["telemInfo"]);
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
        let Some(view) = self.view.as_mut() else { return };
        let Some(sample) = frame::scoring(view, layout) else { return };
        let (info, vehicles, n, et) = (sample.info, sample.vehicles, sample.count, sample.et);
        let restarted = self.last_scoring_et.is_some_and(|last| et < last - 1.0);
        // Steps of 0.3 to 1 s on the 200 ms scoring clock are updates slept through.
        let skipped = self.last_scoring_et.map_or(0, |last| {
            let step = et - last;
            if step > 0.3 && step < 1.0 { ((step / 0.2).round() as u64).saturating_sub(1) } else { 0 }
        });
        self.last_scoring_et = Some(et);
        self.last_scoring_ms = now;
        if n == 0 {
            return;
        }
        let key = (text_at(&info, self.probe.s_track), i32_at(&info, self.probe.s_session));
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
            self.refused_key = None;
            self.open_capture(now, &info, key);
        }
        // A layout that looks wrong is recorded and counted, never dropped: each
        // scoring update is one look, and the tray decides from the data
        // (pit wall thread 95).
        let doubt = sanity::check_scoring(&self.layout, &self.probe, &info, &vehicles, n).err();
        self.scoring_doubt = doubt.clone();
        self.show_layout(now);
        if let Some(capture) = self.capture.as_mut() {
            capture.note_layout_check(doubt.as_deref());
        }
        let Some(capture) = self.capture.as_mut() else { return };
        capture.add_scoring(&info, &vehicles, n, et, now);
        capture.count("scoringUpdates", 1);
        capture.count("missedUpdates", skipped);
        self.last_field = Some((info, vehicles, n));
        self.note_models();
    }

    /// Looks up car models once per new car id, from the telemetry slots.
    fn note_models(&mut self) {
        let Some((_, vehicles, n)) = self.last_field.clone() else { return };
        let size = vehicles.len() / n.max(1);
        let ids: Vec<i32> = (0..n)
            .map(|i| i32_at(&vehicles[i * size..], self.probe.v_id))
            .collect();
        let known = |c: &mut Capture| ids.iter().all(|id| c.models().contains_key(&id.to_string()));
        if self.capture.as_mut().map_or(true, known) {
            return;
        }
        let o = &self.layout.offsets;
        let (active_at, telem_at) = (o["activeVehicles"], o["telemInfo"]);
        let Some(active) = self.read(active_at, 1).map(|b| b[0] as usize) else { return };
        for i in 0..active.min(self.layout.max_vehicles) {
            let slot = telem_at + i * self.layout.telem_size;
            let Some(raw) = self.read(slot, self.layout.telem_size) else { continue };
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
        let Some(et) = self.player_clock() else { return };
        if Some(et) == self.last_player_et {
            return;
        }
        // Only on track: not at the monitor, not in a replay. playerHasVehicle
        // is checked in frame::player.
        if !self.in_realtime() {
            return;
        }
        let layout = &self.layout;
        let Some(view) = self.view.as_mut() else { return };
        let Some(sample) = frame::player(view, layout) else { return };
        self.last_player_et = Some(sample.et);
        // The player's layout is looked at every PLAYER_LOOK_S of the game clock
        // and counted, never decisive (see Capture::note_player_check).
        if self.player_ok.is_none() && self.last_field.is_none() {
            return;
        }
        let look_due = self
            .last_player_look
            .map_or(true, |t| sample.et < t || sample.et - t >= PLAYER_LOOK_S);
        if look_due {
            if let Some((info, vehicles, n)) = self.last_field.as_ref() {
                let verdict = sanity::check_player(&self.probe, info, vehicles, *n, &sample.raw);
                if !matches!(verdict, Verdict::Wait) {
                    self.last_player_look = Some(sample.et);
                    let doubt = match verdict {
                        Verdict::Bad(reason) => Some(reason),
                        _ => None,
                    };
                    self.player_ok = Some(doubt.is_none());
                    if let Some(capture) = self.capture.as_mut() {
                        capture.note_player_check(doubt.as_deref());
                    }
                    self.player_doubt = doubt;
                    self.show_layout(now);
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
            // The player crossed the line: a chunk is cut LAP_CUT_AFTER_S later,
            // so the lap that ended is on disk within a write instead of up to
            // a minute later. Not at the crossing itself: the new lap's first
            // frames (its mLapNumber and mLapStartET) and the scoring row with
            // the game's lap time are what mark the lap finished
            // (lmuCapture.mjs); a cut before them leaves it unfinished until
            // the next chunk, a whole lap late (live e2e, thread 66).
            let lap = i32_at(&sample.raw, self.probe.t_lap);
            if self.last_lap.is_some_and(|prev| prev != lap) {
                self.cut_due = Some(sample.et + LAP_CUT_AFTER_S);
            }
            self.last_lap = Some(lap);
            let cut = if self.cut_due.is_some_and(|due| sample.et >= due) {
                self.cut_due = None;
                let written = capture.flush(now);
                if written.is_ok() {
                    self.laps_pending += 1;
                }
                Some(written)
            } else {
                None
            };
            if let Some(capture) = self.capture.as_mut() {
                capture.count("playerFrames", 1);
                capture.count("missedFrames", missed);
                capture.add_player(&sample.raw, now);
            }
            if let Some(written) = cut {
                self.chunks_written(now, written);
            }
        }
        // The menu shows it only past 1%: set on a change of whole percent.
        if pct.floor() != self.status.dropped_pct.floor() {
            self.set(now, |s| s.dropped_pct = pct);
        } else {
            self.status.dropped_pct = pct;
        }
    }

    /// What the writer finished: bytes counted, lastChunkAt (and lastLapAt
    /// once a lap-end chunk is among them) set, or the capture refused.
    fn chunks_written(&mut self, now: u64, written: Result<u64, String>) {
        match written {
            // lastChunkAt: when a chunk is on disk, not when it was cut.
            Ok(bytes) if bytes > 0 => {
                self.status.capture_bytes += bytes;
                self.status.write_error = None;
                // The writer finishes chunks in order: a lap-end chunk handed
                // over before this poll is on disk once anything is.
                let lap = std::mem::take(&mut self.laps_pending) > 0;
                self.set(now, |s| {
                    s.last_chunk_at = Some(iso(now));
                    if lap {
                        s.last_lap_at = Some(iso(now));
                    }
                });
            }
            Ok(_) => self.set(now, |_| {}),
            // A chunk that cannot be written costs that chunk, not the drive: the capture keeps recording,
            // counts the loss, and the next chunk tries the disk again.
            Err(why) => {
                let reason = write_reason(&why);
                if let Some(capture) = self.capture.as_mut() {
                    capture.note_write_failure(&reason);
                }
                self.set(now, |s| s.write_error = Some(reason));
            }
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
        let Some((prev_et, prev_speed, prev_pos)) = prev else { return false };
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
            self.0.borrow().get(offset..offset.checked_add(len)?).map(<[u8]>::to_vec)
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
            let root = std::env::temp_dir().join(format!("botracing-rec-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            let rec = Recorder::new(
                layout(),
                root.clone(),
                Fake { mem: mem.clone(), running: running.clone() },
                60_000,
            )
            .unwrap();
            (Rig { lay, mem, running, root }, rec)
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
                    self.put(self.telem(&format!("mWheel.{w}.mTemperature.{k}")), &350.0_f64.to_le_bytes());
                }
                self.put(self.telem(&format!("mWheel.{w}.mTireCarcassTemperature")), &340.0_f64.to_le_bytes());
                self.put(self.telem(&format!("mWheel.{w}.mBrakeTemp")), &500.0_f64.to_le_bytes());
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
            serde_json::from_str(&std::fs::read_to_string(self.root.join(folder).join("meta.json")).unwrap())
                .unwrap()
        }

        fn status_file(&self) -> Value {
            serde_json::from_str(&std::fs::read_to_string(self.root.join("status.json")).unwrap()).unwrap()
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
        for file in ["player-0000.parquet", "field-0000.parquet", "session-0000.parquet"] {
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
        assert!(folders[0].ends_with("_1") && folders[1].ends_with("_5"), "{folders:?}");
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
    fn a_layout_that_reads_garbage_is_recorded_and_marked_never_dropped() {
        let (rig, mut rec) = Rig::new("refuse");
        rig.field("Road Atlanta", 10, 5.0);
        // A control byte where a car name should be.
        rig.put(rig.vehicle(0, "mVehicleName"), &[1, 2, 3, 0]);
        rec.tick(1_000);
        assert_eq!(rec.status.state, "recording");
        assert_eq!(rec.status.layout_ok, Some(false));
        assert!(rec.status.layout_reason.contains("car names are not text"), "{}", rec.status.layout_reason);
        let folders = rig.folders();
        assert_eq!(folders.len(), 1);
        assert!(rig.meta(&folders[0])["layoutSuspect"].as_str().unwrap().contains("not text"));
    }

    /// A field of `n` named cars, car i's lap distance `dist(i)`.
    fn field_with_dists(rig: &Rig, n: usize, dist: impl Fn(usize) -> f64) {
        field_with_dists_at(rig, n, 5.0, dist);
    }

    fn field_with_dists_at(rig: &Rig, n: usize, et: f64, dist: impl Fn(usize) -> f64) {
        rig.field("Sebring International Raceway", 10, et);
        assert!(n <= rig.lay.max_vehicles, "{} slots", rig.lay.max_vehicles);
        rig.put(rig.scoring("mNumVehicles"), &(n as i32).to_le_bytes());
        for i in 0..n {
            rig.put(rig.vehicle(i, "mVehicleName"), format!("Car #{i} ").as_bytes());
            rig.put(rig.vehicle(i, "mID"), &(if i == 0 { 7 } else { 100 + i as i32 }).to_le_bytes());
            rig.put(rig.vehicle(i, "mLapDist"), &dist(i).to_le_bytes());
        }
    }

    #[test]
    fn one_car_in_a_long_pit_lane_does_not_refuse_the_field() {
        // Sebring, 2026-10-19: cars at -1079 to -1664 m were refused as garbage.
        let (rig, mut rec) = Rig::new("pitdist1");
        field_with_dists(&rig, 8, |i| if i == 0 { -1664.85 } else { 100.0 * i as f64 });
        rig.player("Sebring International Raceway", 5.0);
        rec.tick(1_000);
        assert_eq!(rec.status.state, "recording", "{}", rec.status.layout_reason);
        assert_eq!(rig.folders().len(), 1);
    }

    #[test]
    fn two_of_eight_cars_out_of_range_still_records() {
        let (rig, mut rec) = Rig::new("pitdist2");
        field_with_dists(&rig, 8, |i| if i < 2 { -5.0e9 } else { 100.0 * i as f64 });
        rig.player("Sebring International Raceway", 5.0);
        rec.tick(1_000);
        assert_eq!(rec.status.state, "recording", "{}", rec.status.layout_reason);
    }

    #[test]
    fn a_wrong_layout_garbles_every_lap_distance_and_is_marked_not_dropped() {
        let (rig, mut rec) = Rig::new("pitdistall");
        field_with_dists(&rig, 8, |_| -5.0e9);
        rec.tick(1_000);
        assert_eq!(rec.status.state, "recording");
        assert_eq!(rec.status.layout_ok, Some(false));
        assert!(rec.status.layout_reason.contains("lap distance"), "{}", rec.status.layout_reason);
        let folders = rig.folders();
        assert_eq!(folders.len(), 1);
        assert!(rig.meta(&folders[0]).get("layoutSuspect").is_some());
    }

    #[test]
    fn one_doubtful_beat_is_counted_not_condemned() {
        let (rig, mut rec) = Rig::new("onebeat");
        field_with_dists(&rig, 8, |i| 100.0 * i as f64);
        rig.player("Sebring International Raceway", 5.0);
        rec.tick(1_000);
        // One beat reads garbage in every car, then it is fine again.
        field_with_dists_at(&rig, 8, 5.2, |_| -5.0e9);
        rec.tick(1_200);
        field_with_dists_at(&rig, 8, 5.4, |i| 100.0 * i as f64);
        rec.tick(1_400);
        rec.shutdown(2_000);
        let meta = rig.meta(&rig.folders()[0]);
        assert_eq!(meta["layoutChecks"], 3);
        assert_eq!(meta["layoutDoubtful"], 1);
        assert!(meta["layoutSuspect"].as_str().unwrap().contains("lap distance"));
        assert_eq!(rec.status.layout_ok, Some(true), "the latest look was fine");
    }

    #[test]
    fn counts_reach_the_disk_with_each_chunk_not_only_at_close() {
        // Session load: the first look doubts, then 59 are fine. After the next
        // chunk flush, with no close, meta.json says 1 of 60 (gauge #6571).
        let (rig, mut rec) = Rig::new("counts");
        field_with_dists_at(&rig, 8, 5.0, |_| -5.0e9);
        rig.player("Sebring International Raceway", 5.0);
        rec.tick(1_000);
        for k in 1..60 {
            field_with_dists_at(&rig, 8, 5.0 + 0.2 * k as f64, |i| 100.0 * i as f64);
            rig.player("Sebring International Raceway", 5.0 + 0.2 * k as f64);
            rec.tick(1_000 + 200 * k as u64);
        }
        field_with_dists_at(&rig, 8, 20.0, |i| 100.0 * i as f64);
        rig.player("Sebring International Raceway", 20.0);
        rec.tick(62_000);
        // The chunk is written on the writer thread: wait for its meta.json.
        let mut meta = rig.meta(&rig.folders()[0]);
        for i in 0..2_000 {
            if meta["layoutChecks"].as_u64().unwrap_or(0) >= 60 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            rec.tick(62_001 + i);
            meta = rig.meta(&rig.folders()[0]);
        }
        assert!(meta["endUtc"].is_null(), "not closed");
        assert_eq!(meta["layoutDoubtful"], 1);
        assert!(meta["layoutChecks"].as_u64().unwrap() >= 60, "{}", meta["layoutChecks"]);
    }

    #[test]
    fn one_transient_player_look_is_counted_not_condemned() {
        let (rig, mut rec) = Rig::new("playerlook");
        field_with_dists(&rig, 8, |i| 100.0 * i as f64);
        rig.player("Sebring International Raceway", 5.0);
        rec.tick(1_000);
        // The telemetry's car name reads wrong for one look (names still filling).
        field_with_dists_at(&rig, 8, 5.4, |i| 100.0 * i as f64);
        rig.player("Sebring International Raceway", 5.4);
        rig.put(rig.telem("mVehicleName"), b"Nobody ");
        rec.tick(1_400);
        rig.put(rig.telem("mVehicleName"), b"Car #1 ");
        field_with_dists_at(&rig, 8, 5.8, |i| 100.0 * i as f64);
        rig.player("Sebring International Raceway", 5.8);
        rec.tick(1_800);
        rec.shutdown(2_000);
        let meta = rig.meta(&rig.folders()[0]);
        assert_eq!(meta["playerDoubtful"], 1);
        assert!(meta["playerChecks"].as_u64().unwrap() >= 3);
        assert_eq!(rec.status.layout_ok, Some(true), "the latest looks were fine");
    }

    #[test]
    fn nordschleife_and_le_mans_scale_numbers_are_not_doubted() {
        // A 25.4 km lap, 24 h in (86 400 s on the clock): every check passes.
        let (rig, mut rec) = Rig::new("scale");
        field_with_dists_at(&rig, 8, 86_400.0, |i| 25_400.0 * (i as f64 + 1.0) / 9.0);
        rig.player("Sebring International Raceway", 86_400.0); // the helper names the track; the numbers are Nordschleife-scale
        rec.tick(1_000);
        assert_eq!(rec.status.layout_ok, Some(true), "{}", rec.status.layout_reason);
        assert!(rig.meta(&rig.folders()[0]).get("layoutSuspect").is_none());
    }

    #[test]
    fn a_good_layout_is_not_marked() {
        let (rig, mut rec) = Rig::new("pitdistgood");
        field_with_dists(&rig, 8, |i| 100.0 * i as f64);
        rig.player("Sebring International Raceway", 5.0);
        rec.tick(1_000);
        assert_eq!(rec.status.layout_ok, Some(true));
        assert!(rig.meta(&rig.folders()[0]).get("layoutSuspect").is_none());
    }

    #[test]
    fn a_chunk_the_disk_refuses_costs_that_chunk_not_the_drive() {
        let (rig, mut rec) = Rig::new("diskfull");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        // The first chunk is due at 61 s. Its player file name is taken by a
        // folder, so the write fails the way a full disk does.
        let folder = rig.folders().remove(0);
        let blocker = rig.root.join(&folder).join("player-0000.parquet");
        std::fs::create_dir_all(&blocker).unwrap();
        rig.field("Road Atlanta", 10, 6.0);
        rig.player("Road Atlanta", 5.01);
        rec.tick(62_000);
        // The chunk is written on the writer thread: its failure reaches the
        // recorder on a later poll, not a rotation later.
        for i in 0..2_000 {
            if rec.status.write_error.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            rec.tick(62_001 + i);
        }
        // The drive goes on: still recording, the loss is stated, not a refusal.
        assert_eq!(rec.status.state, "recording");
        assert!(rec.status.write_error.as_ref().unwrap().contains("can't write"), "{:?}", rec.status.write_error);
        assert_eq!(rec.status.layout_ok, Some(true), "a full disk is not a layout fault");
        let _ = std::fs::copy(rig.root.join("status.json"), rig.root.join("status-at-write-failure.json"));
        // The disk comes back: the next chunk is written, the status clears, meta counts what was lost.
        std::fs::remove_dir_all(&blocker).unwrap();
        rig.field("Road Atlanta", 10, 7.0);
        rig.player("Road Atlanta", 5.02);
        rec.tick(130_000);
        let mut meta = rig.meta(&folder);
        for i in 0..2_000 {
            if rec.status.write_error.is_none() && meta["chunks"].as_u64().unwrap_or(0) >= 2 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            rec.tick(130_001 + i);
            meta = rig.meta(&folder);
        }
        assert_eq!(rec.status.write_error, None, "cleared once a chunk is on disk");
        assert!(rig.root.join(&folder).join("player-0001.parquet").exists(), "the next chunk reached the disk");
        assert_eq!(meta["writeFailures"], 1);
        assert!(meta["lastWriteError"].as_str().unwrap().contains("can't write"));
    }

    #[test]
    fn rows_a_capture_still_holds_when_it_is_dropped_reach_the_disk() {
        // The recorder refused it, or panicked and unwound: the last chunk's rows are written, not lost.
        let (rig, mut rec) = Rig::new("dropflush");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        let folder = rig.folders().remove(0);
        assert!(!rig.root.join(&folder).join("player-0000.parquet").exists(), "nothing is due yet");
        drop(rec);
        assert!(rig.root.join(&folder).join("player-0000.parquet").exists(), "the held rows were handed to the writer on drop");
    }

    #[test]
    fn a_long_gap_between_polls_is_counted_in_the_capture() {
        let (rig, mut rec) = Rig::new("gap");
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.0);
        rec.tick(1_000);
        rig.field("Road Atlanta", 10, 5.2);
        rig.player("Road Atlanta", 5.2);
        rec.tick(1_200); // a normal poll
        rig.field("Road Atlanta", 10, 600.0);
        rig.player("Road Atlanta", 600.0);
        rec.tick(601_000); // ten minutes later: the PC slept
        rec.shutdown(602_000);
        let meta = rig.meta(&rig.folders()[0]);
        assert_eq!(meta["gaps"], 1);
        assert!(meta["longestGapMs"].as_u64().unwrap() >= 599_000, "{}", meta["longestGapMs"]);
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
    fn a_line_crossing_cuts_the_lap_into_its_own_chunk_and_says_when_it_is_on_disk() {
        let (rig, mut rec) = Rig::new("lapcut");
        let lap = |n: i32| rig.put(rig.telem("mLapNumber"), &n.to_le_bytes());
        rig.field("Road Atlanta", 10, 5.0);
        lap(3);
        rig.player("Road Atlanta", 5.00);
        rec.tick(1_000);
        rig.player("Road Atlanta", 5.01);
        rec.tick(1_010);
        assert_eq!(rec.status.last_lap_at, None);
        // The line: lap 4 begins. Its first frame opens the next chunk, long
        // before the 60 s rotation.
        lap(4);
        rig.player("Road Atlanta", 5.02);
        rec.tick(1_020);
        // Not at the crossing: a second later, so the chunk holds the new
        // lap's first frames and the lap time.
        rig.player("Road Atlanta", 5.50);
        rec.tick(1_500);
        assert_eq!(rec.status.last_lap_at, None);
        rig.player("Road Atlanta", 6.03);
        rec.tick(2_030);
        // The lap-end chunk is written on the writer thread: polled up to 10 s,
        // measured, and held to 3 s (apex #5447), so a slow write fails with
        // its time rather than as a flake.
        let waited = std::time::Instant::now();
        for i in 0..2_000 {
            if rec.status.last_lap_at.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            rec.tick(2_031 + i);
        }
        let ms = waited.elapsed().as_millis();
        eprintln!("lap-end chunk on disk after {ms} ms");
        assert!(rec.status.last_lap_at.is_some(), "the lap-end chunk never reached the disk ({ms} ms)");
        // A live lap reaches the app 5-30 s after the line; the chunk's write
        // must be a small part of that.
        assert!(ms < 3_000, "the lap-end chunk took {ms} ms to reach the disk");
        let folder = rig.folders().remove(0);
        assert!(rig.root.join(&folder).join("player-0000.parquet").is_file());
        assert_eq!(rig.status_file()["lastLapAt"], rec.status.last_lap_at.clone().unwrap());
        rec.shutdown(5_000);
        // Two chunks: the lap that ended plus a second of the next (4 frames),
        // then the rest.
        assert_eq!(rig.meta(&folder)["chunks"], 2);
        assert_eq!(rig.meta(&folder)["playerFrames"], 5);
    }

    #[test]
    fn the_first_frame_of_a_capture_is_not_a_crossing() {
        let (rig, mut rec) = Rig::new("lapfirst");
        rig.put(rig.telem("mLapNumber"), &7_i32.to_le_bytes());
        rig.field("Road Atlanta", 10, 5.0);
        rig.player("Road Atlanta", 5.00);
        rec.tick(1_000);
        rig.player("Road Atlanta", 5.01);
        rec.tick(1_010);
        rec.shutdown(2_000);
        let folder = rig.folders().remove(0);
        assert_eq!(rig.meta(&folder)["chunks"], 1);
        assert_eq!(rec.status.last_lap_at, None);
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
        assert!(rec.status.dropped_pct > 40.0 && rec.status.dropped_pct < 45.0, "{}", rec.status.dropped_pct);
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

    #[test]
    fn every_status_the_recorder_writes_makes_a_beat_the_server_takes() {
        // Each state as the recorder sets it, with the values LMU really gave:
        // 14200 and 0 (contract/payloads/capture-meta, #597).
        let at = Some(iso(1_790_000_000_000));
        let mut recording = Status::new();
        recording.state = "recording";
        recording.game_version = Some(14200);
        recording.layout_ok = Some(true);
        recording.last_chunk_at = at.clone();
        recording.last_lap_at = at.clone();
        recording.session_dir = Some("2026-10-13T00-15-00Z_track_10".into());
        recording.capture_bytes = 1_105_883_643;
        recording.dropped_pct = 0.37;
        let mut waiting = recording.clone();
        waiting.state = "waiting";
        waiting.game_version = Some(0);
        waiting.session_dir = None;
        let mut refused = Status::new();
        refused.state = "refused";
        refused.layout_ok = Some(false);
        refused.layout_reason = write_reason(&format!(
            r"C:\Users\Jane Doe\AppData\Local\lap-capture\{}: Access is denied. (os error 5)",
            "x".repeat(300)
        ));
        let mut stopped = recording.clone();
        stopped.state = "stopped";
        for s in [Status::new(), recording, waiting, refused, stopped] {
            crate::contract::server_takes("recorder-status", &s.json(1_790_000_001_000));
        }
    }
}
