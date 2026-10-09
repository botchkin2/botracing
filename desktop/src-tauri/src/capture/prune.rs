// Keeps the capture folder from growing. A capture is a folder under the
// capture root. Sync writes `uploaded.json` inside a capture once it has
// uploaded that capture's session. Only a capture with that marker can be
// deleted: one without it is never touched, whatever its age or the size cap.
// A marked capture goes once it is older than `keep`, and then, while the
// folder is still over `cap_bytes`, the oldest marked captures go first.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// The file sync writes inside a capture once its session is uploaded.
pub const UPLOADED_MARKER: &str = "uploaded.json";

/// One capture on disk, with whether its session has been uploaded.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub path: PathBuf,
    pub modified: SystemTime,
    pub bytes: u64,
    pub uploaded: bool,
}

/// Whether a capture folder holds the sync marker.
pub fn has_marker(path: &Path) -> bool {
    path.is_dir() && path.join(UPLOADED_MARKER).is_file()
}

/// The paths to delete, oldest first. Only uploaded entries are candidates.
pub fn plan(entries: &[Entry], now: SystemTime, keep: Duration, cap_bytes: u64) -> Vec<PathBuf> {
    let mut candidates: Vec<&Entry> = entries.iter().filter(|e| e.uploaded).collect();
    candidates.sort_by_key(|e| e.modified);
    let mut doomed: Vec<PathBuf> = Vec::new();
    let mut total: u64 = entries.iter().map(|e| e.bytes).sum();
    for e in &candidates {
        if now
            .duration_since(e.modified)
            .map_or(false, |age| age > keep)
        {
            doomed.push(e.path.clone());
            total = total.saturating_sub(e.bytes);
        }
    }
    for e in &candidates {
        if total <= cap_bytes {
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

/// The top-level captures of `root` with their sizes and marker state. Age is
/// the marker's time for an uploaded capture (when it was uploaded), else the
/// folder's own time.
pub fn scan(root: &Path) -> io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for item in fs::read_dir(root)? {
        let path = item.map_err(io::Error::from)?.path();
        let uploaded = has_marker(&path);
        let when = if uploaded {
            path.join(UPLOADED_MARKER)
        } else {
            path.clone()
        };
        let modified = fs::metadata(&when)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        out.push(Entry {
            bytes: size_of(&path)?,
            modified,
            uploaded,
            path,
        });
    }
    Ok(out)
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
    keep: Duration,
    cap_bytes: u64,
) -> io::Result<Vec<PathBuf>> {
    let doomed = plan(&scan(root)?, now, keep, cap_bytes);
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

    fn entry(name: &str, days_ago: u32, bytes: u64, uploaded: bool, now: SystemTime) -> Entry {
        Entry {
            path: PathBuf::from(name),
            modified: at(days_ago, now),
            bytes,
            uploaded,
        }
    }

    #[test]
    fn deletes_uploaded_captures_older_than_keep_days() {
        let now = SystemTime::now();
        let entries = vec![
            entry("old-marked", 20, 10, true, now),
            entry("old-unmarked", 20, 10, false, now),
            entry("recent-marked", 3, 10, true, now),
        ];
        assert_eq!(
            plan(&entries, now, DAY * 14, u64::MAX),
            vec![PathBuf::from("old-marked")]
        );
    }

    #[test]
    fn never_deletes_an_unmarked_capture_even_over_the_cap() {
        let now = SystemTime::now();
        let entries = vec![
            entry("a", 30, 500, false, now),
            entry("b", 1, 500, false, now),
        ];
        assert!(plan(&entries, now, DAY * 14, 100).is_empty());
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
            plan(&entries, now, DAY * 14, 800),
            vec![PathBuf::from("oldest")]
        );
    }

    #[test]
    fn prune_on_a_temp_folder_follows_the_marker_and_keeps_the_rest() {
        let root = std::env::temp_dir().join(format!("botracing-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (name, marked, age_days) in [
            ("old-marked", true, 30u64),
            ("old-unmarked", false, 30),
            ("recent-marked", true, 1),
        ] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("chunk.bin"), vec![0u8; 64]).unwrap();
            if marked {
                fs::write(dir.join(UPLOADED_MARKER), b"{}").unwrap();
            }
            if marked {
                let when = SystemTime::now() - DAY * age_days as u32;
                fs::File::options()
                    .write(true)
                    .open(dir.join(UPLOADED_MARKER))
                    .unwrap()
                    .set_modified(when)
                    .unwrap();
            }
        }
        let removed = prune(&root, SystemTime::now(), DAY * 14, u64::MAX).unwrap();
        assert_eq!(removed, vec![root.join("old-marked")]);
        assert!(!root.join("old-marked").exists());
        assert!(root.join("old-unmarked").exists());
        assert!(root.join("recent-marked").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
