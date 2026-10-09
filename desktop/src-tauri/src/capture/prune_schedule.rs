// Runs the cleanup on the tray's schedule: once at start, then again whenever
// the uploader completes a run (the newest lastRunAtMs changes). Each run is
// logged to prune.log beside the uploader's state. BOTRACING_PRUNE_DRY_RUN=1
// logs what would be deleted and deletes nothing.
use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::prune::{self, SimState};
use super::prune_settings;
use super::runner;

/// How often the tray looks at the uploader's state for a finished run.
const POLL: Duration = Duration::from_secs(60);

/// The files one cleanup run reads and writes.
#[derive(Clone)]
pub struct Paths {
    pub captures: PathBuf,
    pub state: PathBuf,
    pub settings: PathBuf,
    pub log: PathBuf,
}

impl Paths {
    /// The paths for the tray whose data folder is `data`. The uploader's folder
    /// is the one the watcher is started with (`sidecar::uploader_home`), so the
    /// cleanup reads the state the tray's own uploader writes.
    pub fn for_tray(data: &Path) -> Paths {
        let uploader = crate::sidecar::uploader_home(data);
        Paths {
            captures: runner::capture_root(),
            state: uploader.join("state.json"),
            settings: uploader.join("prune.json"),
            log: uploader.join("prune.log"),
        }
    }
}

/// One cleanup run: the line it logs.
pub fn run_once(paths: &Paths, now: SystemTime, dry: bool) -> String {
    let settings = prune_settings::load(&paths.settings);
    let policy = settings.policy();
    let states = prune::read_states(&paths.state);
    let note = waiting_note(&prune::blocked_sims(&policy, &states));
    if dry {
        return match prune::dry_run(&paths.captures, now, &policy, &states) {
            Ok((n, bytes)) => {
                format!("dry run: would delete {n} captures, {bytes} bytes; nothing deleted{note}")
            }
            Err(e) => missing_or(e, "dry run failed"),
        };
    }
    match prune::prune(&paths.captures, now, &policy, &states) {
        Ok(removed) => format!("deleted {} captures{note}", removed.len()),
        Err(e) => missing_or(e, "cleanup failed"),
    }
}

/// No capture folder yet is not a failure: the recorder has not run.
fn missing_or(e: io::Error, what: &str) -> String {
    if e.kind() == io::ErrorKind::NotFound {
        "nothing to clean: no capture folder yet".into()
    } else {
        format!("{what}: {e}")
    }
}

fn waiting_note(blocked: &[String]) -> String {
    if blocked.is_empty() {
        String::new()
    } else {
        format!("; cleanup waits on a retry for {}", blocked.join(", "))
    }
}

/// The newest completed uploader run across the sims, if any.
pub fn newest_run(states: &HashMap<String, SimState>) -> Option<SystemTime> {
    states.values().filter_map(|s| s.last_run).max()
}

/// Starts the cleanup thread: a run at once, then one each time the newest
/// uploader run changes.
pub fn spawn(paths: Paths) {
    let dry = std::env::var("BOTRACING_PRUNE_DRY_RUN").map_or(false, |v| v == "1");
    std::thread::spawn(move || {
        let mut seen: Option<Option<SystemTime>> = None;
        loop {
            let newest = newest_run(&prune::read_states(&paths.state));
            if seen != Some(newest) {
                let line = run_once(&paths, SystemTime::now(), dry);
                log(&paths.log, &line);
                seen = Some(newest);
            }
            std::thread::sleep(POLL);
        }
    });
}

pub fn log(path: &Path, line: &str) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{secs} {line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration as D;

    const DAY: D = D::from_secs(86_400);

    /// A folder with one finished, uploaded capture 30 days old, the uploader
    /// state (a run yesterday), and default settings.
    fn setup(name: &str, retry: bool) -> Paths {
        let base =
            std::env::temp_dir().join(format!("botracing-sched-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let captures = base.join("lap-capture");
        let uploader = base.join("lap-uploader");
        let dir = captures.join("old");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("chunk.bin"), vec![0u8; 50]).unwrap();
        fs::write(
            dir.join(prune::META),
            r#"{"sim":"lmu","endUtc":"2026-09-01T00:00:00Z"}"#,
        )
        .unwrap();
        let marker = dir.join(prune::UPLOADED_MARKER);
        fs::write(&marker, b"{}").unwrap();
        fs::File::options()
            .write(true)
            .open(&marker)
            .unwrap()
            .set_modified(SystemTime::now() - DAY * 30)
            .unwrap();
        fs::create_dir_all(&uploader).unwrap();
        let yesterday_ms = (SystemTime::now() - DAY)
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let retry_field = if retry { r#","retryAtMs":5"# } else { "" };
        fs::write(
            uploader.join("state.json"),
            format!(r#"{{"lastRunAtMs":{yesterday_ms},"syncing":false{retry_field}}}"#),
        )
        .unwrap();
        Paths {
            captures,
            state: uploader.join("state.json"),
            settings: uploader.join("prune.json"),
            log: uploader.join("prune.log"),
        }
    }

    #[test]
    fn a_run_deletes_the_old_uploaded_capture_and_says_so() {
        let paths = setup("delete", false);
        let line = run_once(&paths, SystemTime::now(), false);
        assert_eq!(line, "deleted 1 captures");
        assert!(!paths.captures.join("old").exists());
    }

    #[test]
    fn a_dry_run_says_what_it_would_delete_and_deletes_nothing() {
        let paths = setup("dry", false);
        let line = run_once(&paths, SystemTime::now(), true);
        assert!(
            line.starts_with("dry run: would delete 1 captures, "),
            "{line}"
        );
        assert!(line.ends_with("; nothing deleted"), "{line}");
        assert!(paths.captures.join("old").exists());
    }

    #[test]
    fn a_retry_pending_is_named_in_the_line() {
        let paths = setup("retry", true);
        let line = run_once(&paths, SystemTime::now(), true);
        assert!(line.ends_with("cleanup waits on a retry for lmu"), "{line}");
    }

    #[test]
    fn no_capture_folder_is_nothing_to_clean_not_an_error() {
        let mut paths = setup("nofolder", false);
        paths.captures = paths.captures.join("missing");
        assert_eq!(
            run_once(&paths, SystemTime::now(), false),
            "nothing to clean: no capture folder yet"
        );
    }

    #[test]
    fn the_newest_run_is_the_latest_across_sims() {
        let now = SystemTime::now();
        let states = HashMap::from([
            (
                "lmu".to_string(),
                SimState {
                    last_run: Some(now - DAY),
                    ..Default::default()
                },
            ),
            (
                "iracing".to_string(),
                SimState {
                    last_run: Some(now),
                    ..Default::default()
                },
            ),
            ("x".to_string(), SimState::default()),
        ]);
        assert_eq!(newest_run(&states), Some(now));
        assert_eq!(newest_run(&HashMap::new()), None);
    }

    #[test]
    fn cleanup_reads_the_state_the_watcher_is_started_with() {
        let data = PathBuf::from(r"C:\Users\x\AppData\Local\BotRacing");
        let paths = Paths::for_tray(&data);
        // The watcher's LAP_UPLOADER_HOME comes from the same function.
        let watcher_home = crate::sidecar::uploader_home(&data);
        assert_eq!(paths.state, watcher_home.join("state.json"));
        assert_eq!(paths.settings, watcher_home.join("prune.json"));
        assert!(!paths.state.to_string_lossy().contains("lap-uploader"));
    }

    /// Reads this PC's real capture folder and uploader state; deletes nothing.
    /// Run by hand: cargo test --bin botracing real_folder_dry_run -- --ignored --nocapture
    #[test]
    #[ignore = "reads this PC's real capture folder; run by hand"]
    fn real_folder_dry_run() {
        let data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .expect("LOCALAPPDATA")
            .join(crate::profile::data_dir_name());
        let paths = Paths::for_tray(&data);
        let line = run_once(&paths, SystemTime::now(), true);
        println!("{line}");
        assert!(line.starts_with("dry run"), "{line}");
    }
}
