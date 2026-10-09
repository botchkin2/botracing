// Raw struct bytes to named columns, one chunk at a time.
//
// Names and the float32-when-exact rule match tools/capture/columns.py.
// Filler the analysis never reads is left out. Char buffers become text only
// when the caller names them; everything else stays numeric.

use crate::capture::layout::{Kind, Layout, Struct};
use arrow_array::{
    ArrayRef, BooleanArray, Float32Array, Float64Array, Int16Array, Int32Array, Int64Array,
    Int8Array, RecordBatch, StringArray, UInt16Array, UInt32Array, UInt64Array, UInt8Array,
};
use arrow_schema::{DataType, Field, Schema};
use parquet::arrow::ArrowWriter;
use parquet::basic::{Compression, Encoding, ZstdLevel};
use parquet::file::properties::WriterProperties;
use parquet::schema::types::ColumnPath;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

const WHEELS: [&str; 4] = ["fl", "fr", "rl", "rr"];
const SKIP_PREFIXES: [&str; 4] = [
    "mExpansion",
    "mUnused",
    "mUpgradePack",
    "mPhysicsToGraphicsOffset",
];

/// Doubles the game fills with float32 values. Stored as float32 only when
/// that loses nothing, so a game update cannot cost precision.
pub fn float32_player() -> &'static HashSet<String> {
    use std::sync::OnceLock;
    static NAMES: OnceLock<HashSet<String>> = OnceLock::new();
    NAMES.get_or_init(|| {
        let mut names = HashSet::new();
        for wheel in WHEELS {
            for n in ["GripFract", "LateralForce", "LongitudinalForce", "TireLoad", "Wear"] {
                names.insert(format!("{wheel}_m{n}"));
            }
        }
        for n in [
            "mBatteryChargeFraction", "mDeltaTime", "mDrag", "mElectricBoostMotorRPM",
            "mElectricBoostMotorTemperature", "mElectricBoostMotorTorque",
            "mElectricBoostWaterTemperature", "mEngineMaxRPM", "mEngineTorque", "mFilteredBrake",
            "mFilteredSteering", "mFrontDownforce", "mFrontRideHeight", "mFrontWingHeight",
            "mFuelCapacity", "mLapStartET", "mLastImpactET", "mLastImpactMagnitude",
            "mRearDownforce", "mRearRideHeight", "mTurboBoostPressure", "mUnfilteredBrake",
            "mUnfilteredClutch", "mUnfilteredSteering", "mUnfilteredThrottle",
        ] {
            names.insert(n.to_string());
        }
        for axis in ["x", "y", "z"] {
            names.insert(format!("mLastImpactPos_{axis}"));
            for n in ["mLocalAccel", "mLocalRotAccel", "mLocalRot", "mLocalVel", "mPos"] {
                names.insert(format!("{n}_{axis}"));
            }
        }
        for row in 0..3 {
            for axis in ["x", "y", "z"] {
                names.insert(format!("mOri_{row}_{axis}"));
            }
        }
        names
    })
}

/// Field-row doubles the game fills with float32. Same rule as the player set.
pub fn float32_field() -> &'static HashSet<String> {
    use std::sync::OnceLock;
    static NAMES: OnceLock<HashSet<String>> = OnceLock::new();
    NAMES.get_or_init(|| {
        let mut names = HashSet::new();
        for n in [
            "mBestLapTime", "mBestSector1", "mBestSector2", "mCurSector1", "mCurSector2",
            "mEstimatedLapTime", "mLapDist", "mLapStartET", "mLastLapTime", "mLastSector1",
            "mLastSector2", "mPathLateral", "mTimeBehindLeader", "mTimeBehindNext",
            "mTimeIntoLap", "mTrackEdge",
        ] {
            names.insert(n.to_string());
        }
        for n in ["mLocalAccel", "mLocalRotAccel", "mLocalRot", "mLocalVel", "mPos"] {
            for axis in ["x", "y", "z"] {
                names.insert(format!("{n}_{axis}"));
            }
        }
        for row in 0..3 {
            for axis in ["x", "y", "z"] {
                names.insert(format!("mOri_{row}_{axis}"));
            }
        }
        names
    })
}

#[derive(Clone, Debug, PartialEq)]
pub enum Column {
    F64(Vec<f64>),
    F32(Vec<f32>),
    I64(Vec<i64>),
    Bool(Vec<bool>),
    Text(Vec<String>),
}

pub fn decode_text(raw: &[u8]) -> String {
    let body = raw.split(|b| *b == 0).next().unwrap_or(raw);
    String::from_utf8(body.to_vec()).unwrap_or_else(|_| body.iter().map(|b| *b as char).collect())
}

/// `{column: values}` for `raw`, which is `rows` of `struct_name` laid end to end.
pub fn columns(
    layout: &Layout,
    struct_name: &str,
    raw: &[u8],
    text_fields: &[&str],
    narrow: &HashSet<String>,
) -> Result<HashMap<String, Column>, String> {
    let def = layout
        .built(struct_name)
        .ok_or_else(|| format!("struct {struct_name} was not built"))?;
    if def.size == 0 || raw.len() % def.size != 0 {
        return Err(format!(
            "{struct_name}: {} bytes is not a whole number of {}-byte structs",
            raw.len(),
            def.size
        ));
    }
    let rows = raw.len() / def.size;
    let mut out = HashMap::new();
    walk(layout, def, raw, def.size, rows, 0, "", &mut out)?;
    for name in text_fields {
        let Some(field) = def.fields.iter().find(|f| f.name == *name) else {
            continue;
        };
        let mut texts = Vec::with_capacity(rows);
        for row in 0..rows {
            let start = row * def.size + field.offset;
            let end = start + field.size;
            texts.push(decode_text(&raw[start..end]));
        }
        out.insert((*name).to_string(), Column::Text(texts));
    }
    narrow_exact(&mut out, narrow);
    Ok(out)
}

fn walk(
    layout: &Layout,
    def: &Struct,
    raw: &[u8],
    stride: usize,
    rows: usize,
    base: usize,
    prefix: &str,
    out: &mut HashMap<String, Column>,
) -> Result<(), String> {
    for field in &def.fields {
        if SKIP_PREFIXES.iter().any(|p| field.name.starts_with(p)) {
            continue;
        }
        let name = if prefix.is_empty() {
            field.name.clone()
        } else {
            format!("{prefix}_{}", field.name)
        };
        emit(layout, &field.kind, raw, stride, rows, base + field.offset, &name, out)?;
    }
    Ok(())
}

fn emit(
    layout: &Layout,
    kind: &Kind,
    raw: &[u8],
    stride: usize,
    rows: usize,
    offset: usize,
    name: &str,
    out: &mut HashMap<String, Column>,
) -> Result<(), String> {
    match kind {
        Kind::Struct(struct_name) => {
            let nested = layout
                .built(struct_name)
                .ok_or_else(|| format!("struct {struct_name} was not built"))?;
            walk(layout, nested, raw, stride, rows, offset, name, out)
        }
        Kind::Array(inner, n) => {
            let (elem, _) = crate::capture::layout::size_align(inner);
            if name == "mWheel" && *n == 4 {
                for i in 0..4 {
                    emit(layout, inner, raw, stride, rows, offset + i * elem, WHEELS[i], out)?;
                }
            } else {
                for i in 0..*n {
                    emit(
                        layout,
                        inner,
                        raw,
                        stride,
                        rows,
                        offset + i * elem,
                        &format!("{name}_{i}"),
                        out,
                    )?;
                }
            }
            Ok(())
        }
        Kind::Bytes(_) | Kind::Char => Ok(()),
        Kind::Pointer => Ok(()),
        Kind::F64 => {
            let mut values = Vec::with_capacity(rows);
            for row in 0..rows {
                values.push(f64::from_le_bytes(at(raw, row * stride + offset)?));
            }
            out.insert(name.to_string(), Column::F64(values));
            Ok(())
        }
        Kind::F32 => {
            let mut values = Vec::with_capacity(rows);
            for row in 0..rows {
                values.push(f32::from_le_bytes(at4(raw, row * stride + offset)?));
            }
            out.insert(name.to_string(), Column::F32(values));
            Ok(())
        }
        Kind::Bool => {
            let mut values = Vec::with_capacity(rows);
            for row in 0..rows {
                values.push(raw[row * stride + offset] != 0);
            }
            out.insert(name.to_string(), Column::Bool(values));
            Ok(())
        }
        Kind::I8 | Kind::U8 | Kind::I16 | Kind::U16 | Kind::I32 | Kind::U32 | Kind::I64 | Kind::U64 => {
            let mut values = Vec::with_capacity(rows);
            for row in 0..rows {
                values.push(read_int(kind, raw, row * stride + offset)?);
            }
            out.insert(name.to_string(), Column::I64(values));
            Ok(())
        }
    }
}

fn at(raw: &[u8], offset: usize) -> Result<[u8; 8], String> {
    raw.get(offset..offset + 8)
        .and_then(|s| s.try_into().ok())
        .ok_or_else(|| format!("read past the end at {offset}"))
}

fn at4(raw: &[u8], offset: usize) -> Result<[u8; 4], String> {
    raw.get(offset..offset + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or_else(|| format!("read past the end at {offset}"))
}

fn read_int(kind: &Kind, raw: &[u8], offset: usize) -> Result<i64, String> {
    Ok(match kind {
        Kind::I8 => raw[offset] as i8 as i64,
        Kind::U8 => raw[offset] as i64,
        Kind::I16 => i16::from_le_bytes(raw[offset..offset + 2].try_into().unwrap()) as i64,
        Kind::U16 => u16::from_le_bytes(raw[offset..offset + 2].try_into().unwrap()) as i64,
        Kind::I32 => i32::from_le_bytes(at4(raw, offset)?) as i64,
        Kind::U32 => u32::from_le_bytes(at4(raw, offset)?) as i64,
        Kind::I64 => i64::from_le_bytes(at(raw, offset)?),
        Kind::U64 => u64::from_le_bytes(at(raw, offset)?) as i64,
        _ => return Err(format!("not an integer: {kind:?}")),
    })
}

/// One chunk, temp file then rename. Floats use byte-stream-split. Integers
/// keep the header's width and do not. Text is dictionary-encoded.
pub fn write_parquet(
    path: &Path,
    layout: &Layout,
    struct_name: &str,
    cols: &HashMap<String, Column>,
) -> Result<(), String> {
    let def = layout
        .built(struct_name)
        .ok_or_else(|| format!("struct {struct_name} was not built"))?;
    let mut order = Vec::new();
    order_of(layout, def, "", &mut order);
    let tmp = Path::new(&format!("{}.tmp", path.display())).to_path_buf();
    let write = (|| {
        let mut fields = Vec::new();
        let mut arrays: Vec<ArrayRef> = Vec::new();
        // pyarrow's zstd default is level 1. A higher level writes less per
        // minute than the Python recorder and fills the disk faster.
        let mut props = WriterProperties::builder()
            .set_compression(Compression::ZSTD(ZstdLevel::try_new(1).expect("zstd level 1")))
            .set_dictionary_enabled(false);
        // wall_ms on every row; et and update on field rows. capture.py writes
        // these ahead of the struct columns.
        for name in ["wall_ms", "et", "update"] {
            let Some(col) = cols.get(name) else { continue };
            let kind = match col {
                Column::F64(_) | Column::F32(_) => Kind::F64,
                _ => Kind::I64,
            };
            let (dtype, array) = arrow_of(&kind, col)?;
            if matches!(dtype, DataType::Float32 | DataType::Float64) {
                props = props.set_column_encoding(ColumnPath::from(name), Encoding::BYTE_STREAM_SPLIT);
            }
            fields.push(Field::new(name, dtype, false));
            arrays.push(array);
        }
        for (name, kind) in &order {
            let Some(col) = cols.get(name) else { continue };
            let (dtype, array) = arrow_of(kind, col)?;
            if matches!(dtype, DataType::Float32 | DataType::Float64) {
                props = props.set_column_encoding(
                    ColumnPath::from(name.as_str()),
                    Encoding::BYTE_STREAM_SPLIT,
                );
            }
            if matches!(dtype, DataType::Utf8) {
                props = props.set_column_dictionary_enabled(ColumnPath::from(name.as_str()), true);
            }
            fields.push(Field::new(name, dtype, false));
            arrays.push(array);
        }
        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(schema.clone(), arrays).map_err(|e| e.to_string())?;
        if let Some(dir) = tmp.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let file = File::create(&tmp).map_err(|e| e.to_string())?;
        let mut writer =
            ArrowWriter::try_new(file, schema, Some(props.build())).map_err(|e| e.to_string())?;
        writer.write(&batch).map_err(|e| e.to_string())?;
        writer.close().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if write.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    write
}

/// One chunk of named columns, in the order given (no LMU struct behind it:
/// iRacing's variables are typed by the sim's own table). Same file rules as
/// `write_parquet`: zstd 1, floats byte-stream-split, temp file then rename.
pub fn write_columns(path: &Path, cols: &[(String, Column)]) -> Result<(), String> {
    let tmp = Path::new(&format!("{}.tmp", path.display())).to_path_buf();
    let write = (|| {
        let mut fields = Vec::new();
        let mut arrays: Vec<ArrayRef> = Vec::new();
        let mut props = WriterProperties::builder()
            .set_compression(Compression::ZSTD(ZstdLevel::try_new(1).expect("zstd level 1")))
            .set_dictionary_enabled(false);
        for (name, col) in cols {
            let kind = match col {
                Column::F64(_) => Kind::F64,
                Column::F32(_) => Kind::F32,
                Column::Bool(_) => Kind::Bool,
                Column::Text(_) => Kind::Char,
                Column::I64(_) => Kind::I64,
            };
            let (dtype, array) = arrow_of(&kind, col)?;
            if matches!(dtype, DataType::Float32 | DataType::Float64) {
                props = props.set_column_encoding(ColumnPath::from(name.as_str()), Encoding::BYTE_STREAM_SPLIT);
            }
            fields.push(Field::new(name, dtype, false));
            arrays.push(array);
        }
        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(schema.clone(), arrays).map_err(|e| e.to_string())?;
        if let Some(dir) = tmp.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let file = File::create(&tmp).map_err(|e| e.to_string())?;
        let mut writer =
            ArrowWriter::try_new(file, schema, Some(props.build())).map_err(|e| e.to_string())?;
        writer.write(&batch).map_err(|e| e.to_string())?;
        writer.close().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if write.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    write
}

fn order_of(layout: &Layout, def: &Struct, prefix: &str, out: &mut Vec<(String, Kind)>) {
    for field in &def.fields {
        if SKIP_PREFIXES.iter().any(|p| field.name.starts_with(p)) {
            continue;
        }
        let name = if prefix.is_empty() {
            field.name.clone()
        } else {
            format!("{prefix}_{}", field.name)
        };
        order_kind(layout, &field.kind, &name, out);
    }
}

fn order_kind(layout: &Layout, kind: &Kind, name: &str, out: &mut Vec<(String, Kind)>) {
    match kind {
        Kind::Struct(struct_name) => {
            if let Some(nested) = layout.built(struct_name) {
                order_of(layout, nested, name, out);
            }
        }
        Kind::Array(inner, n) => {
            let wheels = name == "mWheel" && *n == 4;
            for i in 0..*n {
                let child = if wheels { WHEELS[i].to_string() } else { format!("{name}_{i}") };
                order_kind(layout, inner, &child, out);
            }
        }
        Kind::Bytes(_) | Kind::Char => out.push((name.to_string(), kind.clone())),
        Kind::Pointer => {}
        other => out.push((name.to_string(), other.clone())),
    }
}

fn arrow_of(kind: &Kind, col: &Column) -> Result<(DataType, ArrayRef), String> {
    let array = match (kind, col) {
        (_, Column::F32(v)) => (DataType::Float32, Arc::new(Float32Array::from(v.clone())) as ArrayRef),
        (_, Column::F64(v)) => (DataType::Float64, Arc::new(Float64Array::from(v.clone())) as ArrayRef),
        (_, Column::Bool(v)) => (DataType::Boolean, Arc::new(BooleanArray::from(v.clone())) as ArrayRef),
        (_, Column::Text(v)) => (DataType::Utf8, Arc::new(StringArray::from(v.clone())) as ArrayRef),
        (Kind::I8, Column::I64(v)) => (DataType::Int8, Arc::new(Int8Array::from(v.iter().map(|n| *n as i8).collect::<Vec<_>>())) as ArrayRef),
        (Kind::U8, Column::I64(v)) => (DataType::UInt8, Arc::new(UInt8Array::from(v.iter().map(|n| *n as u8).collect::<Vec<_>>())) as ArrayRef),
        (Kind::I16, Column::I64(v)) => (DataType::Int16, Arc::new(Int16Array::from(v.iter().map(|n| *n as i16).collect::<Vec<_>>())) as ArrayRef),
        (Kind::U16, Column::I64(v)) => (DataType::UInt16, Arc::new(UInt16Array::from(v.iter().map(|n| *n as u16).collect::<Vec<_>>())) as ArrayRef),
        (Kind::I32, Column::I64(v)) => (DataType::Int32, Arc::new(Int32Array::from(v.iter().map(|n| *n as i32).collect::<Vec<_>>())) as ArrayRef),
        (Kind::U32, Column::I64(v)) => (DataType::UInt32, Arc::new(UInt32Array::from(v.iter().map(|n| *n as u32).collect::<Vec<_>>())) as ArrayRef),
        // The bits of a u64 are kept in the i64 column and written back unsigned.
        (Kind::U64, Column::I64(v)) => (DataType::UInt64, Arc::new(UInt64Array::from(v.iter().map(|n| *n as u64).collect::<Vec<_>>())) as ArrayRef),
        (Kind::I64, Column::I64(v)) => (DataType::Int64, Arc::new(Int64Array::from(v.clone())) as ArrayRef),
        _ => return Err(format!("cannot write {kind:?} from {col:?}")),
    };
    Ok(array)
}

fn narrow_exact(cols: &mut HashMap<String, Column>, names: &HashSet<String>) {
    for (name, col) in cols.iter_mut() {
        if !names.contains(name.as_str()) {
            continue;
        }
        let Column::F64(values) = col else { continue };
        if values.iter().all(|v| (*v as f32) as f64 == *v || v.is_nan()) {
            *col = Column::F32(values.iter().map(|v| *v as f32).collect());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn layout() -> Layout {
        Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap()
    }

    #[test]
    fn a_player_row_names_wheels_and_narrows_only_exact_doubles() {
        let lay = layout();
        let telem = lay.built("TelemInfoV01").unwrap();
        let mut raw = vec![0_u8; telem.size];
        let et = telem.fields.iter().find(|f| f.name == "mElapsedTime").unwrap();
        raw[et.offset..et.offset + 8].copy_from_slice(&1.25_f64.to_le_bytes());
        let gear = telem.fields.iter().find(|f| f.name == "mGear").unwrap();
        raw[gear.offset..gear.offset + 4].copy_from_slice(&4_i32.to_le_bytes());
        let pos = telem.fields.iter().find(|f| f.name == "mPos").unwrap();
        let vect = lay.built("TelemVect3").unwrap();
        let x = vect.fields.iter().find(|f| f.name == "x").unwrap().offset;
        let y = vect.fields.iter().find(|f| f.name == "y").unwrap().offset;
        raw[pos.offset + x..pos.offset + x + 8].copy_from_slice(&1.5_f64.to_le_bytes());
        raw[pos.offset + y..pos.offset + y + 8].copy_from_slice(&0.1_f64.to_le_bytes());
        let name = telem.fields.iter().find(|f| f.name == "mVehicleName").unwrap();
        raw[name.offset..name.offset + 3].copy_from_slice(b"LMU");

        let cols = columns(&lay, "TelemInfoV01", &raw, &["mVehicleName"], float32_player()).unwrap();
        assert_eq!(cols["mElapsedTime"], Column::F64(vec![1.25]));
        assert_eq!(cols["mGear"], Column::I64(vec![4]));
        // 1.5 is exact in float32. 0.1 is not, so it stays a double.
        assert_eq!(cols["mPos_x"], Column::F32(vec![1.5]));
        assert_eq!(cols["mPos_y"], Column::F64(vec![0.1]));
        assert_eq!(cols["mVehicleName"], Column::Text(vec!["LMU".into()]));
        assert!(!cols.keys().any(|k| k.contains("mExpansion")));
        assert!(cols.contains_key("fl_mBrakeTemp"));
        assert!(!cols.contains_key("mWheel_0_mBrakeTemp"));
    }

    #[test]
    fn text_keeps_a_nul_and_falls_back_when_the_bytes_are_not_utf8() {
        assert_eq!(decode_text(b"spa\0rest"), "spa");
        assert_eq!(decode_text(&[0xff, 0xfe]), "\u{00ff}\u{00fe}");
    }

    #[test]
    #[ignore = "needs BOTRACING_DUCKDB (the DuckDB CLI)"]
    fn duckdb_reads_the_chunk_and_keeps_the_header_widths() {
        let lay = layout();
        let telem = lay.built("TelemInfoV01").unwrap();
        let mut raw = vec![0_u8; telem.size];
        let et = telem.fields.iter().find(|f| f.name == "mElapsedTime").unwrap();
        raw[et.offset..et.offset + 8].copy_from_slice(&12.5_f64.to_le_bytes());
        let gear = telem.fields.iter().find(|f| f.name == "mGear").unwrap();
        raw[gear.offset..gear.offset + 4].copy_from_slice(&4_i32.to_le_bytes());
        let cols = columns(&lay, "TelemInfoV01", &raw, &[], float32_player()).unwrap();
        let dir = std::env::temp_dir().join("botracing-capture-chunk");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("player-0000.parquet");
        write_parquet(&path, &lay, "TelemInfoV01", &cols).unwrap();
        let file = path.display().to_string().replace('\\', "/");
        let text = duck(&format!(
            "SELECT mElapsedTime, mGear, typeof(mElapsedTime), typeof(mGear) FROM read_parquet('{file}')"
        ));
        assert!(text.contains("12.5"), "{text}");
        assert!(text.contains("INTEGER"), "{text}");
    }

    /// A path a local-only test needs, from the environment. These tests are
    /// #[ignore]: they run with `cargo test -- --ignored` on a PC that has the
    /// DuckDB CLI, the LMU header or a Python capture, and fail loudly if the
    /// variable is missing rather than passing without checking anything.
    fn env_path(var: &str) -> PathBuf {
        PathBuf::from(
            std::env::var(var).unwrap_or_else(|_| panic!("set {var} to run the ignored tests")),
        )
    }

    fn duck(query: &str) -> String {
        let duck = env_path("BOTRACING_DUCKDB");
        let done = std::process::Command::new(duck)
            .args([":memory:", "-csv", "-c", query])
            .output()
            .unwrap();
        assert!(done.status.success(), "{}", String::from_utf8_lossy(&done.stderr));
        String::from_utf8_lossy(&done.stdout).to_string()
    }

    #[test]
    #[ignore = "needs BOTRACING_DUCKDB (the DuckDB CLI)"]
    fn a_chunk_adds_wall_ms_et_update_and_the_compound_names() {
        let lay = layout();
        let telem = lay.built("TelemInfoV01").unwrap();
        let mut raw = vec![0_u8; telem.size];
        for name in ["mFrontTireCompoundName", "mRearTireCompoundName"] {
            let field = telem.fields.iter().find(|f| f.name == name).unwrap();
            raw[field.offset..field.offset + 4].copy_from_slice(b"soft");
        }
        let mut cols = columns(
            &lay,
            "TelemInfoV01",
            &raw,
            &["mFrontTireCompoundName", "mRearTireCompoundName"],
            float32_player(),
        )
        .unwrap();
        cols.insert("wall_ms".into(), Column::I64(vec![1_700_000_000_000]));
        let dir = std::env::temp_dir().join("botracing-capture-extra");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("player-0000.parquet");
        write_parquet(&path, &lay, "TelemInfoV01", &cols).unwrap();
        let file = path.display().to_string().replace('\\', "/");
        let text = duck(&format!(
            "SELECT wall_ms, mFrontTireCompoundName, mRearTireCompoundName FROM read_parquet('{file}')"
        ));
        assert!(text.contains("1700000000000"), "{text}");
        assert!(text.contains("soft"), "{text}");

        let vehicle = lay.built("VehicleScoringInfoV01").unwrap();
        let field_raw = vec![0_u8; vehicle.size];
        let mut field = columns(&lay, "VehicleScoringInfoV01", &field_raw, &["mVehicleName"], float32_player()).unwrap();
        field.insert("wall_ms".into(), Column::I64(vec![5]));
        field.insert("et".into(), Column::F64(vec![3.5]));
        field.insert("update".into(), Column::I64(vec![9]));
        let field_path = dir.join("field-0000.parquet");
        write_parquet(&field_path, &lay, "VehicleScoringInfoV01", &field).unwrap();
        let field_file = field_path.display().to_string().replace('\\', "/");
        let field_text = duck(&format!(
            "SELECT wall_ms, et, update FROM read_parquet('{field_file}')"
        ));
        assert!(field_text.contains("3.5"), "{field_text}");
        assert!(field_text.contains("9"), "{field_text}");
    }

    fn describe(path: &Path) -> Vec<(String, String)> {
        let file = path.display().to_string().replace('\\', "/");
        let text = duck(&format!("DESCRIBE SELECT * FROM read_parquet('{file}')"));
        text.lines()
            .skip(1)
            .filter(|line| !line.is_empty())
            .map(|line| {
                let mut cols = line.split(',');
                (cols.next().unwrap_or("").to_string(), cols.next().unwrap_or("").to_string())
            })
            .collect()
    }

    #[test]
    #[ignore = "needs BOTRACING_DUCKDB, LMU_SHM_HEADER_DIR and LAP_CAPTURE_SAMPLE"]
    fn rust_chunk_schema_matches_a_python_chunk_on_disk() {
        let header_dir = env_path("LMU_SHM_HEADER_DIR");
        // A capture folder the Python recorder wrote, with player-0000 and field-0000 in it.
        let python = env_path("LAP_CAPTURE_SAMPLE");
        let mut text = String::new();
        for name in ["InternalsPlugin.hpp", "SharedMemoryInterface.hpp"] {
            text.push_str(&std::fs::read_to_string(header_dir.join(name)).unwrap());
            text.push('\n');
        }
        let lay = Layout::parse(&text).unwrap();
        let dir = std::env::temp_dir().join("botracing-capture-describe");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let telem = lay.built("TelemInfoV01").unwrap().size;
        let mut player = columns(&lay, "TelemInfoV01", &vec![0; telem], &["mFrontTireCompoundName", "mRearTireCompoundName"], float32_player()).unwrap();
        player.insert("wall_ms".into(), Column::I64(vec![1]));
        let player_path = dir.join("player-0000.parquet");
        write_parquet(&player_path, &lay, "TelemInfoV01", &player).unwrap();

        let veh = lay.built("VehicleScoringInfoV01").unwrap().size;
        let mut field = columns(&lay, "VehicleScoringInfoV01", &vec![0; veh], &["mVehicleName", "mVehicleClass", "mDriverName"], float32_field()).unwrap();
        field.insert("wall_ms".into(), Column::I64(vec![1]));
        field.insert("et".into(), Column::F64(vec![1.0]));
        field.insert("update".into(), Column::I64(vec![0]));
        let field_path = dir.join("field-0000.parquet");
        write_parquet(&field_path, &lay, "VehicleScoringInfoV01", &field).unwrap();

        for (kind, rust_path) in [("player", &player_path), ("field", &field_path)] {
            let py = describe(&python.join(format!("{kind}-0000.parquet")));
            let rs = describe(rust_path);
            let py_names: HashSet<_> = py.iter().map(|(n, _)| n.clone()).collect();
            let rs_map: HashMap<_, _> = rs.iter().cloned().collect();
            let mut only_py = Vec::new();
            let mut type_diff = Vec::new();
            for (name, ty) in &py {
                match rs_map.get(name) {
                    None => only_py.push(name.clone()),
                    Some(other) if other != ty && !(both_float(ty, other) && narrowable(name)) => {
                        type_diff.push(format!("{name}: python {ty}, rust {other}"));
                    }
                    _ => {}
                }
            }
            let only_rs: Vec<_> = rs.iter().map(|(n, _)| n).filter(|n| !py_names.contains(*n)).cloned().collect();
            eprintln!("{kind}: python-only {only_py:?}");
            eprintln!("{kind}: rust-only {only_rs:?}");
            eprintln!("{kind}: type diffs {type_diff:?}");
            assert!(only_py.is_empty(), "{kind} missing columns the Python chunk has: {only_py:?}");
            assert!(only_rs.is_empty(), "{kind} has columns the Python chunk does not: {only_rs:?}");
            assert!(type_diff.is_empty(), "{kind} type diffs that are not float width: {type_diff:?}");
        }
    }

    /// float32 or double is a per-chunk choice (a column narrows only when every
    /// value is exact) for these names and no others.
    fn narrowable(name: &str) -> bool {
        float32_player().contains(name) || float32_field().contains(name)
    }

    fn both_float(a: &str, b: &str) -> bool {
        let float = |t: &str| t.eq_ignore_ascii_case("FLOAT") || t.eq_ignore_ascii_case("DOUBLE");
        float(a) && float(b)
    }

    /// columns.py's FLOAT32_PLAYER and FLOAT32_FIELD, dumped to JSON, are the
    /// sets written here; a name added to one side only changes the schema.
    #[test]
    fn the_float32_sets_equal_columns_py() {
        let dump: serde_json::Value =
            serde_json::from_str(include_str!("float32_sets.json")).unwrap();
        let set = |key: &str| -> HashSet<String> {
            dump[key]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect()
        };
        assert_eq!(&set("player"), float32_player());
        assert_eq!(&set("field"), float32_field());
    }
}
