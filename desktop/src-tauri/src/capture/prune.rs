// Keeps the capture folder from growing. A capture is a folder under the
// capture root, with a meta.json (its sim, and endUtc once it has finished).
// Sync writes `uploaded.json` inside a capture once it has uploaded the
// capture's sessions, with each session it read back from the store and found
// matching under `verified` (tools/sessions/verifyStored.mjs).
//
// Only a verified capture counts toward the size cap: every session that read
// it was read back and matched (pit-wall thread 100, L6; decisions/lap/
// 2026-10-21-no-validation-drops-data.md). An unverified one is never taken
// for the cap; over it, its bytes are reported (`held_bytes`).
//
// Every deletion needs its sim to be idle: no sync running and no retry
// pending (the uploader's state). A switched-off sim is never touched.
// A verified capture goes once it has finished (meta.json has an endUtc) and
// is older than `keep`; then, while the folder is still over `cap_bytes`, the
// oldest finished verified captures go first.
// An unverified capture (never uploaded, or uploaded and not matching) goes
// once it ended more than `keep` ago AND the uploader completed a run after it
// ended: Botkin's approved exception ("14 days is acceptable", the decision
// above). Until then it is `waiting`, which the tray shows in Problems with
// the days left, so it never goes silently.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

/// The file sync writes inside a capture once its sessions are uploaded.
pub const UPLOADED_MARKER: &str = "uploaded.json";
/// The capture's own record, written at the start and again at the end.
pub const META: &str = "meta.json";
/// The sim of a capture whose meta.json names none: the LMU recorder writes no `sim`.
/// LMU is also the legacy-layout sim: its uploader state sits at the top level
/// of state.json, not under `sims`.
pub const DEFAULT_SIM: &str = "lmu";

/// One capture on disk.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub path: PathBuf,
    pub sim: String,
    /// When it ended: meta.json's own time once it has an endUtc, else the
    /// folder's time (a capture cut short).
    pub ended: SystemTime,
    /// meta.json has an endUtc: the recorder finished the capture.
    pub finished: bool,
    /// The marker's time for a marked capture, else the folder's time.
    pub modified: SystemTime,
    pub bytes: u64,
    /// It has an `uploaded.json`.
    pub marked: bool,
    /// Every session that read it was read back from the store and matched.
    pub verified: bool,
}

/// What the uploader's state.json says about one sim.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SimState {
    /// When the uploader last completed a run for this sim.
    pub last_run: Option<SystemTime>,
    /// A sync is running for this sim right now.
    pub syncing: bool,
    /// A retry is scheduled or a session is waiting on one.
    pub retry_pending: bool,
}

impl SimState {
    /// Nothing is syncing or waiting to retry: deletions for this sim may run.
    pub fn idle(&self) -> bool {
        !self.syncing && !self.retry_pending
    }
}

/// What the user chose: which sims are pruned, how long to keep, and the size cap.
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub keep: Duration,
    pub cap_bytes: u64,
    /// The sims whose captures may be pruned; the rest are never touched.
    pub sims: Vec<String>,
}

/// Whether a capture's marker lists at least one session and every one of
/// them under `verified`. A marker without `verified` (written before the
/// read-back) is not.
pub fn is_verified(marker: &Value) -> bool {
    let ids: Vec<&str> = match marker.get("sessionIds").and_then(Value::as_array) {
        Some(ids) => ids.iter().filter_map(Value::as_str).collect(),
        None => marker
            .get("sessionId")
            .and_then(Value::as_str)
            .into_iter()
            .collect(),
    };
    let Some(verified) = marker.get("verified").and_then(Value::as_object) else {
        return false;
    };
    !ids.is_empty() && ids.iter().all(|id| verified.contains_key(*id))
}

fn read_marker(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path.join(UPLOADED_MARKER)).ok()?;
    serde_json::from_str(&text).ok()
}

/// What one cleanup decides.
#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// The paths to delete, oldest first.
    pub doomed: Vec<PathBuf>,
    /// Of `doomed`, the ones never verified (deleted at the 14-day exception).
    pub doomed_unverified: Vec<PathBuf>,
    /// The switched-on sims' unverified captures the uploader has run past and
    /// that stay: each with the time left before it goes.
    pub waiting: Vec<(PathBuf, Duration)>,
    /// Bytes of unverified captures while the folder stays over the cap (0
    /// when it ends under it).
    pub held_bytes: u64,
    /// Captures this run could not read or could not delete, each with why: one
    /// bad entry is listed here and the rest of the run goes on (ticket 86),
    /// and the tray shows it in Problems.
    pub skipped: Vec<(PathBuf, String)>,
}

/// What to delete, and what is held over the cap.
pub fn plan(
    entries: &[Entry],
    now: SystemTime,
    policy: &Policy,
    states: &HashMap<String, SimState>,
) -> Plan {
    let on = |e: &Entry| policy.sims.iter().any(|s| *s == e.sim);
    let old = |t: SystemTime| now.duration_since(t).map_or(false, |age| age > policy.keep);
    // A sim with no state at all is not idle: nothing of it is pruned.
    let idle = |e: &Entry| states.get(&e.sim).map_or(false, |s| s.idle());
    let mut total: u64 = entries.iter().map(|e| e.bytes).sum();
    let mut doomed: Vec<PathBuf> = Vec::new();
    let mut doomed_unverified: Vec<PathBuf> = Vec::new();
    let mut waiting: Vec<(PathBuf, Duration)> = Vec::new();

    for e in entries.iter().filter(|e| on(e) && !e.verified) {
        let Some(st) = states.get(&e.sim) else {
            continue;
        };
        // The uploader had its chance: a run completed after the capture ended.
        if !st.last_run.map_or(false, |run| run > e.ended) {
            continue;
        }
        // Its 14 days run from the later of its end and its marker: a capture
        // marked before the read-back existed keeps the deadline it had.
        let since = if e.marked { e.ended.max(e.modified) } else { e.ended };
        if old(since) && st.idle() {
            doomed.push(e.path.clone());
            doomed_unverified.push(e.path.clone());
            total = total.saturating_sub(e.bytes);
        } else {
            let age = now.duration_since(since).unwrap_or_default();
            waiting.push((e.path.clone(), policy.keep.saturating_sub(age)));
        }
    }
    waiting.sort_by_key(|(_, left)| *left);

    let mut candidates: Vec<&Entry> = entries
        .iter()
        .filter(|e| on(e) && e.verified && e.finished && idle(e))
        .collect();
    candidates.sort_by_key(|e| e.modified);
    for e in &candidates {
        if old(e.modified) {
            doomed.push(e.path.clone());
            total = total.saturating_sub(e.bytes);
        }
    }
    for e in &candidates {
        if total <= policy.cap_bytes {
            break;
        }
        if doomed.contains(&e.path) {
            continue;
        }
        doomed.push(e.path.clone());
        total = total.saturating_sub(e.bytes);
    }
    let held_bytes = if total > policy.cap_bytes {
        entries
            .iter()
            .filter(|e| on(e) && !e.verified && !doomed.contains(&e.path))
            .map(|e| e.bytes)
            .sum()
    } else {
        0
    };
    Plan {
        doomed,
        doomed_unverified,
        waiting,
        held_bytes,
        skipped: Vec::new(),
    }
}

/// What a scan found: the captures, and the folders it could not read.
#[derive(Debug, Default)]
pub struct Scan {
    pub entries: Vec<Entry>,
    pub skipped: Vec<(PathBuf, String)>,
}

/// The top-level captures of `root` with their sizes, sims and marker state. A
/// capture is a folder: the status files the recorders keep in the root
/// (status.json, status-iracing.json) are not captures and are passed over. One
/// folder that cannot be read is listed in `skipped` and the scan goes on, so a
/// bad entry never stops the cleanup of the others (ticket 86; before, a `?`
/// here ended every later run and the folder grew without bound).
pub fn scan(root: &Path) -> io::Result<Scan> {
    scan_using(root, &entry_of)
}

/// `scan` with the reading of one capture as a seam, for the tests.
fn scan_using(root: &Path, read: &dyn Fn(&Path) -> io::Result<Entry>) -> io::Result<Scan> {
    let mut out = Scan::default();
    for item in fs::read_dir(root)? {
        let path = item.map_err(io::Error::from)?.path();
        if !path.is_dir() {
            continue;
        }
        match read(&path) {
            Ok(entry) => out.entries.push(entry),
            Err(e) => out.skipped.push((path, e.to_string())),
        }
    }
    Ok(out)
}

fn entry_of(path: &Path) -> io::Result<Entry> {
    let folder = fs::metadata(path)?.modified().unwrap_or(UNIX_EPOCH);
    let marked = path.join(UPLOADED_MARKER).is_file();
    let verified = marked && read_marker(path).as_ref().map_or(false, is_verified);
    let modified = if marked {
        fs::metadata(path.join(UPLOADED_MARKER))?
            .modified()
            .unwrap_or(UNIX_EPOCH)
    } else {
        folder
    };
    let (sim, ended, finished) = read_meta(path, folder)?;
    Ok(Entry {
        bytes: size_of(path)?,
        modified,
        ended,
        finished,
        sim,
        marked,
        verified,
        path: path.to_path_buf(),
    })
}

/// The sim, end time and finished flag from a capture's meta.json. Without an
/// endUtc (cut short, or no meta.json at all) the capture ends when its folder
/// last changed and is not finished.
fn read_meta(dir: &Path, folder: SystemTime) -> io::Result<(String, SystemTime, bool)> {
    let meta = dir.join(META);
    let Ok(text) = fs::read_to_string(&meta) else {
        return Ok((DEFAULT_SIM.to_string(), folder, false));
    };
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let sim = v
        .get("sim")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_SIM)
        .to_string();
    let finished = v.get("endUtc").and_then(Value::as_str).is_some();
    let ended = if finished {
        fs::metadata(&meta)?.modified().unwrap_or(folder)
    } else {
        folder
    };
    Ok((sim, ended, finished))
}

/// Each sim's state from the uploader's state.json. The legacy-layout sim (LMU,
/// `DEFAULT_SIM`) keeps its fields at the top level; the others sit under
/// `sims.<id>`. A missing or unreadable file gives no states, so nothing is pruned.
pub fn read_states(path: &Path) -> HashMap<String, SimState> {
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return HashMap::new();
    };
    let mut out = HashMap::new();
    out.insert(DEFAULT_SIM.to_string(), sim_state(&v));
    if let Some(sims) = v.get("sims").and_then(Value::as_object) {
        for (id, st) in sims {
            out.insert(id.clone(), sim_state(st));
        }
    }
    out
}

/// One sim's fields as the watcher writes them: `lastRunAtMs`, `syncing`, and
/// `retryAtMs` or a non-empty `retries` map for a retry pending.
fn sim_state(st: &Value) -> SimState {
    let last_run = st
        .get("lastRunAtMs")
        .and_then(Value::as_u64)
        .map(|ms| UNIX_EPOCH + Duration::from_millis(ms));
    let syncing = st.get("syncing").and_then(Value::as_bool).unwrap_or(false);
    let retry_at = st.get("retryAtMs").map_or(false, |r| !r.is_null());
    let retries = st
        .get("retries")
        .and_then(Value::as_object)
        .map_or(false, |r| !r.is_empty());
    SimState {
        last_run,
        syncing,
        retry_pending: retry_at || retries,
    }
}

fn size_of(path: &Path) -> io::Result<u64> {
    let meta = fs::metadata(path)?;
    if !meta.is_dir() {
        return Ok(meta.len());
    }
    let mut total = 0;
    for item in fs::read_dir(path)? {
        total += size_of(&item?.path())?;
    }
    Ok(total)
}

/// The switched-on sims whose cleanup waits on a retry: the tray says so.
pub fn blocked_sims(policy: &Policy, states: &HashMap<String, SimState>) -> Vec<String> {
    policy
        .sims
        .iter()
        .filter(|s| states.get(*s).map_or(false, |st| st.retry_pending))
        .cloned()
        .collect()
}

/// What `prune` would do under `root`, and the bytes it would delete.
/// Nothing is deleted.
pub fn dry_run(
    root: &Path,
    now: SystemTime,
    policy: &Policy,
    states: &HashMap<String, SimState>,
) -> io::Result<(Plan, u64)> {
    let found = scan(root)?;
    let mut p = plan(&found.entries, now, policy, states);
    p.skipped = found.skipped;
    let bytes = found
        .entries
        .iter()
        .filter(|e| p.doomed.contains(&e.path))
        .map(|e| e.bytes)
        .sum();
    Ok((p, bytes))
}

/// Deletes what `plan` chooses under `root`, and returns the plan.
pub fn prune(
    root: &Path,
    now: SystemTime,
    policy: &Policy,
    states: &HashMap<String, SimState>,
) -> io::Result<Plan> {
    prune_using(root, now, policy, states, &entry_of, &|p| fs::remove_dir_all(p))
}

/// `prune` with reading and deleting one capture as seams, for the tests.
fn prune_using(
    root: &Path,
    now: SystemTime,
    policy: &Policy,
    states: &HashMap<String, SimState>,
    read: &dyn Fn(&Path) -> io::Result<Entry>,
    remove: &dyn Fn(&Path) -> io::Result<()>,
) -> io::Result<Plan> {
    let found = scan_using(root, read)?;
    let mut p = plan(&found.entries, now, policy, states);
    p.skipped = found.skipped;
    // A capture that cannot be deleted is listed and the next one is tried; the
    // plan then names only what went (the log and Problems count from it).
    let mut failed = Vec::new();
    for path in &p.doomed {
        if let Err(e) = remove(path) {
            failed.push((path.clone(), format!("could not delete: {e}")));
        }
    }
    p.doomed.retain(|d| !failed.iter().any(|(f, _)| f == d));
    p.doomed_unverified.retain(|d| !failed.iter().any(|(f, _)| f == d));
    p.skipped.extend(failed);
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(86_400);
    /// Markers as sync writes them (tools/sessions/captureMarker.mjs).
    const VERIFIED: &str = r#"{"sessionId":"s1","sessionIds":["s1"],"uploadedUtc":"2026-09-01T00:00:00Z","verified":{"s1":{"laps":31,"fieldHash":"abc","utc":"2026-09-01T00:00:00Z"}}}"#;
    const SENT: &str = r#"{"sessionId":"s1","sessionIds":["s1"],"uploadedUtc":"2026-09-01T00:00:00Z","verified":{}}"#;

    #[test]
    fn a_capture_is_verified_only_when_every_session_that_read_it_is() {
        let v = |text: &str| is_verified(&serde_json::from_str(text).unwrap());
        assert!(v(VERIFIED));
        assert!(!v(SENT));
        // Written before the read-back existed.
        assert!(!v(r#"{"sessionId":"s1","sessionIds":["s1"],"uploadedUtc":"x"}"#));
        assert!(!v("{}"));
        // Two sessions read it; only one was read back.
        assert!(!v(
            r#"{"sessionId":"s2","sessionIds":["s1","s2"],"verified":{"s1":{}}}"#
        ));
        assert!(v(
            r#"{"sessionId":"s2","sessionIds":["s1","s2"],"verified":{"s1":{},"s2":{}}}"#
        ));
    }

    fn at(days_ago: u32, now: SystemTime) -> SystemTime {
        now - DAY * days_ago
    }

    fn policy(keep_days: u32, cap_bytes: u64) -> Policy {
        Policy {
            keep: DAY * keep_days,
            cap_bytes,
            sims: vec!["lmu".into(), "iracing".into()],
        }
    }

    /// A finished LMU capture that ended `days_ago`, verified or not.
    fn entry(name: &str, days_ago: u32, bytes: u64, verified: bool, now: SystemTime) -> Entry {
        Entry {
            path: PathBuf::from(name),
            sim: "lmu".into(),
            ended: at(days_ago, now),
            finished: true,
            modified: at(days_ago, now),
            bytes,
            marked: verified,
            verified,
        }
    }

    fn doomed(p: Plan) -> Vec<PathBuf> {
        p.doomed
    }

    /// LMU with its last run `days_ago`, nothing syncing or retrying.
    fn ran_at(days_ago: u32, now: SystemTime) -> HashMap<String, SimState> {
        HashMap::from([(
            "lmu".to_string(),
            SimState {
                last_run: Some(at(days_ago, now)),
                ..Default::default()
            },
        )])
    }

    #[test]
    fn deletes_finished_verified_captures_older_than_keep_days() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-verified", 20, 10, true, now),
            entry("old-unverified", 20, 10, false, now),
            entry("recent-verified", 3, 10, true, now),
            // Verified on day 13, a day before it would have gone: kept.
            entry("verified-day-13", 13, 10, true, now),
        ];
        // The last run came before these captures ended: the unverified one stays.
        assert_eq!(
            doomed(plan(&entries, now, &policy(14, u64::MAX), &ran_at(25, now))),
            vec![PathBuf::from("old-verified")]
        );
    }

    #[test]
    fn with_no_uploader_state_nothing_is_pruned() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-marked", 20, 10, true, now),
            entry("old-unmarked", 20, 10, false, now),
        ];
        assert!(doomed(plan(&entries, now, &policy(14, 5), &HashMap::new())).is_empty());
    }

    #[test]
    fn a_marked_capture_is_kept_until_the_recorder_finished_it() {
        let now = SystemTime::now();
        let mut cut_short = entry("cut-short-marked", 30, 10, true, now);
        cut_short.finished = false;
        assert!(doomed(plan(&[cut_short], now, &policy(14, u64::MAX), &ran_at(0, now))).is_empty());
    }

    #[test]
    fn nothing_is_pruned_while_a_sync_runs_or_a_retry_is_pending() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-marked", 20, 10, true, now),
            entry("old-unmarked", 20, 10, false, now),
        ];
        for busy in [
            SimState {
                syncing: true,
                ..Default::default()
            },
            SimState {
                retry_pending: true,
                ..Default::default()
            },
        ] {
            let states = HashMap::from([(
                "lmu".to_string(),
                SimState {
                    last_run: Some(at(25, now)),
                    ..busy
                },
            )]);
            assert!(doomed(plan(&entries, now, &policy(14, u64::MAX), &states)).is_empty());
        }
    }

    #[test]
    fn size_cap_never_takes_an_unverified_capture_and_reports_it_held() {
        let now = SystemTime::now();
        // Recent, so only the cap could take them.
        let entries = vec![
            entry("a", 3, 500, false, now),
            entry("b", 1, 500, false, now),
        ];
        let p = plan(&entries, now, &policy(14, 100), &ran_at(0, now));
        assert!(p.doomed.is_empty());
        assert_eq!(p.held_bytes, 1000);
        // Under the cap nothing is held.
        assert_eq!(
            plan(&entries, now, &policy(14, 5000), &ran_at(0, now)).held_bytes,
            0
        );
    }

    #[test]
    fn an_unverified_capture_goes_at_14_days_and_waits_with_its_days_left_until_then() {
        // Botkin 2026-10-22: "14 days is acceptable", if it is never silent.
        let now = SystemTime::now();
        let entries = vec![
            entry("old-unverified", 20, 10, false, now),
            entry("unverified-day-11", 11, 10, false, now),
            entry("unverified-day-2", 2, 10, false, now),
        ];
        let p = plan(&entries, now, &policy(14, u64::MAX), &ran_at(1, now));
        assert_eq!(p.doomed, vec![PathBuf::from("old-unverified")]);
        assert_eq!(p.doomed_unverified, vec![PathBuf::from("old-unverified")]);
        assert_eq!(
            p.waiting,
            vec![
                (PathBuf::from("unverified-day-11"), DAY * 3),
                (PathBuf::from("unverified-day-2"), DAY * 12),
            ]
        );
        // The last run is older than their end: nothing goes or waits yet
        // (the uploader has not had its chance).
        let p = plan(&entries, now, &policy(14, u64::MAX), &ran_at(25, now));
        assert!(p.doomed.is_empty() && p.waiting.is_empty());
    }

    #[test]
    fn a_capture_marked_before_the_read_back_keeps_its_old_deadline() {
        // Ended 20 days ago, marked (old format, no `verified`) 4 days ago:
        // 10 days left, as the marker's age gave it before.
        let now = SystemTime::now();
        let mut e = entry("old-format", 20, 10, false, now);
        e.marked = true;
        e.modified = at(4, now);
        let p = plan(&[e], now, &policy(14, u64::MAX), &ran_at(1, now));
        assert!(p.doomed.is_empty());
        assert_eq!(p.waiting, vec![(PathBuf::from("old-format"), DAY * 10)]);
    }

    #[test]
    fn a_switched_off_sim_is_never_pruned() {
        let now = SystemTime::now();
        let lmu = entry("lmu-verified", 30, 10, true, now);
        let mut iracing = entry("ir-verified", 30, 10, true, now);
        iracing.sim = "iracing".into();
        let only_iracing = Policy {
            keep: DAY * 14,
            cap_bytes: 0,
            sims: vec!["iracing".into()],
        };
        let states = HashMap::from([
            (
                "iracing".to_string(),
                SimState {
                    last_run: Some(at(1, now)),
                    ..Default::default()
                },
            ),
            (
                "lmu".to_string(),
                SimState {
                    last_run: Some(at(1, now)),
                    ..Default::default()
                },
            ),
        ]);
        assert_eq!(
            doomed(plan(&[lmu, iracing], now, &only_iracing, &states)),
            vec![PathBuf::from("ir-verified")]
        );
    }

    #[test]
    fn size_cap_removes_oldest_finished_verified_captures_until_under_cap() {
        let now = SystemTime::now();
        let entries = vec![
            entry("oldest", 5, 400, true, now),
            entry("middle", 4, 400, true, now),
            entry("newest", 1, 400, true, now),
        ];
        assert_eq!(
            doomed(plan(&entries, now, &policy(14, 800), &ran_at(0, now))),
            vec![PathBuf::from("oldest")]
        );
    }

    #[test]
    fn read_states_takes_lmu_from_the_top_level_and_others_from_sims() {
        let dir = std::env::temp_dir().join(format!("botracing-states-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("state.json");
        fs::write(
            &file,
            r#"{"lastRunAtMs":1000000,"syncing":false,"retries":{},"sims":{"iracing":{"lastRunAtMs":2000000,"syncing":true,"retries":{}},"x":{"retries":{"s1":{"n":1}}}}}"#,
        )
        .unwrap();
        let states = read_states(&file);
        assert_eq!(
            states["lmu"].last_run,
            Some(UNIX_EPOCH + Duration::from_millis(1_000_000))
        );
        assert!(states["lmu"].idle());
        assert!(states["iracing"].syncing);
        assert!(!states["iracing"].idle());
        assert!(states["x"].retry_pending);
        assert!(read_states(&dir.join("missing.json")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_on_a_temp_folder_follows_the_rules_and_keeps_the_rest() {
        let root = std::env::temp_dir().join(format!("botracing-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let now = SystemTime::now();
        // (name, marker, finished, age in days of the marker or of meta.json)
        for (name, marker, finished, age_days) in [
            ("old-verified", Some(VERIFIED), true, 30u32),
            ("old-sent-unverified", Some(SENT), true, 30),
            ("old-unmarked", None, true, 30),
            ("cut-short-verified", Some(VERIFIED), false, 30),
            ("recent-verified", Some(VERIFIED), true, 1),
        ] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("chunk.bin"), vec![0u8; 64]).unwrap();
            let meta = dir.join(META);
            let end = if finished {
                r#","endUtc":"2026-09-01T00:00:00Z""#
            } else {
                ""
            };
            fs::write(&meta, format!(r#"{{"sim":"lmu"{end}}}"#)).unwrap();
            let mut files = vec![meta];
            if let Some(body) = marker {
                let marker = dir.join(UPLOADED_MARKER);
                fs::write(&marker, body).unwrap();
                files.push(marker);
            }
            for file in files {
                fs::File::options()
                    .write(true)
                    .open(&file)
                    .unwrap()
                    .set_modified(at(age_days, now))
                    .unwrap();
            }
        }
        let p = prune(&root, now, &policy(14, u64::MAX), &ran_at(1, now)).unwrap();
        assert_eq!(p.held_bytes, 0);
        let mut names: Vec<_> = p
            .doomed
            .iter()
            .map(|p| p.file_name().unwrap().to_owned())
            .collect();
        names.sort();
        // The unverified ones go at 14 days (the exception), listed as such.
        assert_eq!(names, vec!["old-sent-unverified", "old-unmarked", "old-verified"]);
        assert_eq!(p.doomed_unverified.len(), 2);
        assert!(!root.join("old-verified").exists());
        assert!(!root.join("old-sent-unverified").exists());
        assert!(!root.join("old-unmarked").exists());
        assert!(root.join("cut-short-verified").exists());
        assert!(root.join("recent-verified").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_sim_with_a_retry_pending_is_reported_as_blocked() {
        let policy = Policy {
            keep: DAY * 14,
            cap_bytes: u64::MAX,
            sims: vec!["lmu".into(), "iracing".into()],
        };
        let states = HashMap::from([
            (
                "lmu".to_string(),
                SimState {
                    retry_pending: true,
                    ..Default::default()
                },
            ),
            ("iracing".to_string(), SimState::default()),
        ]);
        assert_eq!(blocked_sims(&policy, &states), vec!["lmu".to_string()]);
        // A sim switched off is not reported, even if it is retrying.
        let lmu_off = Policy {
            sims: vec!["iracing".into()],
            ..policy
        };
        assert!(blocked_sims(&lmu_off, &states).is_empty());
    }

    #[test]
    fn dry_run_counts_what_prune_would_delete_and_deletes_nothing() {
        let root = std::env::temp_dir().join(format!("botracing-dry-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (name, uploaded) in [("old-a", true), ("old-b", false)] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("chunk.bin"), vec![0u8; 100]).unwrap();
            let meta = dir.join(META);
            fs::write(&meta, r#"{"sim":"lmu","endUtc":"2026-09-01T00:00:00Z"}"#).unwrap();
            let file = if uploaded {
                let marker = dir.join(UPLOADED_MARKER);
                fs::write(&marker, VERIFIED).unwrap();
                marker
            } else {
                meta
            };
            let now = SystemTime::now();
            fs::File::options()
                .write(true)
                .open(&file)
                .unwrap()
                .set_modified(now - DAY * 30)
                .unwrap();
        }
        let now = SystemTime::now();
        let states = HashMap::from([(
            "lmu".to_string(),
            SimState {
                last_run: Some(now - DAY),
                ..Default::default()
            },
        )]);
        let policy = Policy {
            keep: DAY * 14,
            cap_bytes: u64::MAX,
            sims: vec!["lmu".into()],
        };
        let (p, bytes) = dry_run(&root, now, &policy, &states).unwrap();
        assert_eq!(p.doomed.len(), 2);
        // Each folder: chunk.bin (100), its meta.json; old-a also its marker.
        let meta_len = r#"{"sim":"lmu","endUtc":"2026-09-01T00:00:00Z"}"#.len() as u64;
        assert_eq!(bytes, (100 + meta_len + VERIFIED.len() as u64) + (100 + meta_len));
        assert!(root.join("old-a").exists());
        assert!(root.join("old-b").exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// A root as the tray has it: capture folders and the recorders' status files.
    fn root_with(name: &str, captures: &[&str]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("botracing-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("status.json"), "{}").unwrap();
        fs::write(root.join("status-iracing.json"), "{}").unwrap();
        for c in captures {
            let dir = root.join(c);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("chunk.bin"), vec![0u8; 10]).unwrap();
            fs::write(dir.join(META), r#"{"sim":"lmu","endUtc":"2026-09-01T00:00:00Z"}"#).unwrap();
            let marker = dir.join(UPLOADED_MARKER);
            fs::write(&marker, VERIFIED).unwrap();
            fs::File::options()
                .write(true)
                .open(&marker)
                .unwrap()
                .set_modified(SystemTime::now() - DAY * 30)
                .unwrap();
        }
        root
    }

    fn lmu_policy() -> Policy {
        Policy {
            keep: DAY * 14,
            cap_bytes: u64::MAX,
            sims: vec!["lmu".into()],
        }
    }

    fn lmu_idle(now: SystemTime) -> HashMap<String, SimState> {
        HashMap::from([(
            "lmu".to_string(),
            SimState {
                last_run: Some(now - DAY),
                ..Default::default()
            },
        )])
    }

    #[test]
    fn the_status_files_in_the_root_are_not_captures() {
        let root = root_with("scan-status", &["cap-a"]);
        let found = scan(&root).unwrap();
        assert_eq!(found.entries.len(), 1);
        assert!(found.skipped.is_empty(), "a status file is not a problem: {:?}", found.skipped);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_capture_that_cannot_be_read_is_skipped_and_the_others_still_go() {
        let root = root_with("prune-skip", &["bad", "cap-a", "cap-b"]);
        let now = SystemTime::now();
        let read = |p: &Path| {
            if p.ends_with("bad") {
                Err(io::Error::new(io::ErrorKind::PermissionDenied, "access denied"))
            } else {
                entry_of(p)
            }
        };
        let p = prune_using(&root, now, &lmu_policy(), &lmu_idle(now), &read, &|p| fs::remove_dir_all(p)).unwrap();
        assert_eq!(p.doomed.len(), 2, "the two readable captures went");
        assert!(root.join("bad").exists(), "the unreadable one is kept");
        assert!(!root.join("cap-a").exists() && !root.join("cap-b").exists());
        assert_eq!(p.skipped.len(), 1);
        assert!(p.skipped[0].0.ends_with("bad"));
        assert!(p.skipped[0].1.contains("access denied"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_capture_that_cannot_be_deleted_is_listed_and_the_next_is_still_deleted() {
        let root = root_with("prune-nodelete", &["cap-a", "cap-b", "cap-c"]);
        let now = SystemTime::now();
        let remove = |p: &Path| {
            if p.ends_with("cap-a") {
                Err(io::Error::new(io::ErrorKind::PermissionDenied, "in use"))
            } else {
                fs::remove_dir_all(p)
            }
        };
        let p = prune_using(&root, now, &lmu_policy(), &lmu_idle(now), &entry_of, &remove).unwrap();
        assert!(root.join("cap-a").exists(), "the one that would not go stays");
        assert!(!root.join("cap-b").exists() && !root.join("cap-c").exists(), "the others went");
        assert_eq!(p.doomed.len(), 2, "the plan names what went");
        assert!(p.skipped.iter().any(|(path, why)| path.ends_with("cap-a") && why.contains("could not delete")));
        let _ = fs::remove_dir_all(&root);
    }
}
