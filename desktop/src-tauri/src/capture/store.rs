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
//
// Chunks are written on a writer thread of their own. Shared memory holds only
// the latest frame, so a recorder that stops to write a chunk (80 to 100 ms of
// zstd) loses every frame the game publishes meanwhile: 8 to 10 player frames
// at each 60 s rotation on the 3 Oct race (pit-wall thread 66). `flush` hands
// the full buffers over and returns at once; `close` waits for the last one.

use crate::capture::columns::{columns, float32_field, float32_player, write_parquet, Column};
use crate::capture::layout::Layout;
use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;

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
    if out.is_empty() { "unknown".into() } else { out }
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
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
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

/// One chunk's rows, moved whole to the writer thread.
#[derive(Default)]
struct Rows {
    player_raw: Vec<u8>,
    player_ms: Vec<i64>,
    field_raw: Vec<u8>,
    field_ms: Vec<i64>,
    field_et: Vec<f64>,
    field_update: Vec<i64>,
    session_raw: Vec<u8>,
    session_ms: Vec<i64>,
}

impl Rows {
    fn is_empty(&self) -> bool {
        self.player_ms.is_empty() && self.session_ms.is_empty()
    }
}

/// One chunk's write: its files, then meta.json; returns the bytes written.
pub type Job = Box<dyn FnOnce() -> Result<u64, String> + Send>;

/// The thread that writes a capture's chunks, in order, so the poll that
/// reads the game never waits for a disk (LMU and iRacing alike).
pub struct ChunkWriter {
    jobs: Option<Sender<Job>>,
    done: Receiver<Result<u64, String>>,
    thread: Option<JoinHandle<()>>,
    /// Jobs handed over whose result has not been read yet.
    pending: usize,
}

impl ChunkWriter {
    /// `delay_ms`: the writer sleeps that long before each job (tests: a slow disk).
    pub fn start(delay_ms: u64) -> Result<ChunkWriter, String> {
        let (jobs, inbox) = channel::<Job>();
        let (report, done) = channel();
        let thread = std::thread::Builder::new()
            .name("capture-writer".into())
            .spawn(move || {
                // Below the game, like the recorder threads.
                #[cfg(windows)]
                crate::capture::win::lower_priority();
                for job in inbox {
                    if delay_ms > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    }
                    if report.send(job()).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(ChunkWriter { jobs: Some(jobs), done, thread: Some(thread), pending: 0 })
    }

    pub fn send(&mut self, job: Job) -> Result<(), String> {
        let stopped = || "the capture writer has stopped".to_string();
        let jobs = self.jobs.as_ref().ok_or_else(stopped)?;
        jobs.send(job).map_err(|_| stopped())?;
        self.pending += 1;
        Ok(())
    }

    /// Bytes of the jobs finished since the last call, without waiting; the
    /// first error, if any.
    pub fn finished(&mut self) -> Result<u64, String> {
        self.collect(false)
    }

    /// Waits for every job handed over; bytes and the first error as above.
    pub fn settle(&mut self) -> Result<u64, String> {
        self.collect(true)
    }

    fn collect(&mut self, wait: bool) -> Result<u64, String> {
        let mut bytes = 0;
        let mut failure = None;
        while self.pending > 0 {
            let next = if wait { self.done.recv().ok() } else { self.done.try_recv().ok() };
            let Some(result) = next else { break };
            self.pending -= 1;
            match result {
                Ok(b) => bytes += b,
                Err(e) => failure = failure.or(Some(e)),
            }
        }
        if wait {
            // A writer that died leaves nothing more to wait for.
            self.pending = 0;
        }
        failure.map_or(Ok(bytes), Err)
    }

    /// Waits for every job, then stops the thread.
    pub fn finish(&mut self) -> Result<u64, String> {
        let result = self.settle();
        self.jobs = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        result
    }
}

pub struct Capture {
    pub dir: PathBuf,
    pub meta: Map<String, Value>,
    pub bytes: u64,
    chunk_started_ms: u64,
    chunks: u64,
    rows: Rows,
    updates: i64,
    layout: Arc<Layout>,
    writer: ChunkWriter,
}

impl Capture {
    /// `meta`: track, session, gameVersion and whatever else is known at the start.
    pub fn new(root: &Path, layout: &Arc<Layout>, meta: Map<String, Value>, start_ms: u64) -> Result<Capture, String> {
        Capture::with_delay(root, layout, meta, start_ms, 0)
    }

    /// `delay_ms`: the writer sleeps that long before each chunk (tests: a slow disk).
    pub fn with_delay(
        root: &Path,
        layout: &Arc<Layout>,
        meta: Map<String, Value>,
        start_ms: u64,
        delay_ms: u64,
    ) -> Result<Capture, String> {
        let track = meta.get("track").and_then(Value::as_str).unwrap_or("");
        let session = meta.get("session").and_then(Value::as_i64).unwrap_or(0);
        let dir = root.join(format!("{}_{}_{session}", stamp(start_ms), slug(track)));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut all = Map::new();
        all.insert("version".into(), json!(VERSION));
        // The tray that recorded it: a recorder bug is then a version range,
        // not a guess from the data (brokenWheels.mjs, pit wall #5405).
        all.insert("recorderVersion".into(), json!(env!("CARGO_PKG_VERSION")));
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
        let writer = ChunkWriter::start(delay_ms)?;
        let cap = Capture {
            dir,
            meta: all,
            bytes: 0,
            chunk_started_ms: start_ms,
            chunks: 0,
            rows: Rows::default(),
            updates: 0,
            layout: layout.clone(),
            writer,
        };
        cap.write_meta()?;
        Ok(cap)
    }

    fn write_meta(&self) -> Result<(), String> {
        write_json(&self.dir.join("meta.json"), &Value::Object(self.meta.clone()))
    }

    /// The layout check did not like what it read. The capture is kept (a
    /// layout fix can re-read it) but nothing uses it: tools/sessions skips a
    /// capture with this mark.
    pub fn mark_layout_suspect(&mut self, reason: &str) {
        self.meta.entry("layoutSuspect").or_insert_with(|| json!(reason));
        // On disk now: a drive that stops after this still carries the mark.
        let _ = self.write_meta();
    }

    pub fn note_suspect(&mut self) {
        let n = self.meta.get("suspectFrames").and_then(Value::as_u64).unwrap_or(0);
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
        self.rows.player_raw.extend_from_slice(raw);
        self.rows.player_ms.push(ms as i64);
    }

    pub fn add_scoring(&mut self, info: &[u8], vehicles: &[u8], n: usize, et: f64, ms: u64) {
        let r = &mut self.rows;
        r.session_raw.extend_from_slice(info);
        r.session_ms.push(ms as i64);
        r.field_raw.extend_from_slice(vehicles);
        r.field_ms.extend(std::iter::repeat(ms as i64).take(n));
        r.field_et.extend(std::iter::repeat(et).take(n));
        r.field_update.extend(std::iter::repeat(self.updates).take(n));
        self.updates += 1;
    }

    #[cfg(test)]
    pub fn player_rows(&self) -> usize {
        self.rows.player_ms.len()
    }

    pub fn due(&self, ms: u64, every_ms: u64) -> bool {
        ms.saturating_sub(self.chunk_started_ms) >= every_ms
    }

    /// Hands the open chunk to the writer thread if it holds anything, and
    /// returns at once. Returns the bytes of the chunks the writer finished
    /// since the last call, or the first error it met (that chunk's rows are
    /// gone, earlier chunks stay).
    pub fn flush(&mut self, ms: u64) -> Result<u64, String> {
        let finished = self.writer.finished();
        if !self.rows.is_empty() {
            let n = self.chunks;
            self.chunks += 1;
            self.meta.insert("chunks".into(), json!(self.chunks));
            let rows = std::mem::take(&mut self.rows);
            self.updates = 0;
            let (dir, layout, meta) = (self.dir.clone(), self.layout.clone(), self.meta.clone());
            self.writer.send(Box::new(move || {
                let bytes = write_chunk(&dir, &layout, n, &rows)?;
                // Rewritten per chunk, so a capture cut short still has its car models.
                write_json(&dir.join("meta.json"), &Value::Object(meta))?;
                Ok(bytes)
            }))?;
        }
        self.chunk_started_ms = ms;
        let written = finished?;
        self.bytes += written;
        Ok(written)
    }

    /// Bytes of the chunks the writer finished since the last call, or its
    /// first error; never waits. The recorder asks on every poll, so a failed
    /// write is known as soon as it happens, not at the next rotation.
    pub fn written(&mut self) -> Result<u64, String> {
        let written = self.writer.finished()?;
        self.bytes += written;
        Ok(written)
    }

    /// Flushes, waits for the writer, and marks the capture finished; returns
    /// the bytes written since the last flush.
    pub fn close(&mut self, ms: u64) -> Result<u64, String> {
        let before = self.flush(ms)?;
        let rest = self.writer.finish()?;
        self.bytes += rest;
        self.meta.insert("endUtc".into(), json!(iso(ms)));
        self.write_meta()?;
        Ok(before + rest)
    }
}

impl Drop for Capture {
    /// A capture dropped without close (the recorder refused it) still lets
    /// its writer finish what it was given.
    fn drop(&mut self) {
        let _ = self.writer.finish();
    }
}

fn write_chunk(dir: &Path, layout: &Layout, n: u64, rows: &Rows) -> Result<u64, String> {
    let none: HashSet<String> = HashSet::new();
    let mut written = 0;
    let parts: [(&str, &str, &Vec<u8>, &[&str], &HashSet<String>); 3] = [
        ("player", "TelemInfoV01", &rows.player_raw, &PLAYER_TEXT, float32_player()),
        ("session", "ScoringInfoV01", &rows.session_raw, &[], &none),
        ("field", "VehicleScoringInfoV01", &rows.field_raw, &FIELD_TEXT, float32_field()),
    ];
    for (name, strukt, raw, text, narrow) in parts {
        if raw.is_empty() {
            continue;
        }
        let mut cols = columns(layout, strukt, raw, text, narrow)?;
        let wall = match name {
            "player" => &rows.player_ms,
            "session" => &rows.session_ms,
            _ => &rows.field_ms,
        };
        cols.insert("wall_ms".into(), Column::I64(wall.clone()));
        if name == "field" {
            cols.insert("et".into(), Column::F64(rows.field_et.clone()));
            cols.insert("update".into(), Column::I64(rows.field_update.clone()));
        }
        let path = dir.join(format!("{name}-{n:04}.parquet"));
        write_parquet(&path, layout, strukt, &cols)?;
        written += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use std::time::{Duration, Instant};

    fn rows_in(path: &Path) -> usize {
        let file = std::fs::File::open(path).unwrap();
        let reader = ParquetRecordBatchReaderBuilder::try_new(file).unwrap().build().unwrap();
        reader.map(|b| b.unwrap().num_rows()).sum()
    }

    /// The fix for the frames lost at each rotation (pit-wall thread 66): with a
    /// disk that takes 200 ms per chunk, cutting a real-sized chunk (a minute
    /// of 100 Hz frames) costs the poll thread under 5 ms, less than one 10 ms
    /// frame, and every row still lands, in order.
    #[test]
    fn a_slow_disk_never_stalls_the_poll_and_every_row_lands() {
        let layout = Arc::new(Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap());
        let root = std::env::temp_dir().join(format!("botracing-writer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut meta = Map::new();
        meta.insert("track".into(), json!("Writer Raceway"));
        meta.insert("session".into(), json!(10));
        let mut cap = Capture::with_delay(&root, &layout, meta, 0, 200).unwrap();
        let mut seed = 0x9E37_79B9_7F4A_7C15_u64;
        let mut noise = |n: usize| -> Vec<u8> {
            (0..n)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    seed as u8
                })
                .collect()
        };
        const FRAMES: usize = 6_000;
        const UPDATES: usize = 300;
        let mut slowest = Duration::ZERO;
        for chunk in 0..3u64 {
            for i in 0..FRAMES {
                cap.add_player(&noise(layout.telem_size), chunk * 60_000 + i as u64 * 10);
            }
            for i in 0..UPDATES {
                let ms = chunk * 60_000 + i as u64 * 200;
                cap.add_scoring(&noise(layout.scoring_size), &noise(layout.veh_size), 1, ms as f64 / 1000.0, ms);
            }
            let t = Instant::now();
            cap.flush((chunk + 1) * 60_000).unwrap();
            slowest = slowest.max(t.elapsed());
        }
        assert!(slowest < Duration::from_millis(5), "flush held the poll for {slowest:?}");
        let t = Instant::now();
        cap.close(180_000).unwrap();
        // close waits for the writer: three chunks at 200 ms each, at least.
        assert!(t.elapsed() >= Duration::from_millis(400), "close returned before the writer finished");
        for n in 0..3 {
            assert_eq!(rows_in(&cap.dir.join(format!("player-{n:04}.parquet"))), FRAMES);
            assert_eq!(rows_in(&cap.dir.join(format!("session-{n:04}.parquet"))), UPDATES);
            assert_eq!(rows_in(&cap.dir.join(format!("field-{n:04}.parquet"))), UPDATES);
        }
        let end = std::fs::read_to_string(cap.dir.join("meta.json")).unwrap();
        assert!(end.contains("\"chunks\": 3"), "{end}");
        assert!(!end.contains("\"endUtc\": null"), "{end}");
        assert!(cap.bytes > 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A write error still reaches the recorder, from the next flush or close.
    #[test]
    fn a_failed_chunk_is_reported() {
        let layout = Arc::new(Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap());
        let root = std::env::temp_dir().join(format!("botracing-writer-err-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut meta = Map::new();
        meta.insert("track".into(), json!("Gone Raceway"));
        let mut cap = Capture::new(&root, &layout, meta, 0).unwrap();
        cap.add_player(&vec![0; layout.telem_size], 0);
        // The player file name is taken by a folder, the way a full disk fails a write.
        std::fs::create_dir_all(cap.dir.join("player-0000.parquet")).unwrap();
        cap.flush(60_000).unwrap();
        assert!(cap.close(120_000).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
