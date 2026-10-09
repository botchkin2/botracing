// Keeps the capture folder from growing. A capture is a folder under the
// capture root, with a meta.json (its sim, and endUtc once it has finished).
// Sync writes `uploaded.json` inside a capture once it has uploaded that
// capture's session.
//
// A marked capture goes once it is older than `keep`, and then, while the
// folder is still over `cap_bytes`, the oldest marked captures go first.
// An unmarked capture (one no uploaded session read) goes only once it ended
// more than `keep` ago AND the uploader has completed a run since it ended,
// with no sync running for its sim. It is never taken for the size cap.
// Each sim can be switched off; a switched-off sim is never touched.

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
pub const DEFAULT_SIM: &str = "lmu";

/// One capture on disk.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub path: PathBuf,
    pub sim: String,
    /// When it ended: meta.json's own time once it has an endUtc, else the
    /// folder's time (a capture cut short).
    pub ended: SystemTime,
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
    let mut total: u64 = entries.iter().map(|e| e.bytes).sum();
    let mut doomed: Vec<PathBuf> = Vec::new();

    for e in entries.iter().filter(|e| on(e) && !e.uploaded) {
        let st = states.get(&e.sim).copied().unwrap_or_default();
        let run_since_end = st.last_run.map_or(false, |run| run > e.ended);
        if old(e.ended) && run_since_end && !st.syncing {
            doomed.push(e.path.clone());
            total = total.saturating_sub(e.bytes);
        }
    }

    let mut candidates: Vec<&Entry> = entries.iter().filter(|e| on(e) && e.uploaded).collect();
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
        let (sim, ended) = read_meta(&path, folder)?;
        out.push(Entry {
            bytes: size_of(&path)?,
            modified,
            ended,
            sim,
            uploaded,
            path,
        });
    }
    Ok(out)
}

/// The sim and end time from a capture's meta.json. Without an endUtc (cut
/// short, or no meta.json at all) the capture ends when its folder last changed.
fn read_meta(dir: &Path, folder: SystemTime) -> io::Result<(String, SystemTime)> {
    let meta = dir.join(META);
    let Ok(text) = fs::read_to_string(&meta) else {
        return Ok((DEFAULT_SIM.to_string(), folder));
    };
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let sim = v
        .get("sim")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_SIM)
        .to_string();
    let ended = if v.get("endUtc").and_then(Value::as_str).is_some() {
        fs::metadata(&meta)?.modified().unwrap_or(folder)
    } else {
        folder
    };
    Ok((sim, ended))
}

/// Each sim's state from the uploader's state.json (`sims.<id>.lastRunAtMs`,
/// `sims.<id>.syncing`). A missing or unreadable file gives no states, so no
/// unmarked capture is ever pruned.
pub fn read_states(path: &Path) -> HashMap<String, SimState> {
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return HashMap::new();
    };
    let Some(sims) = v.get("sims").and_then(Value::as_object) else {
        return HashMap::new();
    };
    sims.iter()
        .map(|(id, st)| {
            let last_run = st
                .get("lastRunAtMs")
                .and_then(Value::as_u64)
                .map(|ms| UNIX_EPOCH + Duration::from_millis(ms));
            let syncing = st.get("syncing").and_then(Value::as_bool).unwrap_or(false);
            (id.clone(), SimState { last_run, syncing })
        })
        .collect()
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

    fn entry(name: &str, days_ago: u32, bytes: u64, uploaded: bool, now: SystemTime) -> Entry {
        Entry {
            path: PathBuf::from(name),
            sim: "lmu".into(),
            ended: at(days_ago, now),
            modified: at(days_ago, now),
            bytes,
            uploaded,
        }
    }

    fn ran_at(days_ago: u32, now: SystemTime) -> HashMap<String, SimState> {
        HashMap::from([(
            "lmu".to_string(),
            SimState {
                last_run: Some(at(days_ago, now)),
                syncing: false,
            },
        )])
    }

    #[test]
    fn deletes_uploaded_captures_older_than_keep_days() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-marked", 20, 10, true, now),
            entry("old-unmarked", 20, 10, false, now),
            entry("recent-marked", 3, 10, true, now),
        ];
        // No run for lmu: the unmarked one stays.
        assert_eq!(
            plan(&entries, now, &policy(14, u64::MAX), &HashMap::new()),
            vec![PathBuf::from("old-marked")]
        );
    }

    #[test]
    fn size_cap_never_takes_an_unmarked_capture() {
        let now = SystemTime::now();
        // Recent (inside keep_days), so only the cap could take them.
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
        // A run that is older than the capture's end: kept.
        assert!(plan(&old, now, &policy(14, u64::MAX), &ran_at(25, now)).is_empty());
        // Not old enough yet: kept even after a run.
        let recent = vec![entry("recent-unmarked", 5, 10, false, now)];
        assert!(plan(&recent, now, &policy(14, u64::MAX), &ran_at(0, now)).is_empty());
    }

    #[test]
    fn unmarked_is_kept_while_a_sync_runs_for_its_sim() {
        let now = SystemTime::now();
        let old = vec![entry("old-unmarked", 20, 10, false, now)];
        let syncing = HashMap::from([(
            "lmu".to_string(),
            SimState {
                last_run: Some(at(2, now)),
                syncing: true,
            },
        )]);
        assert!(plan(&old, now, &policy(14, u64::MAX), &syncing).is_empty());
    }

    #[test]
    fn a_switched_off_sim_is_never_pruned() {
        let now = SystemTime::now();
        let mut lmu = entry("lmu-marked", 30, 10, true, now);
        lmu.sim = "lmu".into();
        let mut iracing = entry("ir-unmarked", 30, 10, false, now);
        iracing.sim = "iracing".into();
        let only_iracing = Policy {
            keep: DAY * 14,
            cap_bytes: 0,
            sims: vec!["iracing".into()],
        };
        let states = HashMap::from([(
            "iracing".to_string(),
            SimState {
                last_run: Some(at(1, now)),
                syncing: false,
            },
        )]);
        // Only iracing is on: its unmarked capture goes, lmu's marked one stays.
        assert_eq!(
            plan(&[lmu, iracing], now, &only_iracing, &states),
            vec![PathBuf::from("ir-unmarked")]
        );
    }

    #[test]
    fn size_cap_removes_oldest_marked_captures_until_under_cap() {
        let now = SystemTime::now();
        let entries = vec![
            entry("oldest", 5, 400, true, now),
            entry("middle", 4, 400, true, now),
            entry("newest", 1, 400, true, now),
        ];
        assert_eq!(
            plan(&entries, now, &policy(14, 800), &HashMap::new()),
            vec![PathBuf::from("oldest")]
        );
    }

    #[test]
    fn read_states_takes_last_run_and_syncing_per_sim() {
        let dir = std::env::temp_dir().join(format!("botracing-states-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("state.json");
        fs::write(
            &file,
            r#"{"sims":{"lmu":{"lastRunAtMs":1000000,"syncing":false},"iracing":{"syncing":true}}}"#,
        )
        .unwrap();
        let states = read_states(&file);
        assert_eq!(
            states["lmu"].last_run,
            Some(UNIX_EPOCH + Duration::from_millis(1_000_000))
        );
        assert!(!states["lmu"].syncing);
        assert_eq!(states["iracing"].last_run, None);
        assert!(states["iracing"].syncing);
        assert!(read_states(&dir.join("missing.json")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_on_a_temp_folder_follows_the_rules_and_keeps_the_rest() {
        let root = std::env::temp_dir().join(format!("botracing-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let now = SystemTime::now();
        // (name, uploaded, age in days of the marker or of meta.json's endUtc)
        for (name, marked, age_days) in [
            ("old-marked", true, 30u32),
            ("old-unmarked", false, 30),
            ("recent-marked", true, 1),
        ] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("chunk.bin"), vec![0u8; 64]).unwrap();
            let meta = dir.join(META);
            fs::write(&meta, br#"{"sim":"lmu","endUtc":"2026-09-01T00:00:00Z"}"#).unwrap();
            let when = at(age_days, now);
            let file = if marked { dir.join(UPLOADED_MARKER) } else { meta };
            if marked {
                fs::write(&file, b"{}").unwrap();
            }
            fs::File::options()
                .write(true)
                .open(&file)
                .unwrap()
                .set_modified(when)
                .unwrap();
        }
        let states = HashMap::from([(
            "lmu".to_string(),
            SimState {
                last_run: Some(at(1, now)),
                syncing: false,
            },
        )]);
        let removed = prune(&root, now, &policy(14, u64::MAX), &states).unwrap();
        let mut names: Vec<_> = removed.iter().map(|p| p.file_name().unwrap().to_owned()).collect();
        names.sort();
        assert_eq!(names, vec!["old-marked", "old-unmarked"]);
        assert!(!root.join("old-marked").exists());
        assert!(!root.join("old-unmarked").exists());
        assert!(root.join("recent-marked").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
