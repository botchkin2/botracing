// The iRacing recorder loop: waits for the sim, records each session to a
// folder of its own (ir_store.rs), idles between. `tick` is one poll and says
// how long to wait before the next; the real source waits on the sim's data
// event instead of polling (win.rs).
//
// A frame is a new tick of the sim's telemetry buffer (irsdk.rs). The player
// row is kept for every tick (60 Hz); every 200 ms the whole field and the
// session clock are kept as well (5 Hz, like LMU's scoring). Only a fixed
// whitelist of variables is written, never "everything the sim offers", and
// never a name or id of a person (ir_session.rs).

use crate::capture::frame::View;
use crate::capture::ir_session::{self, SessionMeta};
use crate::capture::ir_store::{Cell, IrCapture};
use crate::capture::irsdk::{Frame, Kind, Reader, Var};
use crate::capture::store::{iso, write_json};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(4);
const NO_SIM: Duration = Duration::from_secs(5);
const WAITING: Duration = Duration::from_secs(1);
// Cut at least this often (the LMU recorder's runner::CHUNK_MS: a crash loses at most this much).
const CHUNK_MS: u64 = 15_000;
/// The field and the session clock are kept this often.
const FIELD_EVERY_MS: u64 = 200;
/// The session text is looked at this often (a header read, cheap).
const INFO_EVERY_MS: u64 = 500;
/// The map is checked for a sim that went away or restarted this often.
const ALIVE_EVERY_MS: u64 = 1_000;
/// status-iracing.json is rewritten on a change, and at least this often, so
/// the uploader can tell a live recorder from a stale file (as recorder.rs).
const STATUS_MS: u64 = 30_000;
/// How long after the player's Lap changes the lap's chunk is cut (seconds,
/// sim clock). iRacing publishes LapLastLapTime up to 0.85 s after Lap changes
/// (9 Oct Sebring .ibt), and the adapter waits up to 3 s for it
/// (tools/sessions/iracing.mjs lapCrossings): the chunk must carry it.
const LAP_CUT_AFTER_S: f64 = 3.1;

/// The player car, one row per tick. What the .ibt adapter reads
/// (tools/sessions/iracing.mjs CHANNELS) plus what only live data or the
/// screens need. A variable the car does not have is simply not a column.
pub const PLAYER: &[&str] = &[
    "SessionTime", "SessionNum", "Speed", "Throttle", "ThrottleRaw", "Brake", "BrakeRaw",
    "Clutch", "SteeringWheelAngle", "SteeringWheelAngleMax", "RPM", "Gear", "LapDist", "LapDistPct", "Lap",
    "LapCompleted", "LapLastLapTime", "LapBestLapTime", "LapCurrentLapTime", "Lat", "Lon",
    "Alt", "FuelLevel", "OnPitRoad", "PlayerCarInPitStall", "PlayerTrackSurface",
    "PlayerTrackSurfaceMaterial", "SessionFlags", "PlayerCarPosition",
    "PlayerCarClassPosition", "CarDistAhead", "CarDistBehind", "LatAccel", "LongAccel",
    "VertAccel", "YawRate", "CarLeftRight", "LFtempCM", "RFtempCM", "LRtempCM", "RRtempCM", "LFtempL",
    "RFtempL", "LRtempL", "RRtempL", "LFtempM", "RFtempM", "LRtempM", "RRtempM", "LFtempR",
    "RFtempR", "LRtempR", "RRtempR", "LFwearL", "RFwearL", "LRwearL", "RRwearL", "LFwearM",
    "RFwearM", "LRwearM", "RRwearM", "LFwearR", "RFwearR", "LRwearR", "RRwearR", "LFpressure",
    "RFpressure", "LRpressure", "RRpressure", "TrackTemp", "AirTemp",
];

/// Per-car arrays, one row per racing car per update.
pub const FIELD: &[&str] = &[
    "CarIdxLapDistPct", "CarIdxLap", "CarIdxLapCompleted", "CarIdxPosition",
    "CarIdxClassPosition", "CarIdxOnPitRoad", "CarIdxTrackSurface", "CarIdxLastLapTime",
    "CarIdxBestLapTime", "CarIdxEstTime", "CarIdxF2Time", "CarIdxGear",
];

/// Session clock, flags and weather, one row per update.
pub const SESSION: &[&str] = &[
    "SessionTime", "SessionNum", "SessionState", "SessionFlags", "SessionTimeRemain",
    "SessionLapsRemain", "TrackTemp", "TrackTempCrew", "AirTemp", "TrackWetness",
    "WeatherDeclaredWet", "Skies", "WindVel", "WindDir", "RelativeHumidity",
];

/// What the menu shows about this recorder, and what it writes to
/// `<root>/status-iracing.json` for the uploader. `session_dir` is the open
/// capture's folder name relative to the root: the heartbeat is served without
/// sign-in, so no user path leaves the PC.
#[derive(Clone, Debug, PartialEq)]
pub struct IrStatus {
    /// no-sim | waiting | recording | error
    pub state: &'static str,
    pub reason: String,
    pub session_dir: Option<String>,
    /// When a chunk was last on disk (not when it was cut).
    pub last_chunk_at: Option<String>,
    /// When the chunk that ends at the player's last Lap change was on disk: a
    /// finished lap is readable from then (live laps, pit-wall thread 66).
    pub last_lap_at: Option<String>,
    pub capture_bytes: u64,
}

impl IrStatus {
    pub fn new() -> IrStatus {
        IrStatus {
            state: "no-sim",
            reason: String::new(),
            session_dir: None,
            last_chunk_at: None,
            last_lap_at: None,
            capture_bytes: 0,
        }
    }

    fn json(&self, now: u64) -> Value {
        json!({
            "state": self.state,
            "reason": self.reason,
            "sessionDir": self.session_dir,
            "lastChunkAt": self.last_chunk_at,
            "lastLapAt": self.last_lap_at,
            "captureBytes": self.capture_bytes,
            "updatedAt": iso(now),
        })
    }
}

pub fn line(s: &IrStatus) -> String {
    match s.state {
        "recording" => "iRacing: Recording".into(),
        "error" => format!("iRacing: {}", s.reason),
        _ => "Waiting for iRacing".into(),
    }
}

pub trait IrSource {
    type V: View;
    /// The sim is up (its data event exists).
    fn running(&mut self) -> bool;
    fn open(&mut self) -> Result<Self::V, String>;
    /// Waits for the sim's next tick, at most `limit`.
    fn wait(&mut self, limit: Duration) {
        std::thread::sleep(limit);
    }
}

/// The recorder's loop (runner.rs start_iracing): tick, report, wait. One wait
/// per tick: it returns early on the sim's next tick, which is what records
/// every 60 Hz frame. Capped at STOP_SLICE, so a quit (`stop`) or the sim
/// starting is seen within it.
pub fn drive<S: IrSource>(
    rec: &mut IrRecorder<S>,
    stop: &std::sync::atomic::AtomicBool,
    mut each: impl FnMut(&IrRecorder<S>),
) {
    use crate::capture::runner::{now_ms, STOP_SLICE};
    while !stop.load(std::sync::atomic::Ordering::SeqCst) {
        let wait = rec.tick(now_ms());
        each(rec);
        rec.src().wait(wait.min(STOP_SLICE));
    }
}

fn cells(frame: &Frame, vars: &[&Var], index: usize) -> Vec<(String, Cell)> {
    let mut row = Vec::with_capacity(vars.len());
    for v in vars {
        let cell = match v.kind {
            Kind::Float => frame.f32(v, index).map(Cell::F32),
            Kind::Double => frame.f64(v, index).map(Cell::F64),
            Kind::Int | Kind::BitField => frame.i32(v, index).map(|n| Cell::I64(n as i64)),
            Kind::Bool => frame.bool(v, index).map(Cell::Bool),
            Kind::Char => None,
        };
        if let Some(cell) = cell {
            row.push((v.name.clone(), cell));
        }
    }
    row
}

struct Open<V> {
    view: V,
    reader: Reader,
    player: Vec<Var>,
    field: Vec<Var>,
    session: Vec<Var>,
    gate: Vec<Var>,
    /// The player's Lap and SessionTime, for the lap-end cut.
    lap: Option<Var>,
    time: Option<Var>,
}

/// Whether the player is on track and not watching a replay: only then is a
/// tick written. A sim that does not publish a flag is taken as on track.
fn on_track(frame: &Frame, gate: &[Var]) -> bool {
    let flag = |name: &str| {
        gate.iter()
            .find(|v| v.name == name)
            .and_then(|v| frame.bool(v, 0))
    };
    flag("IsOnTrack").unwrap_or(true) && !flag("IsReplayPlaying").unwrap_or(false)
}

fn pick(reader: &Reader, names: &[&str]) -> Vec<Var> {
    names.iter().filter_map(|n| reader.var(n).cloned()).collect()
}

pub struct IrRecorder<S: IrSource> {
    src: S,
    root: PathBuf,
    chunk_ms: u64,
    open: Option<Open<S::V>>,
    cap: Option<IrCapture>,
    meta: SessionMeta,
    key: Option<String>,
    first_seen_ms: u64,
    info_seen: Option<i32>,
    last_tick: Option<i32>,
    last_field_ms: u64,
    last_info_ms: u64,
    last_alive_ms: u64,
    updates: i64,
    /// The player's Lap in the open capture's last recorded frame.
    last_lap: Option<i32>,
    /// When (sim clock) the chunk that holds the last Lap change is cut.
    cut_due: Option<f64>,
    /// Lap-end chunks handed to the writer and not yet on disk.
    laps_pending: usize,
    status_written: Option<u64>,
    pub status: IrStatus,
}

impl<S: IrSource> IrRecorder<S> {
    pub fn new(src: S, root: PathBuf) -> IrRecorder<S> {
        IrRecorder {
            src,
            root,
            chunk_ms: CHUNK_MS,
            open: None,
            cap: None,
            meta: SessionMeta::default(),
            key: None,
            first_seen_ms: 0,
            info_seen: None,
            last_tick: None,
            last_field_ms: 0,
            last_info_ms: 0,
            last_alive_ms: 0,
            updates: 0,
            last_lap: None,
            cut_due: None,
            laps_pending: 0,
            status_written: None,
            status: IrStatus::new(),
        }
    }

    pub fn src(&mut self) -> &mut S {
        &mut self.src
    }

    /// Applies a change to the status; the file is rewritten when anything
    /// in it changed, or when it is STATUS_MS old.
    fn set(&mut self, ms: u64, change: impl FnOnce(&mut IrStatus)) {
        let before = self.status.clone();
        change(&mut self.status);
        self.status.capture_bytes = self.cap.as_ref().map_or(0, |c| c.bytes);
        self.status.session_dir = self
            .cap
            .as_ref()
            .and_then(|c| c.dir.file_name())
            .map(|n| n.to_string_lossy().into_owned());
        let due = self.status_written.is_none_or(|at| ms.saturating_sub(at) >= STATUS_MS);
        if before != self.status || due {
            let _ = std::fs::create_dir_all(&self.root);
            let _ = write_json(&self.root.join("status-iracing.json"), &self.status.json(ms));
            self.status_written = Some(ms);
        }
    }

    fn say(&mut self, ms: u64, state: &'static str, reason: &str) {
        self.set(ms, |s| {
            s.state = state;
            s.reason = reason.to_string();
        });
    }

    /// What the writer finished: lastChunkAt (and lastLapAt once a lap-end
    /// chunk is among it) set, or the error state. False on an error.
    fn chunks_written(&mut self, ms: u64, written: Result<u64, String>) -> bool {
        match written {
            Ok(bytes) if bytes > 0 => {
                // The writer finishes chunks in order: a lap-end chunk handed
                // over before this poll is on disk once anything is.
                let lap = std::mem::take(&mut self.laps_pending) > 0;
                self.set(ms, |s| {
                    s.last_chunk_at = Some(iso(ms));
                    if lap {
                        s.last_lap_at = Some(iso(ms));
                    }
                });
                true
            }
            Ok(_) => {
                self.set(ms, |_| {});
                true
            }
            Err(e) => {
                self.say(ms, "error", &format!("could not write: {e}"));
                false
            }
        }
    }

    /// A new capture counts its own laps: its first frame is not a crossing.
    fn reset_laps(&mut self) {
        self.last_lap = None;
        self.cut_due = None;
        self.laps_pending = 0;
    }

    /// Finishes the open capture (endUtc) and forgets the session.
    fn finish(&mut self, ms: u64) {
        if let Some(mut cap) = self.cap.take() {
            // close waits for the writer, so a pending lap-end chunk is on disk.
            let closed = cap.close(ms);
            self.chunks_written(ms, closed);
        }
        self.reset_laps();
        self.key = None;
        self.info_seen = None;
        self.last_tick = None;
        self.updates = 0;
    }

    /// The sim went away or restarted: nothing of the old view is trusted.
    fn drop_sim(&mut self, ms: u64) {
        self.finish(ms);
        self.open = None;
    }

    /// One poll. Returns how long to wait before the next.
    pub fn tick(&mut self, ms: u64) -> Duration {
        if !self.src.running() {
            if self.open.is_some() {
                self.drop_sim(ms);
            }
            if self.status.state != "error" {
                self.say(ms, "no-sim", "");
            }
            return NO_SIM;
        }
        if self.open.is_none() {
            let Ok(mut view) = self.src.open() else {
                self.say(ms, "waiting", "");
                return WAITING;
            };
            let Some(reader) = Reader::open(&mut view) else {
                // The map is zero-filled until a car is on track.
                self.say(ms, "waiting", "");
                return WAITING;
            };
            let (player, field, session) =
                (pick(&reader, PLAYER), pick(&reader, FIELD), pick(&reader, SESSION));
            let gate = pick(&reader, &["IsOnTrack", "IsReplayPlaying"]);
            let (lap, time) = (reader.var("Lap").cloned(), reader.var("SessionTime").cloned());
            self.open = Some(Open {
                view,
                reader,
                player,
                field,
                session,
                gate,
                lap,
                time,
            });
            self.last_alive_ms = ms;
            self.last_info_ms = 0;
        }
        if ms.saturating_sub(self.last_alive_ms) >= ALIVE_EVERY_MS {
            self.last_alive_ms = ms;
            let alive = self.open.as_mut().is_some_and(|o| o.reader.alive(&mut o.view));
            if !alive {
                self.drop_sim(ms);
                self.say(ms, "waiting", "");
                return WAITING;
            }
        }
        if ms.saturating_sub(self.last_info_ms) >= INFO_EVERY_MS {
            self.last_info_ms = ms;
            self.read_session_text(ms);
        }
        if self.open.is_none() {
            return WAITING;
        }
        if self.cap.is_none() {
            // No complete session text yet: nothing to record into.
            self.say(ms, "waiting", "");
            return POLL;
        }
        let (recorded, cut) = self.record_frame(ms);
        if let Some(written) = cut {
            // Counted after what the cut's flush reported: those bytes are
            // earlier chunks, not the lap's.
            if !self.chunks_written(ms, written) {
                return POLL;
            }
            self.laps_pending += 1;
        }
        // On every poll, frame or not: a lap's chunk on disk is known within a
        // poll, and a failed write at once.
        let Some(cap) = self.cap.as_mut() else { return POLL };
        let written = if cap.due(ms, self.chunk_ms) { cap.flush(ms) } else { cap.written() };
        if !self.chunks_written(ms, written) {
            return POLL;
        }
        if recorded {
            self.say(ms, "recording", "");
        }
        POLL
    }

    /// Reads the sim's next tick into the open capture. Returns whether a row
    /// was kept, and the result of the lap-end cut if this tick made one.
    fn record_frame(&mut self, ms: u64) -> (bool, Option<Result<u64, String>>) {
        let (Some(open), Some(cap)) = (self.open.as_mut(), self.cap.as_mut()) else {
            return (false, None);
        };
        let Some(frame) = open.reader.frame(&mut open.view, self.last_tick) else {
            return (false, None);
        };
        if let Some(prev) = self.last_tick {
            let gap = frame.tick.wrapping_sub(prev);
            if gap > 1 && gap < 600 {
                cap.count("missedTicks", (gap - 1) as u64);
            }
        }
        self.last_tick = Some(frame.tick);
        // Menus and replays are not recorded. The session stays open, so a
        // pause never starts a new session folder.
        if !on_track(&frame, &open.gate) {
            return (false, None);
        }
        // The player's Lap changed: the lap that ended is cut into a chunk
        // LAP_CUT_AFTER_S later, so it is on disk within a write instead of up
        // to a minute later. The frame at the due time opens the next chunk.
        let time = open.time.as_ref().and_then(|v| frame.f64(v, 0));
        if let (Some(lap), Some(t)) = (open.lap.as_ref().and_then(|v| frame.i32(v, 0)), time) {
            if self.last_lap.is_some_and(|prev| prev != lap) {
                self.cut_due = Some(t + LAP_CUT_AFTER_S);
            }
            self.last_lap = Some(lap);
        }
        let cut = match (self.cut_due, time) {
            (Some(due), Some(t)) if t >= due => {
                self.cut_due = None;
                Some(cap.flush(ms))
            }
            _ => None,
        };
        let player: Vec<&Var> = open.player.iter().collect();
        let mut row = cells(&frame, &player, 0);
        row.push(("wall_ms".into(), Cell::I64(ms as i64)));
        row.push(("tick".into(), Cell::I64(frame.tick as i64)));
        cap.player.push(row);
        cap.count("playerRows", 1);
        if ms.saturating_sub(self.last_field_ms) >= FIELD_EVERY_MS {
            self.last_field_ms = ms;
            let meta = &self.meta;
            let session: Vec<&Var> = open.session.iter().collect();
            let mut srow = cells(&frame, &session, 0);
            srow.push(("wall_ms".into(), Cell::I64(ms as i64)));
            srow.push(("update".into(), Cell::I64(self.updates)));
            cap.session.push(srow);
            let field: Vec<&Var> = open.field.iter().collect();
            let slots = open.field.first().map_or(0, |v| v.count);
            for idx in 0..slots {
                // Not in the world (the pace car's slot, an empty one) and the
                // cars that are not racing are left out.
                let at = open.field.iter().find(|v| v.name == "CarIdxLapDistPct");
                if at.and_then(|v| frame.f32(v, idx)).map_or(true, |p| p < 0.0) {
                    continue;
                }
                if !meta.racing(idx as i64) {
                    continue;
                }
                let mut car = cells(&frame, &field, idx);
                car.push(("CarIdx".into(), Cell::I64(idx as i64)));
                car.push(("wall_ms".into(), Cell::I64(ms as i64)));
                car.push(("update".into(), Cell::I64(self.updates)));
                cap.field.push(car);
            }
            self.updates += 1;
            cap.count("fieldUpdates", 1);
        }
        (true, cut)
    }

    /// A new or changed session text: a new session opens a new capture.
    fn read_session_text(&mut self, ms: u64) {
        let Some(open) = self.open.as_mut() else { return };
        let Some((n, text)) = open.reader.session_info(&mut open.view, self.info_seen) else {
            return;
        };
        // The sim rewrites the text and then bumps the counter, so a copy can
        // be half a text under a counter we would take for done: the end line
        // is the check, and an unfinished text is read again next time.
        if !ir_session::is_complete(&text) {
            return;
        }
        self.info_seen = Some(n);
        let meta = ir_session::parse(&text);
        if meta.track_id == 0 && meta.track_name.is_empty() {
            return;
        }
        let key = meta.key(self.first_seen_ms.max(1));
        if self.key.as_deref() != Some(&key) {
            if self.cap.is_some() {
                self.finish(ms);
                // A new session of the same offline run keeps one start time
                // per run; a new run (the sim restarted) set it afresh.
            }
            if meta.sub_session_id == 0 && self.first_seen_ms == 0 {
                self.first_seen_ms = ms;
            }
            let key = meta.key(self.first_seen_ms.max(1));
            let json = meta.to_json();
            let mut map = serde_json::Map::new();
            if let Value::Object(o) = json {
                map = o;
            }
            map.insert("sessionKey".into(), Value::String(key.clone()));
            map.insert("firstSeenUtc".into(), Value::String(iso(ms)));
            match IrCapture::new(&self.root, map, ms) {
                Ok(cap) => {
                    self.cap = Some(cap);
                    self.key = Some(key);
                    self.last_field_ms = 0;
                    self.updates = 0;
                    self.reset_laps();
                }
                Err(e) => self.say(ms, "error", &format!("could not write: {e}")),
            }
        } else if let Some(cap) = self.cap.as_mut() {
            // Same session, text changed (a driver joined): the cars list.
            if let Value::Object(o) = meta.to_json() {
                for (k, v) in o {
                    cap.meta.insert(k, v);
                }
            }
        }
        self.meta = meta;
    }

    /// Finishes the open capture on quit.
    pub fn shutdown(&mut self, ms: u64) {
        self.drop_sim(ms);
        self.say(ms, "no-sim", "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::irsdk::tests::put;
    use crate::capture::store::dir_bytes;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use std::cell::RefCell;
    use std::rc::Rc;

    const VARS_AT: usize = 112;
    const VAR_LEN: usize = 144;
    const BUF_LEN: usize = 256;
    const INFO_AT: usize = 1536;
    const BUF0: usize = 4096;
    const SLOTS: usize = 4;

    // (name, type code, offset, count): Speed f32, Lap i32, SessionTime f64,
    // SessionNum i32, CarIdxLapDistPct f32[4], CarIdxPosition i32[4].
    const VARS: [(&str, i32, i32, i32); 8] = [
        ("Speed", 4, 0, 1),
        ("Lap", 2, 4, 1),
        ("SessionTime", 5, 8, 1),
        ("SessionNum", 2, 16, 1),
        ("CarIdxLapDistPct", 4, 24, SLOTS as i32),
        ("CarIdxPosition", 2, 40, SLOTS as i32),
        // bool: one byte each, after the arrays
        ("IsOnTrack", 1, 56, 1),
        ("IsReplayPlaying", 1, 57, 1),
    ];

    const TEXT: &str = "---\nWeekendInfo:\n TrackID: 127\n TrackDisplayName: Road Atlanta\n TrackConfigName: Full Course\n SubSessionID: 99\nSessionInfo:\n CurrentSessionNum: 0\n Sessions:\n - SessionNum: 0\n   SessionType: Race\nDriverInfo:\n DriverCarIdx: 0\n Drivers:\n - CarIdx: 0\n   UserName: Secret Name\n   CarNumber: \"5\"\n   CarScreenName: Ford Mustang GT3\n - CarIdx: 1\n   UserName: Other Person\n   CarNumber: \"6\"\n - CarIdx: 2\n   UserName: Pace\n   CarIsPaceCar: 1\n...\n";

    struct Sim {
        mem: Vec<u8>,
        running: bool,
    }

    fn sim_memory(text: &str) -> Vec<u8> {
        let mut m = vec![0u8; BUF0 + 3 * BUF_LEN];
        put(&mut m, 0, 2);
        put(&mut m, 4, 1);
        put(&mut m, 8, 60);
        put(&mut m, 12, 1);
        put(&mut m, 16, text.len() as i32 + 1);
        put(&mut m, 20, INFO_AT as i32);
        put(&mut m, 24, VARS.len() as i32);
        put(&mut m, 28, VARS_AT as i32);
        put(&mut m, 32, 3);
        put(&mut m, 36, BUF_LEN as i32);
        for (i, (name, code, offset, count)) in VARS.iter().enumerate() {
            let at = VARS_AT + i * VAR_LEN;
            put(&mut m, at, *code);
            put(&mut m, at + 4, *offset);
            put(&mut m, at + 8, *count);
            m[at + 16..at + 16 + name.len()].copy_from_slice(name.as_bytes());
        }
        m[INFO_AT..INFO_AT + text.len()].copy_from_slice(text.as_bytes());
        for slot in 0..3 {
            put(&mut m, 48 + slot * 16, 0);
            put(&mut m, 48 + slot * 16 + 4, (BUF0 + slot * BUF_LEN) as i32);
        }
        m
    }

    /// Writes tick `t` into buffer slot t % 3 (speed = t, lap = 3, session
    /// time = t / 60, lap distance pct per car as given).
    fn frame(m: &mut [u8], t: i32, pcts: [f32; SLOTS]) {
        frame_with(m, t, pcts, true, false);
    }

    /// As `frame`, with the player on track or not and in a replay or not.
    fn frame_with(m: &mut [u8], t: i32, pcts: [f32; SLOTS], on_track: bool, replay: bool) {
        let slot = (t as usize) % 3;
        let at = BUF0 + slot * BUF_LEN;
        m[at..at + 4].copy_from_slice(&(t as f32).to_le_bytes());
        put(m, at + 4, 3);
        m[at + 8..at + 16].copy_from_slice(&(t as f64 / 60.0).to_le_bytes());
        put(m, at + 16, 0);
        for (i, p) in pcts.iter().enumerate() {
            m[at + 24 + i * 4..at + 28 + i * 4].copy_from_slice(&p.to_le_bytes());
            put(m, at + 40 + i * 4, i as i32 + 1);
        }
        m[at + 56] = on_track as u8;
        m[at + 57] = replay as u8;
        put(m, 48 + slot * 16, t);
    }

    /// As `frame`, on lap `lap`.
    fn frame_on_lap(m: &mut [u8], t: i32, lap: i32) {
        frame(m, t, [0.1, 0.2, -1.0, 0.4]);
        put(m, BUF0 + (t as usize % 3) * BUF_LEN + 4, lap);
    }

    fn status_file(root: &std::path::Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(root.join("status-iracing.json")).unwrap()).unwrap()
    }

    struct Src(Rc<RefCell<Sim>>);
    struct SimView(Rc<RefCell<Sim>>);

    impl View for SimView {
        fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
            self.0.borrow().mem.get(offset..offset + len).map(|s| s.to_vec())
        }
    }

    impl IrSource for Src {
        type V = SimView;
        fn running(&mut self) -> bool {
            self.0.borrow().running
        }
        fn open(&mut self) -> Result<SimView, String> {
            Ok(SimView(self.0.clone()))
        }
        fn wait(&mut self, _limit: Duration) {}
    }

    /// A sim whose data event fires on every wait: each wait brings one new
    /// 60 Hz frame (what IrShm's event-driven wait does), and stops the loop
    /// after `frames`. It keeps every limit the loop asked for.
    struct Ticking {
        sim: Rc<RefCell<Sim>>,
        t: i32,
        frames: i32,
        stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
        limits: Rc<RefCell<Vec<Duration>>>,
    }

    impl IrSource for Ticking {
        type V = SimView;
        fn running(&mut self) -> bool {
            self.sim.borrow().running
        }
        fn open(&mut self) -> Result<SimView, String> {
            Ok(SimView(self.sim.clone()))
        }
        fn wait(&mut self, limit: Duration) {
            self.limits.borrow_mut().push(limit);
            if !self.sim.borrow().running {
                return;
            }
            if self.t >= self.frames {
                self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
                return;
            }
            self.t += 1;
            frame(&mut self.sim.borrow_mut().mem, self.t, [0.10, 0.20, -1.0, 0.40]);
        }
    }

    #[test]
    fn the_loop_records_every_frame_the_sim_signals() {
        let root = std::env::temp_dir().join(format!("ir-rec-rate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let sim = Rc::new(RefCell::new(Sim { mem: sim_memory(TEXT), running: true }));
        frame(&mut sim.borrow_mut().mem, 1, [0.10, 0.20, -1.0, 0.40]);
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let limits = Rc::new(RefCell::new(Vec::new()));
        let src = Ticking { sim: sim.clone(), t: 1, frames: 60, stop: stop.clone(), limits: limits.clone() };
        let mut rec = IrRecorder::new(src, root.clone());
        drive(&mut rec, &stop, |_| {});
        rec.shutdown(crate::capture::runner::now_ms());
        let dirs = captures(&root);
        let (n, _) = rows(&dirs[0].join("player-0000.parquet"));
        // A second of the sim at 60 Hz: every frame, not one per wait limit.
        assert_eq!(n, 60);
        assert!(limits.borrow().iter().all(|l| *l <= crate::capture::runner::STOP_SLICE));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn with_no_sim_the_loop_still_looks_at_its_stop_every_slice() {
        let root = std::env::temp_dir().join(format!("ir-rec-nosim-{}", std::process::id()));
        let sim = Rc::new(RefCell::new(Sim { mem: sim_memory(TEXT), running: false }));
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let limits = Rc::new(RefCell::new(Vec::new()));
        let src = Ticking { sim, t: 0, frames: 0, stop: stop.clone(), limits: limits.clone() };
        let mut rec = IrRecorder::new(src, root);
        let mut ticks = 0;
        let stop2 = stop.clone();
        drive(&mut rec, &stop, move |_| {
            ticks += 1;
            if ticks == 3 {
                stop2.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        });
        // The tick asked for NO_SIM (5 s); every wait was at most one slice.
        assert_eq!(limits.borrow().len(), 3);
        assert!(limits.borrow().iter().all(|l| *l == crate::capture::runner::STOP_SLICE));
    }

    fn setup(tag: &str, text: &str) -> (IrRecorder<Src>, Rc<RefCell<Sim>>, PathBuf) {
        let root = std::env::temp_dir().join(format!("ir-rec-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let sim = Rc::new(RefCell::new(Sim { mem: sim_memory(text), running: true }));
        let rec = IrRecorder::new(Src(sim.clone()), root.clone());
        (rec, sim, root)
    }

    /// The capture folders under the root (status-iracing.json sits beside them).
    fn captures(root: &PathBuf) -> Vec<PathBuf> {
        let mut v: Vec<_> = std::fs::read_dir(root)
            .map(|d| d.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        v.sort();
        v
    }

    fn rows(path: &PathBuf) -> (usize, Vec<String>) {
        let file = std::fs::File::open(path).unwrap();
        let b = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
        let names = b.schema().fields().iter().map(|f| f.name().clone()).collect();
        (b.build().unwrap().map(|r| r.unwrap().num_rows()).sum(), names)
    }

    #[test]
    fn nothing_records_while_the_sim_is_not_running() {
        let (mut rec, sim, root) = setup("off", TEXT);
        sim.borrow_mut().running = false;
        assert_eq!(rec.tick(1000), NO_SIM);
        assert_eq!(rec.status.state, "no-sim");
        assert!(captures(&root).is_empty());
    }

    #[test]
    fn a_zero_map_waits() {
        let (mut rec, sim, root) = setup("zero", TEXT);
        sim.borrow_mut().mem = vec![0u8; 8192];
        assert_eq!(rec.tick(1000), WAITING);
        assert_eq!(rec.status.state, "waiting");
        assert!(captures(&root).is_empty());
    }

    #[test]
    fn a_half_written_session_text_opens_no_capture() {
        let (mut rec, sim, root) = setup("half", &TEXT[..TEXT.len() / 2]);
        frame(&mut sim.borrow_mut().mem, 1, [0.1, 0.2, -1.0, 0.4]);
        rec.tick(1000);
        rec.tick(1010);
        assert!(captures(&root).is_empty());
        assert_eq!(rec.status.state, "waiting");
    }

    #[test]
    fn menus_and_replays_are_not_recorded_and_the_session_stays_one_folder() {
        let (mut rec, sim, root) = setup("gate", TEXT);
        let mut ms = 1_700_000_000_000u64;
        // 10 on track, 10 in a menu, 10 in a replay, 10 on track again.
        for (range, on, replay) in [
            (1..=10, true, false),
            (11..=20, false, false),
            (21..=30, true, true),
            (31..=40, true, false),
        ] {
            for t in range {
                frame_with(&mut sim.borrow_mut().mem, t, [0.1, 0.2, -1.0, 0.4], on, replay);
                rec.tick(ms);
                ms += 17;
            }
        }
        sim.borrow_mut().running = false;
        rec.tick(ms);
        let dirs = captures(&root);
        assert_eq!(dirs.len(), 1, "a pause never splits the session folder");
        let (n, _) = rows(&dirs[0].join("player-0000.parquet"));
        assert_eq!(n, 20, "only the on-track ticks are written");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn records_player_field_and_session_and_closes_when_the_sim_exits() {
        let (mut rec, sim, root) = setup("rec", TEXT);
        let mut ms = 1_700_000_000_000u64;
        for t in 1..=40 {
            frame(&mut sim.borrow_mut().mem, t, [0.10, 0.20, -1.0, 0.40]);
            rec.tick(ms);
            ms += 17; // 60 Hz
        }
        assert_eq!(rec.status.state, "recording");
        let dirs = captures(&root);
        assert_eq!(dirs.len(), 1);
        let meta = std::fs::read_to_string(dirs[0].join("meta.json")).unwrap();
        assert!(meta.contains("\"sim\": \"iracing\""));
        assert!(meta.contains("Ford Mustang GT3"));
        assert!(!meta.contains("Secret Name") && !meta.contains("Other Person"));
        // The sim exits: the capture is finished and flushed.
        sim.borrow_mut().running = false;
        rec.tick(ms);
        let (n, names) = rows(&dirs[0].join("player-0000.parquet"));
        assert_eq!(n, 40);
        for want in ["Speed", "Lap", "SessionTime", "wall_ms", "tick"] {
            assert!(names.iter().any(|c| c == want), "{want} in {names:?}");
        }
        let (field_rows, field_cols) = rows(&dirs[0].join("field-0000.parquet"));
        // Cars 0 and 1 race; slot 2 is not in the world (and the pace car);
        // slot 3 is in the world but not listed, so it is kept.
        assert_eq!(field_rows % 3, 0, "three cars per update");
        assert!(field_rows >= 3);
        assert!(field_cols.iter().any(|c| c == "CarIdx"));
        let (session_rows, _) = rows(&dirs[0].join("session-0000.parquet"));
        assert!(session_rows >= 1);
        let end = std::fs::read_to_string(dirs[0].join("meta.json")).unwrap();
        assert!(!end.contains("\"endUtc\": null"), "{end}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_new_session_number_opens_a_new_capture() {
        let (mut rec, sim, root) = setup("two", TEXT);
        let mut ms = 1_700_000_000_000u64;
        for t in 1..=5 {
            frame(&mut sim.borrow_mut().mem, t, [0.1, 0.2, -1.0, 0.4]);
            rec.tick(ms);
            ms += 17;
        }
        // The next session: new text with SessionNum 1, counter bumped.
        let text2 = TEXT.replace("CurrentSessionNum: 0", "CurrentSessionNum: 1");
        {
            let mut s = sim.borrow_mut();
            s.mem[INFO_AT..INFO_AT + text2.len()].copy_from_slice(text2.as_bytes());
            put(&mut s.mem, 12, 2);
        }
        for t in 6..=10 {
            frame(&mut sim.borrow_mut().mem, t, [0.1, 0.2, -1.0, 0.4]);
            ms += 600; // past the text check interval
            rec.tick(ms);
        }
        assert_eq!(captures(&root).len(), 2);
        let first = std::fs::read_to_string(captures(&root)[0].join("meta.json")).unwrap();
        assert!(!first.contains("\"endUtc\": null"), "the first is finished: {first}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_lap_change_cuts_the_lap_into_its_own_chunk_and_says_when_it_is_on_disk() {
        let (mut rec, sim, root) = setup("lapcut", TEXT);
        let mut ms = 1_700_000_000_000u64;
        // Lap 3 for ticks 1 to 10; lap 4 from tick 11 (session time t / 60 s).
        let lap_of = |t: i32| if t <= 10 { 3 } else { 4 };
        let due = 11.0 / 60.0 + LAP_CUT_AFTER_S;
        // The first tick at or past the crossing + 3.1 s opens the next chunk.
        let first_after = (1..).find(|t| *t as f64 / 60.0 >= due).unwrap();
        for t in 1..first_after {
            frame_on_lap(&mut sim.borrow_mut().mem, t, lap_of(t));
            rec.tick(ms);
            ms += 17;
        }
        assert_eq!(rec.status.last_lap_at, None, "not cut before the lap time is published");
        assert!(!captures(&root)[0].join("player-0000.parquet").exists());
        frame_on_lap(&mut sim.borrow_mut().mem, first_after, 4);
        rec.tick(ms);
        // The writer is a thread: polls without a new tick pick its result up.
        // Up to 20 s: the loop leaves as soon as the chunk is on disk, and a slow
        // CI disk (Defender scanning the new parquet) took over the old 1 s (the
        // 0.1.16 release run, 223 tests, 25 s against 3.7 s here).
        for _ in 0..4_000 {
            if rec.status.last_lap_at.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            ms += 4;
            rec.tick(ms);
        }
        assert!(rec.status.last_lap_at.is_some(), "the lap-end chunk never reached the disk");
        let dir = captures(&root).remove(0);
        let (n, _) = rows(&dir.join("player-0000.parquet"));
        assert_eq!(n, (first_after - 1) as usize, "the chunk ends just before the due tick");
        let status = status_file(&root);
        assert_eq!(status["lastLapAt"], rec.status.last_lap_at.clone().unwrap());
        assert_eq!(status["lastChunkAt"], rec.status.last_lap_at.clone().unwrap());
        rec.shutdown(ms);
        let meta = std::fs::read_to_string(dir.join("meta.json")).unwrap();
        assert!(meta.contains("\"chunks\": 2"), "{meta}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_first_frame_of_a_capture_is_not_a_crossing() {
        let (mut rec, sim, root) = setup("lapfirst", TEXT);
        let mut ms = 1_700_000_000_000u64;
        // Lap 7 from the first frame, for 5 s of sim time: past any cut due.
        for t in 1..=300 {
            frame_on_lap(&mut sim.borrow_mut().mem, t, 7);
            rec.tick(ms);
            ms += 17;
        }
        rec.shutdown(ms);
        let meta = std::fs::read_to_string(captures(&root)[0].join("meta.json")).unwrap();
        assert!(meta.contains("\"chunks\": 1"), "{meta}");
        assert_eq!(rec.status.last_lap_at, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_status_file_names_the_capture_while_recording() {
        let (mut rec, sim, root) = setup("status", TEXT);
        let mut ms = 1_700_000_000_000u64;
        for t in 1..=5 {
            frame(&mut sim.borrow_mut().mem, t, [0.1, 0.2, -1.0, 0.4]);
            rec.tick(ms);
            ms += 17;
        }
        let dir = captures(&root).remove(0);
        let name = dir.file_name().unwrap().to_string_lossy().into_owned();
        let status = status_file(&root);
        assert_eq!(status["state"], "recording");
        assert_eq!(status["sessionDir"], name.as_str());
        assert_eq!(status["lastLapAt"], Value::Null);
        for key in ["reason", "lastChunkAt", "captureBytes", "updatedAt"] {
            assert!(status.get(key).is_some(), "{key} in {status}");
        }
        rec.shutdown(ms);
        let status = status_file(&root);
        assert_eq!(status["state"], "no-sim");
        assert_eq!(status["sessionDir"], Value::Null);
        assert!(status["lastChunkAt"].is_string(), "the close wrote the last chunk: {status}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn skipped_ticks_are_counted() {
        let (mut rec, sim, root) = setup("miss", TEXT);
        let mut ms = 1_700_000_000_000u64;
        for t in [1, 2, 3, 7] {
            frame(&mut sim.borrow_mut().mem, t, [0.1, 0.2, -1.0, 0.4]);
            rec.tick(ms);
            ms += 17;
        }
        rec.shutdown(ms);
        let meta = std::fs::read_to_string(captures(&root)[0].join("meta.json")).unwrap();
        assert!(meta.contains("\"missedTicks\": 3"), "{meta}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_sim_that_restarts_is_reopened() {
        let (mut rec, sim, root) = setup("restart", TEXT);
        let mut ms = 1_700_000_000_000u64;
        frame(&mut sim.borrow_mut().mem, 1, [0.1, 0.2, -1.0, 0.4]);
        rec.tick(ms);
        // The sim goes away and comes back with a zero map first.
        let saved = sim.borrow().mem.clone();
        sim.borrow_mut().mem = vec![0u8; 8192];
        ms += 1500; // past the liveness check
        assert_eq!(rec.tick(ms), WAITING);
        assert!(rec.open.is_none(), "the old view is dropped");
        sim.borrow_mut().mem = saved;
        frame(&mut sim.borrow_mut().mem, 50, [0.1, 0.2, -1.0, 0.4]);
        ms += 1500;
        rec.tick(ms);
        rec.tick(ms + 600);
        assert!(rec.open.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Records the real sim for a minute into a temp folder and prints what it
    /// wrote, extrapolated per hour. iRacing must be running with a car on
    /// track: `cargo test live_iracing_minute -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_iracing_minute() {
        use crate::capture::win::IrShm;
        // IR_LIVE_SECONDS (default 60) sets how long; IR_LIVE_KEEP=<folder>
        // records into that folder and keeps it (a real run to compare with an
        // .ibt), with real wall-clock times.
        let secs: u64 = std::env::var("IR_LIVE_SECONDS").ok().and_then(|v| v.parse().ok()).unwrap_or(60);
        let keep = std::env::var_os("IR_LIVE_KEEP").map(PathBuf::from);
        let root = keep.clone().unwrap_or_else(|| {
            std::env::temp_dir().join(format!("ir-live-{}", std::process::id()))
        });
        if keep.is_none() {
            let _ = std::fs::remove_dir_all(&root);
        }
        let mut rec = IrRecorder::new(IrShm::new(), root.clone());
        let started = std::time::Instant::now();
        let base_ms = if keep.is_some() {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(1_000_000, |d| d.as_millis() as u64)
        } else {
            1_000_000u64
        };
        while started.elapsed() < Duration::from_secs(secs) {
            let ms = base_ms + started.elapsed().as_millis() as u64;
            let wait = rec.tick(ms);
            rec.src().wait(wait);
        }
        rec.shutdown(base_ms + secs * 1000 + 1000);
        let started_ms = base_ms;
        let _ = started_ms;
        let bytes = dir_bytes(&root);
        println!("state {} ({}), wrote {} bytes in {} s = {:.0} MB per hour",
            rec.status.state, rec.status.reason, bytes, secs, bytes as f64 * 3600.0 / secs as f64 / 1e6);
        for dir in captures(&root) {
            println!("{}", std::fs::read_to_string(dir.join("meta.json")).unwrap_or_default());
        }
        assert!(bytes > 0, "nothing was recorded: is a car on track?");
        if keep.is_none() {
            let _ = std::fs::remove_dir_all(&root);
        }
    }
}
