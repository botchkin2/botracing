// An iRacing capture on disk, in the folder shape the LMU recorder writes:
//
//   <root>/<startUtc>_<track>_<session>/
//     meta.json              at the start, and again with each chunk and at the end
//     player-0000.parquet    the player car, one row per tick (60 Hz)
//     field-0000.parquet     every racing car, one row per car per update (5 Hz)
//     session-0000.parquet   one row per update: clock, flags, weather
//
// Columns carry iRacing's own variable names (an adapter maps them, as it does
// for the .ibt). A chunk is written to a .tmp file and renamed, so a crash
// leaves whole chunks only. meta.json without endUtc means the recorder did
// not finish. Nothing here holds a name or id of a person: ir_session.rs
// decides what is kept.

use crate::capture::columns::{write_columns, Column};
use crate::capture::store::{iso, slug, write_json};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const VERSION: u64 = 1;

/// Columns of one stream, appended row by row. A column is created by its
/// first row; a variable the sim does not publish never appears.
#[derive(Default)]
pub struct Rows {
    cols: BTreeMap<String, Column>,
    n: usize,
}

impl Rows {
    pub fn len(&self) -> usize {
        self.n
    }

    /// Adds one row. Every row of a stream must name the same columns.
    pub fn push(&mut self, row: Vec<(String, Cell)>) {
        for (name, cell) in row {
            match (self.cols.entry(name).or_insert_with(|| cell.empty()), cell) {
                (Column::F32(v), Cell::F32(x)) => v.push(x),
                (Column::F64(v), Cell::F64(x)) => v.push(x),
                (Column::I64(v), Cell::I64(x)) => v.push(x),
                (Column::Bool(v), Cell::Bool(x)) => v.push(x),
                _ => {}
            }
        }
        self.n += 1;
    }

    fn take(&mut self) -> (BTreeMap<String, Column>, usize) {
        (std::mem::take(&mut self.cols), std::mem::take(&mut self.n))
    }
}

pub enum Cell {
    F32(f32),
    F64(f64),
    I64(i64),
    Bool(bool),
}

impl Cell {
    fn empty(&self) -> Column {
        match self {
            Cell::F32(_) => Column::F32(Vec::new()),
            Cell::F64(_) => Column::F64(Vec::new()),
            Cell::I64(_) => Column::I64(Vec::new()),
            Cell::Bool(_) => Column::Bool(Vec::new()),
        }
    }
}

pub struct IrCapture {
    pub dir: PathBuf,
    pub meta: Map<String, Value>,
    pub bytes: u64,
    chunk_started_ms: u64,
    chunks: u64,
    pub player: Rows,
    pub field: Rows,
    pub session: Rows,
}

impl IrCapture {
    /// `meta`: what ir_session.rs kept of the session text.
    pub fn new(root: &Path, meta: Map<String, Value>, start_ms: u64) -> Result<IrCapture, String> {
        let track = meta.get("track").and_then(Value::as_str).unwrap_or("");
        let session = meta.get("sessionNum").and_then(Value::as_i64).unwrap_or(0);
        let stamp = iso(start_ms).replace(':', "-");
        let stamp = stamp.split('.').next().unwrap_or(&stamp).to_string() + "Z";
        let dir = root.join(format!("{stamp}_{}_{session}", slug(track)));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut all = Map::new();
        all.insert("version".into(), json!(VERSION));
        all.insert("sim".into(), json!("iracing"));
        all.insert("startUtc".into(), json!(iso(start_ms)));
        all.insert("endUtc".into(), Value::Null);
        all.insert("chunks".into(), json!(0));
        all.insert("playerRows".into(), json!(0));
        all.insert("fieldUpdates".into(), json!(0));
        all.extend(meta);
        let cap = IrCapture {
            dir,
            meta: all,
            bytes: 0,
            chunk_started_ms: start_ms,
            chunks: 0,
            player: Rows::default(),
            field: Rows::default(),
            session: Rows::default(),
        };
        cap.write_meta()?;
        Ok(cap)
    }

    fn write_meta(&self) -> Result<(), String> {
        write_json(&self.dir.join("meta.json"), &Value::Object(self.meta.clone()))
    }

    /// Adds to a counter in meta.json (rewritten with the next chunk).
    pub fn count(&mut self, key: &str, n: u64) {
        let now = self.meta.get(key).and_then(Value::as_u64).unwrap_or(0);
        self.meta.insert(key.into(), json!(now + n));
    }

    pub fn due(&self, ms: u64, every_ms: u64) -> bool {
        ms.saturating_sub(self.chunk_started_ms) >= every_ms
    }

    /// Writes the open chunk if it holds anything; returns the bytes written.
    /// On an error the buffered rows are dropped, earlier chunks stay.
    pub fn flush(&mut self, ms: u64) -> Result<u64, String> {
        if self.player.len() == 0 && self.field.len() == 0 && self.session.len() == 0 {
            return Ok(0);
        }
        let n = self.chunks;
        let mut written = 0;
        let mut failure = None;
        for (name, rows) in [
            ("player", &mut self.player),
            ("field", &mut self.field),
            ("session", &mut self.session),
        ] {
            let (cols, count) = rows.take();
            if count == 0 {
                continue;
            }
            let path = self.dir.join(format!("{name}-{n:04}.parquet"));
            let ordered: Vec<(String, Column)> = cols.into_iter().collect();
            match write_columns(&path, &ordered) {
                Ok(()) => written += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                Err(e) => failure = Some(e),
            }
        }
        self.chunk_started_ms = ms;
        if let Some(e) = failure {
            return Err(e);
        }
        self.chunks += 1;
        self.meta.insert("chunks".into(), json!(self.chunks));
        self.write_meta()?;
        self.bytes += written;
        Ok(written)
    }

    /// Flushes and marks the capture finished.
    pub fn close(&mut self, ms: u64) -> Result<u64, String> {
        let written = self.flush(ms)?;
        self.meta.insert("endUtc".into(), json!(iso(ms)));
        self.write_meta()?;
        Ok(written)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ir-store-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn rows_in(path: &Path) -> (usize, Vec<String>) {
        let file = std::fs::File::open(path).unwrap();
        let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
        let names = builder.schema().fields().iter().map(|f| f.name().clone()).collect();
        let n = builder.build().unwrap().map(|b| b.unwrap().num_rows()).sum();
        (n, names)
    }

    #[test]
    fn writes_chunks_in_the_lmu_shape_and_marks_the_end() {
        let root = scratch("shape");
        let mut meta = Map::new();
        meta.insert("track".into(), json!("Road Atlanta"));
        meta.insert("sessionNum".into(), json!(2));
        let mut cap = IrCapture::new(&root, meta, 1_700_000_000_000).unwrap();
        assert!(cap.dir.file_name().unwrap().to_str().unwrap().ends_with("_road-atlanta_2"));
        for i in 0..3 {
            cap.player.push(vec![
                ("wall_ms".into(), Cell::I64(i)),
                ("Speed".into(), Cell::F32(i as f32)),
                ("OnPitRoad".into(), Cell::Bool(false)),
            ]);
        }
        cap.field.push(vec![("CarIdx".into(), Cell::I64(4)), ("LapDistPct".into(), Cell::F32(0.5))]);
        cap.session.push(vec![("SessionTime".into(), Cell::F64(12.5))]);
        let meta_text = std::fs::read_to_string(cap.dir.join("meta.json")).unwrap();
        assert!(meta_text.contains("\"endUtc\": null"));
        assert!(cap.flush(60_000).unwrap() > 0);
        let (n, names) = rows_in(&cap.dir.join("player-0000.parquet"));
        assert_eq!(n, 3);
        assert_eq!(names, vec!["OnPitRoad", "Speed", "wall_ms"]);
        assert_eq!(rows_in(&cap.dir.join("field-0000.parquet")).0, 1);
        assert_eq!(rows_in(&cap.dir.join("session-0000.parquet")).0, 1);
        // The next chunk numbers on; an empty flush writes nothing.
        assert_eq!(cap.flush(120_000).unwrap(), 0);
        cap.player.push(vec![("Speed".into(), Cell::F32(9.0))]);
        cap.close(1_700_000_130_000).unwrap();
        assert!(cap.dir.join("player-0001.parquet").exists());
        let end = std::fs::read_to_string(cap.dir.join("meta.json")).unwrap();
        assert!(end.contains("\"endUtc\": \"2023-11-14T22:15:30.000Z\""), "{end}");
        assert!(end.contains("\"chunks\": 2"));
        assert!(!cap.dir.join("player-0000.parquet.tmp").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
