// One capture on disk, as tools/capture/capture.py writes it:
//
//   <root>/<startUtc>_<track>_<session>/
//     meta.json              at the start, and again at the end with endUtc
//     player-0000.parquet    the player car, one row per telemetry frame (~100 Hz)
//     field-0000.parquet     every car, one row per car per scoring update (5 Hz)
//     session-0000.parquet   one row per scoring update: flags, weather, phase
//
// A chunk is written to a .tmp file and renamed, so a crash leaves only whole
// chunks. meta.json without endUtc means the recorder did not finish: the
// uploader treats that capture as cut short, not as ended.

use crate::capture::columns::{columns, float32_field, float32_player, write_parquet, Column};
use crate::capture::layout::Layout;
use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const VERSION: u64 = 1;
/// Text kept per field row: which car is which. Driver names stay on this PC;
/// the uploader does not send them.
const FIELD_TEXT: [&str; 3] = ["mVehicleName", "mVehicleClass", "mDriverName"];
/// Text kept per player row: the tyre compound names, the only way to tell
/// soft from medium or a wet.
const PLAYER_TEXT: [&str; 2] = ["mFrontTireCompoundName", "mRearTireCompoundName"];

pub fn iso(ms: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms as i64)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

fn stamp(ms: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms as i64)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H-%M-%SZ")
        .to_string()
}

/// "Michelin Raceway Road Atlanta" -> "michelin-raceway-road-atlanta".
pub fn slug(value: &str) -> String {
    let mut out = String::new();
    for c in value.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "unknown".into()
    } else {
        out
    }
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Bytes under `root`, for the status file.
pub fn dir_bytes(root: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            match entry.metadata() {
                Ok(m) if m.is_dir() => stack.push(entry.path()),
                Ok(m) => total += m.len(),
                Err(_) => {}
            }
        }
    }
    total
}

pub struct Capture {
    pub dir: PathBuf,
    pub meta: Map<String, Value>,
    pub bytes: u64,
    chunk_started_ms: u64,
    chunks: u64,
    player_raw: Vec<u8>,
    player_ms: Vec<i64>,
    field_raw: Vec<u8>,
    field_ms: Vec<i64>,
    field_et: Vec<f64>,
    field_update: Vec<i64>,
    session_raw: Vec<u8>,
    session_ms: Vec<i64>,
    updates: i64,
}

impl Capture {
    /// `meta`: track, session, gameVersion and whatever else is known at the start.
    pub fn new(
        root: &Path,
        layout: &Layout,
        meta: Map<String, Value>,
        start_ms: u64,
    ) -> Result<Capture, String> {
        let track = meta.get("track").and_then(Value::as_str).unwrap_or("");
        let session = meta.get("session").and_then(Value::as_i64).unwrap_or(0);
        let dir = root.join(format!("{}_{}_{session}", stamp(start_ms), slug(track)));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut all = Map::new();
        all.insert("version".into(), json!(VERSION));
        all.insert("startUtc".into(), json!(iso(start_ms)));
        all.insert("endUtc".into(), Value::Null);
        all.insert("chunks".into(), json!(0));
        all.insert("headerHash".into(), json!(layout.hash));
        all.insert("layoutBytes".into(), json!(layout.size));
        all.insert("suspectFrames".into(), json!(0));
        // Player frames missed between two reads (a step in mElapsedTime above
        // 1.5 x the 10 ms period, under 1 s), so a loss shows up as a number.
        all.insert("missedFrames".into(), json!(0));
        all.insert("playerFrames".into(), json!(0));
        // The same for scoring updates (5 Hz): written, and missed by the clock.
        all.insert("scoringUpdates".into(), json!(0));
        all.insert("missedUpdates".into(), json!(0));
        // Car id -> model, from the telemetry slots (the field upload labels
        // cars with this, never with the entry name).
        all.insert("vehicleModels".into(), json!({}));
        all.extend(meta);
        let cap = Capture {
            dir,
            meta: all,
            bytes: 0,
            chunk_started_ms: start_ms,
            chunks: 0,
            player_raw: Vec::new(),
            player_ms: Vec::new(),
            field_raw: Vec::new(),
            field_ms: Vec::new(),
            field_et: Vec::new(),
            field_update: Vec::new(),
            session_raw: Vec::new(),
            session_ms: Vec::new(),
            updates: 0,
        };
        cap.write_meta()?;
        Ok(cap)
    }

    fn write_meta(&self) -> Result<(), String> {
        write_json(
            &self.dir.join("meta.json"),
            &Value::Object(self.meta.clone()),
        )
    }

    pub fn note_suspect(&mut self) {
        let n = self
            .meta
            .get("suspectFrames")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        self.meta.insert("suspectFrames".into(), json!(n + 1));
    }

    /// Adds to a counter in meta.json (rewritten with the next chunk).
    pub fn count(&mut self, key: &str, n: u64) {
        let now = self.meta.get(key).and_then(Value::as_u64).unwrap_or(0);
        self.meta.insert(key.into(), json!(now + n));
    }

    /// Car id -> model; adds the ones not known yet.
    pub fn models(&mut self) -> &mut Map<String, Value> {
        self.meta
            .get_mut("vehicleModels")
            .and_then(Value::as_object_mut)
            .expect("vehicleModels is an object")
    }

    pub fn add_player(&mut self, raw: &[u8], ms: u64) {
        self.player_raw.extend_from_slice(raw);
        self.player_ms.push(ms as i64);
    }

    pub fn add_scoring(&mut self, info: &[u8], vehicles: &[u8], n: usize, et: f64, ms: u64) {
        self.session_raw.extend_from_slice(info);
        self.session_ms.push(ms as i64);
        self.field_raw.extend_from_slice(vehicles);
        self.field_ms.extend(std::iter::repeat(ms as i64).take(n));
        self.field_et.extend(std::iter::repeat(et).take(n));
        self.field_update
            .extend(std::iter::repeat(self.updates).take(n));
        self.updates += 1;
    }

    #[cfg(test)]
    pub fn player_rows(&self) -> usize {
        self.player_ms.len()
    }

    pub fn due(&self, ms: u64, every_ms: u64) -> bool {
        ms.saturating_sub(self.chunk_started_ms) >= every_ms
    }

    /// Writes the open chunk if it holds anything; returns the bytes written.
    /// On an error the buffered rows are dropped, earlier chunks stay.
    pub fn flush(&mut self, layout: &Layout, ms: u64) -> Result<u64, String> {
        if self.player_ms.is_empty() && self.session_ms.is_empty() {
            return Ok(0);
        }
        let result = self.write_chunk(layout);
        self.reset();
        self.chunk_started_ms = ms;
        let written = result?;
        self.chunks += 1;
        self.meta.insert("chunks".into(), json!(self.chunks));
        // Rewritten per chunk, so a capture cut short still has its car models.
        self.write_meta()?;
        self.bytes += written;
        Ok(written)
    }

    fn write_chunk(&self, layout: &Layout) -> Result<u64, String> {
        let n = self.chunks;
        let none: HashSet<String> = HashSet::new();
        let mut written = 0;
        let parts: [(&str, &str, &Vec<u8>, &[&str], &HashSet<String>); 3] = [
            (
                "player",
                "TelemInfoV01",
                &self.player_raw,
                &PLAYER_TEXT,
                float32_player(),
            ),
            ("session", "ScoringInfoV01", &self.session_raw, &[], &none),
            (
                "field",
                "VehicleScoringInfoV01",
                &self.field_raw,
                &FIELD_TEXT,
                float32_field(),
            ),
        ];
        for (name, strukt, raw, text, narrow) in parts {
            if raw.is_empty() {
                continue;
            }
            let mut cols = columns(layout, strukt, raw, text, narrow)?;
            let wall = match name {
                "player" => &self.player_ms,
                "session" => &self.session_ms,
                _ => &self.field_ms,
            };
            cols.insert("wall_ms".into(), Column::I64(wall.clone()));
            if name == "field" {
                cols.insert("et".into(), Column::F64(self.field_et.clone()));
                cols.insert("update".into(), Column::I64(self.field_update.clone()));
            }
            let path = self.dir.join(format!("{name}-{n:04}.parquet"));
            write_parquet(&path, layout, strukt, &cols)?;
            written += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        }
        Ok(written)
    }

    fn reset(&mut self) {
        self.player_raw.clear();
        self.player_ms.clear();
        self.field_raw.clear();
        self.field_ms.clear();
        self.field_et.clear();
        self.field_update.clear();
        self.session_raw.clear();
        self.session_ms.clear();
        self.updates = 0;
    }

    /// Flushes and marks the capture finished; returns the bytes written.
    pub fn close(&mut self, layout: &Layout, ms: u64) -> Result<u64, String> {
        let written = self.flush(layout, ms)?;
        self.meta.insert("endUtc".into(), json!(iso(ms)));
        self.write_meta()?;
        Ok(written)
    }
}
