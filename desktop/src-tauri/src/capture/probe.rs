// The few fields the recorder reads by name, found in the layout at run time
// (never written down here: the header is S397's and changes with the game).
// A field the header does not have stops the recorder at start.

use crate::capture::columns::decode_text;
use crate::capture::layout::{size_align, Kind, Layout};

/// Offset of `path` inside `struct_name`: dotted names, with array positions
/// as numbers ("mWheel.0.mTemperature.1").
pub fn offset_of(layout: &Layout, struct_name: &str, path: &str) -> Result<usize, String> {
    let mut def = layout
        .built(struct_name)
        .ok_or_else(|| format!("struct {struct_name} was not built"))?;
    let mut offset = 0;
    let mut kind: Option<Kind> = None;
    for seg in path.split('.') {
        if let Some(Kind::Array(inner, n)) = &kind {
            let i: usize = seg
                .parse()
                .map_err(|_| format!("{struct_name}.{path}: {seg} is not a position"))?;
            if i >= *n {
                return Err(format!("{struct_name}.{path}: {i} is past the {n} elements"));
            }
            offset += i * size_align(inner).0;
            kind = Some((**inner).clone());
            continue;
        }
        if let Some(Kind::Struct(name)) = &kind {
            def = layout
                .built(name)
                .ok_or_else(|| format!("struct {name} was not built"))?;
        }
        let field = def
            .fields
            .iter()
            .find(|f| f.name == seg)
            .ok_or_else(|| format!("{struct_name}.{path}: no field {seg}"))?;
        offset += field.offset;
        kind = Some(field.kind.clone());
    }
    Ok(offset)
}

/// A fixed char buffer: where it starts and how long it is.
#[derive(Clone, Copy, Debug)]
pub struct Text {
    pub at: usize,
    pub len: usize,
}

fn text_of(layout: &Layout, struct_name: &str, name: &str) -> Result<Text, String> {
    let def = layout
        .built(struct_name)
        .ok_or_else(|| format!("struct {struct_name} was not built"))?;
    let f = def
        .fields
        .iter()
        .find(|f| f.name == name)
        .ok_or_else(|| format!("{struct_name}: no field {name}"))?;
    Ok(Text { at: f.offset, len: f.size })
}

pub struct Probe {
    pub s_track: Text,
    pub s_player: Text,
    pub s_server: Text,
    pub s_session: usize,
    pub s_game_mode: usize,
    pub s_et: usize,
    pub v_name: Text,
    pub v_id: usize,
    pub v_place: usize,
    pub v_lap_dist: usize,
    pub t_name: Text,
    pub t_track: Text,
    pub t_model: Text,
    pub t_id: usize,
    pub t_et: usize,
    pub t_gear: usize,
    pub t_vel: [usize; 3],
    pub t_pos: [usize; 3],
    /// Per wheel: the three tyre temperatures, the carcass and the brake.
    pub t_temps: Vec<[usize; 5]>,
}

impl Probe {
    pub fn new(layout: &Layout) -> Result<Probe, String> {
        let xyz = |s: &str, v: &str| -> Result<[usize; 3], String> {
            Ok([
                offset_of(layout, s, &format!("{v}.x"))?,
                offset_of(layout, s, &format!("{v}.y"))?,
                offset_of(layout, s, &format!("{v}.z"))?,
            ])
        };
        let mut t_temps = Vec::new();
        for w in 0..4 {
            let t = |p: &str| offset_of(layout, "TelemInfoV01", &format!("mWheel.{w}.{p}"));
            t_temps.push([
                t("mTemperature.0")?,
                t("mTemperature.1")?,
                t("mTemperature.2")?,
                t("mTireCarcassTemperature")?,
                t("mBrakeTemp")?,
            ]);
        }
        Ok(Probe {
            s_track: text_of(layout, "ScoringInfoV01", "mTrackName")?,
            s_player: text_of(layout, "ScoringInfoV01", "mPlayerName")?,
            s_server: text_of(layout, "ScoringInfoV01", "mServerName")?,
            s_session: offset_of(layout, "ScoringInfoV01", "mSession")?,
            s_game_mode: offset_of(layout, "ScoringInfoV01", "mGameMode")?,
            s_et: layout.scoring_et,
            v_name: text_of(layout, "VehicleScoringInfoV01", "mVehicleName")?,
            v_id: offset_of(layout, "VehicleScoringInfoV01", "mID")?,
            v_place: offset_of(layout, "VehicleScoringInfoV01", "mPlace")?,
            v_lap_dist: offset_of(layout, "VehicleScoringInfoV01", "mLapDist")?,
            t_name: text_of(layout, "TelemInfoV01", "mVehicleName")?,
            t_track: text_of(layout, "TelemInfoV01", "mTrackName")?,
            t_model: text_of(layout, "TelemInfoV01", "mVehicleModel")?,
            t_id: offset_of(layout, "TelemInfoV01", "mID")?,
            t_et: layout.telem_et,
            t_gear: offset_of(layout, "TelemInfoV01", "mGear")?,
            t_vel: xyz("TelemInfoV01", "mLocalVel")?,
            t_pos: xyz("TelemInfoV01", "mPos")?,
            t_temps,
        })
    }
}

pub fn f64_at(raw: &[u8], at: usize) -> f64 {
    raw.get(at..at + 8)
        .and_then(|b| b.try_into().ok())
        .map_or(f64::NAN, f64::from_le_bytes)
}

pub fn i32_at(raw: &[u8], at: usize) -> i32 {
    raw.get(at..at + 4)
        .and_then(|b| b.try_into().ok())
        .map_or(0, i32::from_le_bytes)
}

pub fn u8_at(raw: &[u8], at: usize) -> u8 {
    raw.get(at).copied().unwrap_or(0)
}

pub fn text_at(raw: &[u8], t: Text) -> String {
    raw.get(t.at..t.at + t.len).map_or_else(String::new, decode_text)
}
