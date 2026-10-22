// Is the layout we built reading real data? Checked at the start of every
// session (tools/capture/sanity.py). A wrong layout does not crash, it reads
// plausible-looking numbers from the wrong bytes; these checks look for what
// only a right layout gets right. Tyre and brake temperatures are Kelvin.

use crate::capture::layout::Layout;
use crate::capture::probe::{f64_at, i32_at, text_at, u8_at, Probe};

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Ok,
    /// Not decidable yet (the car is not simulated): check again.
    Wait,
    Bad(String),
}

// Any printable text. Entry names can carry non-ASCII letters; a wrong layout
// reads control bytes.
fn printable(s: &str) -> bool {
    !s.is_empty() && !s.chars().any(char::is_control)
}

// Only garbage is out of range: a car in the garage or pit box reads a negative
// lap distance as far back as the pit lane is long (Sebring -1079 to -1664 m,
// 2026-10-19). What a wrong layout does is garble every car, so the check
// counts the cars out of range and refuses on the share, as it does for names.
const LAP_DIST_BOUND: f64 = 100_000.0;

/// From the field alone, before the player is in a car.
pub fn check_scoring(
    layout: &Layout,
    p: &Probe,
    info: &[u8],
    vehicles: &[u8],
    n: usize,
) -> Result<(), String> {
    let track = text_at(info, p.s_track);
    if !printable(&track) {
        return Err(format!("track name is not text: {track:?}"));
    }
    if n < 1 || n > layout.max_vehicles {
        return Err(format!("{n} vehicles"));
    }
    let et = f64_at(info, p.s_et);
    if !(et.is_finite() && (0.0..1e6).contains(&et)) {
        return Err(format!("session clock {et}"));
    }
    let size = vehicles.len() / n;
    let mut bad_names = Vec::new();
    let mut bad_dists = Vec::new();
    for i in 0..n {
        let car = &vehicles[i * size..(i + 1) * size];
        let name = text_at(car, p.v_name);
        if !printable(&name) {
            bad_names.push(format!("car {i} {name:?}"));
        }
        let place = u8_at(car, p.v_place) as usize;
        if place > layout.max_vehicles {
            return Err(format!("car {i} place {place}"));
        }
        let dist = f64_at(car, p.v_lap_dist);
        if !(dist.is_finite() && dist.abs() < LAP_DIST_BOUND) {
            bad_dists.push(format!("car {i} lap distance {dist}"));
        }
    }
    if bad_dists.len() * 4 > n {
        return Err(format!("{} of {n} cars: {}", bad_dists.len(), bad_dists[0]));
    }
    // A wrong layout garbles every name; one odd or still-blank name while a
    // 58-car field loads does not (2026-09-29 Daytona). Refuse only when more
    // than a quarter are bad.
    if bad_names.len() * 4 > n {
        return Err(format!(
            "{} of {n} car names are not text: {}",
            bad_names.len(),
            bad_names[0]
        ));
    }
    Ok(())
}

/// With the player in a car: names must agree across structs.
pub fn check_player(p: &Probe, info: &[u8], vehicles: &[u8], n: usize, telem: &[u8]) -> Verdict {
    let all_zero = p
        .t_temps
        .iter()
        .all(|w| w[..3].iter().all(|at| f64_at(telem, *at) == 0.0));
    if all_zero {
        return Verdict::Wait;
    }
    if text_at(telem, p.t_track) != text_at(info, p.s_track) {
        return Verdict::Bad("track differs between telemetry and scoring".into());
    }
    let size = vehicles.len() / n;
    let me = text_at(telem, p.t_name);
    if !(0..n).any(|i| text_at(&vehicles[i * size..(i + 1) * size], p.v_name) == me) {
        return Verdict::Bad("player car not in the field".into());
    }
    let et = f64_at(telem, p.t_et);
    if !(et.is_finite() && (0.0..1e6).contains(&et)) {
        return Verdict::Bad(format!("player clock {et}"));
    }
    let speed = p.t_vel.iter().map(|at| f64_at(telem, *at).powi(2)).sum::<f64>().sqrt();
    if !(speed < 150.0) {
        return Verdict::Bad(format!("speed {speed:.0} m/s"));
    }
    let gear = i32_at(telem, p.t_gear);
    if !(-2..=12).contains(&gear) {
        return Verdict::Bad(format!("gear {gear}"));
    }
    for w in &p.t_temps {
        let temps: Vec<f64> = w.iter().map(|at| f64_at(telem, *at)).collect();
        if !temps.iter().all(|k| (200.0..=1500.0).contains(k)) {
            let rounded: Vec<i64> = temps.iter().map(|k| k.round() as i64).collect();
            return Verdict::Bad(format!("wheel temperatures {rounded:?} K"));
        }
    }
    Verdict::Ok
}
