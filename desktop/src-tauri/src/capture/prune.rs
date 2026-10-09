// Keeps the capture folder from growing. A capture is a folder under the
// capture root, with a meta.json (its sim, and endUtc once it has finished).
// Sync writes `uploaded.json` inside a capture once it has uploaded that
// capture's session.
//
// Every deletion needs its sim to be idle: no sync running and no retry
// pending (the uploader's state). A switched-off sim is never touched.
// A marked capture (uploaded) goes once it has finished (meta.json has an
// endUtc) and is older than `keep`; then, while the folder is still over
// `cap_bytes`, the oldest finished marked captures go first.
// An unmarked capture (no uploaded session read it) goes once it ended more
// than `keep` ago AND the uploader completed a run after it ended. It is never
// taken for the size cap. Without the uploader's state, nothing unmarked goes.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

/// The file sync writes inside a capture once its session is uploaded.
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
    /// The marker's time for an uploaded capture, else the folder's time.
    pub modified: SystemTime,
    pub bytes: u64,
    pub uploaded: bool,
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

/// Whether a capture folder holds the sync marker.
pub fn has_marker(path: &Path) -> bool {
    path.is_dir() && path.join(UPLOADED_MARKER).is_file()
}

/// The paths to delete, oldest first.
pub fn plan(
    entries: &[Entry],
    now: SystemTime,
    policy: &Policy,
    states: &HashMap<String, SimState>,
) -> Vec<PathBuf> {
    let on = |e: &Entry| policy.sims.iter().any(|s| *s == e.sim);
    let old = |t: SystemTime| now.duration_since(t).map_or(false, |age| age > policy.keep);
    // A sim with no state at all is not idle: nothing of it is pruned.
    let idle = |e: &Entry| states.get(&e.sim).map_or(false, |s| s.idle());
    let mut total: u64 = entries.iter().map(|e| e.bytes).sum();
    let mut doomed: Vec<PathBuf> = Vec::new();

    for e in entries.iter().filter(|e| on(e) && !e.uploaded && idle(e)) {
        let Some(st) = states.get(&e.sim) else {
            continue;
        };
        let run_since_end = st.last_run.map_or(false, |run| run > e.ended);
        if old(e.ended) && run_since_end {
            doomed.push(e.path.clone());
            total = total.saturating_sub(e.bytes);
        }
    }

    let mut candidates: Vec<&Entry> = entries
        .iter()
        .filter(|e| on(e) && e.uploaded && e.finished && idle(e))
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
    doomed
}

/// The top-level captures of `root` with their sizes, sims and marker state.
pub fn scan(root: &Path) -> io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for item in fs::read_dir(root)? {
        let path = item.map_err(io::Error::from)?.path();
        let folder = fs::metadata(&path)?.modified().unwrap_or(UNIX_EPOCH);
        let uploaded = has_marker(&path);
        let modified = if uploaded {
            fs::metadata(path.join(UPLOADED_MARKER))?
                .modified()
                .unwrap_or(UNIX_EPOCH)
        } else {
            folder
        };
        let (sim, ended, finished) = read_meta(&path, folder)?;
        out.push(Entry {
            bytes: size_of(&path)?,
            modified,
            ended,
            finished,
            sim,
            uploaded,
            path,
        });
    }
    Ok(out)
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

/// Deletes what `plan` chooses under `root` and returns the paths removed.
pub fn prune(
    root: &Path,
    now: SystemTime,
    policy: &Policy,
    states: &HashMap<String, SimState>,
) -> io::Result<Vec<PathBuf>> {
    let doomed = plan(&scan(root)?, now, policy, states);
    for path in &doomed {
        fs::remove_dir_all(path)?;
    }
    Ok(doomed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(86_400);

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

    /// A finished LMU capture that ended `days_ago`, marked or not.
    fn entry(name: &str, days_ago: u32, bytes: u64, uploaded: bool, now: SystemTime) -> Entry {
        Entry {
            path: PathBuf::from(name),
            sim: "lmu".into(),
            ended: at(days_ago, now),
            finished: true,
            modified: at(days_ago, now),
            bytes,
            uploaded,
        }
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
    fn deletes_finished_marked_captures_older_than_keep_days() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-marked", 20, 10, true, now),
            entry("old-unmarked", 20, 10, false, now),
            entry("recent-marked", 3, 10, true, now),
        ];
        // The last run came before these captures ended: the unmarked one stays.
        assert_eq!(
            plan(&entries, now, &policy(14, u64::MAX), &ran_at(25, now)),
            vec![PathBuf::from("old-marked")]
        );
    }

    #[test]
    fn with_no_uploader_state_nothing_is_pruned() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-marked", 20, 10, true, now),
            entry("old-unmarked", 20, 10, false, now),
        ];
        assert!(plan(&entries, now, &policy(14, 5), &HashMap::new()).is_empty());
    }

    #[test]
    fn a_marked_capture_is_kept_until_the_recorder_finished_it() {
        let now = SystemTime::now();
        let mut cut_short = entry("cut-short-marked", 30, 10, true, now);
        cut_short.finished = false;
        assert!(plan(&[cut_short], now, &policy(14, u64::MAX), &ran_at(0, now)).is_empty());
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
            assert!(plan(&entries, now, &policy(14, u64::MAX), &states).is_empty());
        }
    }

    #[test]
    fn size_cap_never_takes_an_unmarked_capture() {
        let now = SystemTime::now();
        // Recent, so only the cap could take them.
        let entries = vec![
            entry("a", 3, 500, false, now),
            entry("b", 1, 500, false, now),
        ];
        assert!(plan(&entries, now, &policy(14, 100), &ran_at(0, now)).is_empty());
    }

    #[test]
    fn unmarked_is_pruned_only_when_old_and_a_run_came_after_it_ended() {
        let now = SystemTime::now();
        let old = vec![entry("old-unmarked", 20, 10, false, now)];
        // A run 2 days ago, after the capture ended 20 days ago: pruned.
        assert_eq!(
            plan(&old, now, &policy(14, u64::MAX), &ran_at(2, now)),
            vec![PathBuf::from("old-unmarked")]
        );
        // The last run is older than the capture's end: kept.
        assert!(plan(&old, now, &policy(14, u64::MAX), &ran_at(25, now)).is_empty());
        // Not old enough yet: kept even after a run.
        let recent = vec![entry("recent-unmarked", 5, 10, false, now)];
        assert!(plan(&recent, now, &policy(14, u64::MAX), &ran_at(0, now)).is_empty());
    }

    #[test]
    fn a_switched_off_sim_is_never_pruned() {
        let now = SystemTime::now();
        let lmu = entry("lmu-marked", 30, 10, true, now);
        let mut iracing = entry("ir-unmarked", 30, 10, false, now);
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
            plan(&[lmu, iracing], now, &only_iracing, &states),
            vec![PathBuf::from("ir-unmarked")]
        );
    }

    #[test]
    fn size_cap_removes_oldest_finished_marked_captures_until_under_cap() {
        let now = SystemTime::now();
        let entries = vec![
            entry("oldest", 5, 400, true, now),
            entry("middle", 4, 400, true, now),
            entry("newest", 1, 400, true, now),
        ];
        assert_eq!(
            plan(&entries, now, &policy(14, 800), &ran_at(0, now)),
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
        // (name, uploaded, finished, age in days of the marker or of meta.json)
        for (name, marked, finished, age_days) in [
            ("old-marked", true, true, 30u32),
            ("old-unmarked", false, true, 30),
            ("cut-short-marked", true, false, 30),
            ("recent-marked", true, true, 1),
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
            let file = if marked {
                let marker = dir.join(UPLOADED_MARKER);
                fs::write(&marker, b"{}").unwrap();
                marker
            } else {
                meta
            };
            fs::File::options()
                .write(true)
                .open(&file)
                .unwrap()
                .set_modified(at(age_days, now))
                .unwrap();
        }
        let removed = prune(&root, now, &policy(14, u64::MAX), &ran_at(1, now)).unwrap();
        let mut names: Vec<_> = removed
            .iter()
            .map(|p| p.file_name().unwrap().to_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["old-marked", "old-unmarked"]);
        assert!(!root.join("old-marked").exists());
        assert!(!root.join("old-unmarked").exists());
        assert!(root.join("cut-short-marked").exists());
        assert!(root.join("recent-marked").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
