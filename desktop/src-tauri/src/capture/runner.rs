// The recorder's thread, and the tray's one-line view of it.
//
// The thread runs below normal priority (a VR rig must never lose a frame to
// the recorder), holds the single-recorder mutex while it records, and on
// quit finishes the open chunk and writes endUtc. Pausing uploads does not
// touch it: capture is local, and the files upload when uploads resume.

use crate::capture::layout::Layout;
use crate::capture::recorder::{Recorder, Source, Status};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The two header files, in include order (tools/capture/layout.py HEADER_FILES).
const HEADER_FILES: [&str; 2] = ["InternalsPlugin.hpp", "SharedMemoryInterface.hpp"];
const DEFAULT_HEADER_DIR: &str =
    r"C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\Support\SharedMemoryInterface";
/// The Steam install whose `libraryfolders.vdf` lists the other libraries.
const DEFAULT_STEAM_ROOT: &str = r"C:\Program Files (x86)\Steam";
/// How often a recorder that could not start (no header, another recorder
/// running) tries again.
const RETRY: Duration = Duration::from_secs(10);
/// A chunk is cut at least this often, so a crash, a GPU hang or a killed tray loses at most this much
/// of a drive (it was 60 s). 4x the chunk files for the same bytes, plus a parquet footer each
/// (pit wall thread 100, gauge #6859).
pub const CHUNK_MS: u64 = 15_000;

/// What the menu shows about the recorder: Recording, Waiting for LMU, or the
/// reason it is not recording.
#[derive(Clone, Debug, PartialEq)]
pub enum Line {
    Starting,
    Another,
    Failed(String),
    Status(Status),
    /// A line another recorder (iRacing's) wrote for itself.
    Text(String),
}

pub fn line(l: &Line) -> String {
    match l {
        Line::Starting => "Recorder: starting".into(),
        Line::Another => "Recorder: another recorder is running".into(),
        Line::Failed(why) => format!("Recorder: {why}"),
        Line::Text(text) => text.clone(),
        Line::Status(s) => match s.state {
            "recording" if s.dropped_pct > 1.0 => {
                format!("Recording ({:.0}% dropped)", s.dropped_pct)
            }
            "recording" if s.write_error.is_some() => "Recording (a chunk could not be written)".into(),
            "recording" => "Recording".into(),
            "refused" => format!("Recorder: {}", s.layout_reason),
            "stopped" => "Recorder: stopped".into(),
            // No game and a game between sessions both read the same to a driver.
            _ => "Waiting for LMU".into(),
        },
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The layout from an LMU install's header files.
pub fn load_layout(dir: &Path) -> Result<Layout, String> {
    let mut text = String::new();
    for name in HEADER_FILES {
        let path = dir.join(name);
        let bytes = std::fs::read(&path).map_err(|_| format!("no {}", path.display()))?;
        text.push_str(&String::from_utf8_lossy(&bytes));
        text.push('\n');
    }
    Layout::parse(&text).map_err(|e| format!("the game's header: {e}"))
}

pub struct Handle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    line: Arc<Mutex<Line>>,
}

impl Handle {
    pub fn line(&self) -> String {
        line(&self.line.lock().unwrap())
    }

    /// Asks the thread to finish the open chunk and mark the capture ended,
    /// and waits for it (or gives up after `wait`). True when the thread ended.
    pub fn stop(&mut self, wait: Duration) -> bool {
        self.stop.store(true, Ordering::SeqCst);
        let Some(join) = self.join.take() else { return true };
        let end = std::time::Instant::now() + wait;
        while !join.is_finished() && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(20));
        }
        if join.is_finished() {
            let _ = join.join();
            return true;
        }
        false
    }
}

/// `LMU_SHM_HEADER_DIR` overrides everything. Otherwise the header folder is
/// looked up in every Steam library listed by Steam's `libraryfolders.vdf`
/// (Steam's root from the registry, else the default install), and the
/// default install path is the fallback.
pub fn header_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("LMU_SHM_HEADER_DIR") {
        return PathBuf::from(dir);
    }
    let steam = steam_root(steam_path_from_registry(), Path::new(DEFAULT_STEAM_ROOT));
    let vdf = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf"))
        .unwrap_or_default();
    find_header_dir(&steam, &vdf, |dir| dir.join(HEADER_FILES[0]).is_file())
        .unwrap_or_else(|| PathBuf::from(DEFAULT_HEADER_DIR))
}

/// Steam's root: the registry's SteamPath when it is there, else the default.
pub fn steam_root(registry: Option<PathBuf>, default: &Path) -> PathBuf {
    registry.unwrap_or_else(|| default.to_path_buf())
}

/// A registry string value as a path: UTF-16 without its trailing NUL.
pub fn path_from_wide(units: &[u16]) -> PathBuf {
    let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
    PathBuf::from(String::from_utf16_lossy(&units[..end]))
}

/// `HKCU\Software\Valve\Steam\SteamPath`: where Steam is installed, even when
/// it is not on C:. None when the key is missing or unreadable.
#[cfg(windows)]
fn steam_path_from_registry() -> Option<PathBuf> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
    };
    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let (key_path, value) = (wide(r"Software\Valve\Steam"), wide("SteamPath"));
    let mut key: HKEY = null_mut();
    // SAFETY: NUL-terminated key path, a valid out pointer; closed below.
    let code = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key_path.as_ptr(), 0, KEY_QUERY_VALUE, &mut key) };
    if code != ERROR_SUCCESS {
        return None;
    }
    let mut bytes: u32 = 0;
    // SAFETY: the first call only asks for the size of the value.
    let size = unsafe {
        RegQueryValueExW(key, value.as_ptr(), null(), null_mut(), null_mut(), &mut bytes)
    };
    let mut buf = vec![0u16; (bytes as usize).div_ceil(2)];
    let mut read = size == ERROR_SUCCESS && !buf.is_empty();
    if read {
        // SAFETY: `buf` has room for `bytes` bytes, as the size call reported.
        let code = unsafe {
            RegQueryValueExW(
                key,
                value.as_ptr(),
                null(),
                null_mut(),
                buf.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        read = code == ERROR_SUCCESS;
    }
    // SAFETY: `key` was opened above and is closed once.
    unsafe { RegCloseKey(key) };
    read.then(|| path_from_wide(&buf))
}

#[cfg(not(windows))]
fn steam_path_from_registry() -> Option<PathBuf> {
    None
}

/// The header folder in the first Steam library (the install itself first,
/// then the libraries `vdf` lists) where `has_header` finds the header.
pub fn find_header_dir(
    steam_root: &Path,
    vdf: &str,
    has_header: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let libraries = std::iter::once(steam_root.to_path_buf()).chain(library_paths(vdf));
    libraries
        .map(|lib| header_under(&lib))
        .find(|dir| has_header(dir))
}

/// Where LMU's header folder sits inside a Steam library.
fn header_under(library: &Path) -> PathBuf {
    library
        .join("steamapps")
        .join("common")
        .join("Le Mans Ultimate")
        .join("Support")
        .join("SharedMemoryInterface")
}

/// The `"path"` of every library in a `libraryfolders.vdf`, in file order.
/// Steam writes Windows paths with doubled backslashes, which come back single.
pub fn library_paths(vdf: &str) -> Vec<PathBuf> {
    static PATH_LINE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#""path"\s+"((?:[^"\\]|\\.)*)""#).expect("valid regex")
    });
    PATH_LINE
        .captures_iter(vdf)
        .map(|c| PathBuf::from(c[1].replace(r"\\", r"\")))
        .collect()
}

/// `LAP_CAPTURE` overrides `%LOCALAPPDATA%\lap-capture` (a profile's own,
/// `lap-capture-<profile>`, profile.rs). The tray hands the result to the
/// uploader as LAP_CAPTURE (sidecar.rs), so both read the same folder.
pub fn capture_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("LAP_CAPTURE") {
        return PathBuf::from(dir);
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(crate::profile::capture_dir_name())
}

#[cfg(windows)]
pub fn start(root: PathBuf, header_dir: PathBuf) -> Handle {
    let stop = Arc::new(AtomicBool::new(false));
    let line = Arc::new(Mutex::new(Line::Starting));
    let (stop_t, line_t) = (stop.clone(), line.clone());
    let join = std::thread::Builder::new()
        .name("recorder".into())
        .spawn(move || {
            crate::capture::win::lower_priority();
            run(&stop_t, &line_t, root, header_dir);
        })
        .ok();
    Handle { stop, join, line }
}

/// How a recorder that stopped by itself is started again.
pub struct Backoff {
    /// The wait after the first failure; doubled after each one in a row.
    pub first: Duration,
    pub max: Duration,
    /// An attempt that ran this long counts as healthy: the next failure starts again at `first`.
    pub healthy: Duration,
}

pub const BACKOFF: Backoff = Backoff {
    first: Duration::from_secs(5),
    max: Duration::from_secs(60),
    healthy: Duration::from_secs(120),
};

/// Runs `attempt` until `stop`: a recorder that fails to start (the game's header changed under it), returns an
/// error or panics is started again after a growing wait, and each of those is logged (`log`) and shown on the
/// tray's line (`say`), never as an alert. `attempt` returns Ok when it ended because `stop` was set.
pub fn supervise(
    stop: &AtomicBool,
    backoff: &Backoff,
    log: &dyn Fn(&str),
    say: &dyn Fn(Line),
    mut attempt: impl FnMut() -> Result<(), String>,
) {
    let mut wait = backoff.first;
    while !stop.load(Ordering::SeqCst) {
        let began = std::time::Instant::now();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut attempt));
        let why = match outcome {
            Ok(Ok(())) => return,
            Ok(Err(why)) => why,
            Err(panic) => {
                let text = panic
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| panic.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown".into());
                format!("panicked: {text}")
            }
        };
        if stop.load(Ordering::SeqCst) {
            return;
        }
        if began.elapsed() >= backoff.healthy {
            wait = backoff.first;
        }
        log(&format!("recorder stopped ({why}); starting again in {} s", wait.as_secs_f32()));
        say(Line::Failed(why));
        let end = std::time::Instant::now() + wait;
        while !stop.load(Ordering::SeqCst) && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(20));
        }
        wait = (wait * 2).min(backoff.max);
    }
}

/// The recorder's own log: `<capture root>/recorder.log` (the same line format as launch.log).
pub fn recorder_log(root: &Path, text: &str) {
    crate::launch_log::note_file(&root.join("recorder.log"), "recorder", text);
}

#[cfg(windows)]
fn run(stop: &AtomicBool, line: &Mutex<Line>, root: PathBuf, header_dir: PathBuf) {
    let log_root = root.clone();
    supervise(
        stop,
        &BACKOFF,
        &|t| recorder_log(&log_root, t),
        &|l| *line.lock().unwrap() = l,
        || run_once(stop, line, &root, &header_dir),
    );
}

#[cfg(windows)]
fn run_once(stop: &AtomicBool, line: &Mutex<Line>, root: &Path, header_dir: &Path) -> Result<(), String> {
    use crate::capture::win::{RecorderLock, Shm};
    let (root, header_dir) = (root.to_path_buf(), header_dir.to_path_buf());
    let say = |l: Line| *line.lock().unwrap() = l;
    // Waits out the reasons it cannot start; any of them can clear by itself
    // (the other recorder exits, the game updates its header).
    let sleep = |d: Duration| {
        let end = std::time::Instant::now() + d;
        while !stop.load(Ordering::SeqCst) && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(100));
        }
    };
    let (_lock, layout) = loop {
        if stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        let Some(lock) = RecorderLock::acquire() else {
            say(Line::Another);
            sleep(RETRY);
            continue;
        };
        match load_layout(&header_dir) {
            Ok(layout) => break (lock, layout),
            Err(why) => {
                say(Line::Failed(why));
                drop(lock);
                sleep(RETRY);
            }
        }
    };
    let size = layout.size;
    let log_root = root.clone();
    let mut rec = match Recorder::new(layout, root, Shm { size }, CHUNK_MS) {
        Ok(rec) => rec,
        Err(why) => return Err(format!("the game's header: {why}")),
    };
    drive(&mut rec, stop, line, &|t| recorder_log(&log_root, t));
    Ok(())
}

/// iRacing's recorder on its own thread, into the same capture folder. It needs
/// no header files and no mutex: the SDK's map is read-only and read by any
/// number of tools.
#[cfg(windows)]
pub fn start_iracing(root: PathBuf) -> Handle {
    use crate::capture::ir_recorder::{line as ir_line, IrRecorder};
    use crate::capture::win::IrShm;
    let stop = Arc::new(AtomicBool::new(false));
    let line = Arc::new(Mutex::new(Line::Text("Waiting for iRacing".into())));
    let (stop_t, line_t) = (stop.clone(), line.clone());
    let join = std::thread::Builder::new()
        .name("recorder-iracing".into())
        .spawn(move || {
            crate::capture::win::lower_priority();
            let log_root = root.clone();
            supervise(
                &stop_t,
                &BACKOFF,
                &|t| recorder_log(&log_root, &format!("iracing: {t}")),
                &|l| {
                    *line_t.lock().unwrap() = match l {
                        Line::Failed(why) => Line::Text(format!("iRacing recorder: {why}")),
                        other => other,
                    }
                },
                || {
                    let mut rec = IrRecorder::new(IrShm::new(), root.clone());
                    crate::capture::ir_recorder::drive(&mut rec, &stop_t, |rec| {
                        *line_t.lock().unwrap() = Line::Text(ir_line(&rec.status));
                    });
                    rec.shutdown(now_ms());
                    *line_t.lock().unwrap() = Line::Text(ir_line(&rec.status));
                    Ok(())
                },
            );
        })
        .ok();
    Handle { stop, join, line }
}

/// The longest a recorder sleeps before it looks at its stop flag again. With
/// no game the tick asks for 5 s, and a quit waited that long for the thread
/// while it held the tray's event loop (quit.log "recorders stopped +3.8s").
pub const STOP_SLICE: Duration = Duration::from_millis(100);

/// Sleeps `d`, or less when `wake` says so; looked at every STOP_SLICE.
fn sleep_unless(d: Duration, wake: &dyn Fn() -> bool) {
    let end = std::time::Instant::now() + d;
    while !wake() {
        let left = end.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            return;
        }
        std::thread::sleep(left.min(STOP_SLICE));
    }
}

/// The loop: tick, publish the status for the menu, sleep what the tick asked.
/// `log` takes what the recorder has to say for the recorder log.
pub fn drive<S: Source>(rec: &mut Recorder<S>, stop: &AtomicBool, line: &Mutex<Line>, log: &dyn Fn(&str)) {
    let mut power = crate::capture::power::FLUSHES.register();
    while !stop.load(Ordering::SeqCst) {
        let sleep = rec.tick(now_ms());
        // A shutdown or a sleep is coming: what is held goes to the disk now (power.rs).
        if power.due() {
            rec.persist(now_ms());
            power.done();
        }
        for note in rec.notes.drain(..) {
            log(&note);
        }
        *line.lock().unwrap() = Line::Status(rec.status.clone());
        sleep_unless(sleep, &|| stop.load(Ordering::SeqCst) || power.due());
    }
    rec.shutdown(now_ms());
    *line.lock().unwrap() = Line::Status(rec.status.clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    const FAST: Backoff = Backoff {
        first: Duration::from_millis(5),
        max: Duration::from_millis(20),
        healthy: Duration::from_millis(300),
    };

    #[test]
    fn a_recorder_that_fails_to_start_is_started_again_with_a_growing_wait_and_logged() {
        let stop = AtomicBool::new(false);
        let tries = AtomicUsize::new(0);
        let logs = Mutex::new(Vec::<String>::new());
        let lines = Mutex::new(Vec::<String>::new());
        supervise(
            &stop,
            &FAST,
            &|t| logs.lock().unwrap().push(t.to_string()),
            &|l| lines.lock().unwrap().push(line(&l)),
            || {
                if tries.fetch_add(1, Ordering::SeqCst) < 3 {
                    Err("the game's header: moved".into())
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(tries.load(Ordering::SeqCst), 4, "three failures, then a start that ended on its own");
        let logs = logs.lock().unwrap();
        assert_eq!(logs.len(), 3);
        assert!(logs[0].contains("the game's header: moved") && logs[0].contains("0.005 s"), "{logs:?}");
        assert!(logs[1].contains("0.01 s") && logs[2].contains("0.02 s"), "doubling to the cap: {logs:?}");
        assert!(lines.lock().unwrap()[0].starts_with("Recorder: the game's header"), "the tray line says why");
    }

    #[test]
    fn a_panic_restarts_the_recorder_instead_of_ending_its_thread() {
        let stop = AtomicBool::new(false);
        let tries = AtomicUsize::new(0);
        let logs = Mutex::new(Vec::<String>::new());
        supervise(&stop, &FAST, &|t| logs.lock().unwrap().push(t.to_string()), &|_| {}, || {
            if tries.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("a bad frame");
            }
            Ok(())
        });
        assert_eq!(tries.load(Ordering::SeqCst), 2);
        assert!(logs.lock().unwrap()[0].contains("panicked: a bad frame"), "{:?}", logs.lock().unwrap());
    }

    #[test]
    fn a_stop_during_the_wait_ends_it_at_once() {
        let stop = Arc::new(AtomicBool::new(false));
        let slow = Backoff { first: Duration::from_secs(30), max: Duration::from_secs(60), healthy: Duration::from_secs(120) };
        let s2 = stop.clone();
        let t = std::time::Instant::now();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            s2.store(true, Ordering::SeqCst);
        });
        supervise(&stop, &slow, &|_| {}, &|_| {}, || Err("down".into()));
        assert!(t.elapsed() < Duration::from_secs(2), "{:?}", t.elapsed());
    }

    #[test]
    fn an_attempt_that_ran_healthily_starts_the_wait_again_from_the_first() {
        let stop = AtomicBool::new(false);
        let tries = AtomicUsize::new(0);
        let logs = Mutex::new(Vec::<String>::new());
        supervise(&stop, &FAST, &|t| logs.lock().unwrap().push(t.to_string()), &|_| {}, || {
            match tries.fetch_add(1, Ordering::SeqCst) {
                0 | 1 => Err("early".into()),
                2 => {
                    std::thread::sleep(Duration::from_millis(350));
                    Err("after a long run".into())
                }
                _ => Ok(()),
            }
        });
        let logs = logs.lock().unwrap();
        assert!(logs[1].contains("0.01 s"), "{logs:?}");
        assert!(logs[2].contains("0.005 s"), "a long run resets the wait: {logs:?}");
    }

    #[test]
    fn a_stop_ends_a_long_sleep_within_one_slice() {
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        let t = std::time::Instant::now();
        let h = std::thread::spawn(move || sleep_unless(Duration::from_secs(5), &|| s2.load(Ordering::SeqCst)));
        std::thread::sleep(Duration::from_millis(50));
        stop.store(true, Ordering::SeqCst);
        h.join().unwrap();
        assert!(t.elapsed() < Duration::from_millis(400), "{:?}", t.elapsed());
    }

    #[test]
    fn a_poll_shorter_than_a_slice_sleeps_its_own_length() {
        // LMU while recording: the tick asks for POLL (4 ms); slicing must not
        // stretch it, or 100 Hz frames are slept through.
        let stop = AtomicBool::new(false);
        let t = std::time::Instant::now();
        for _ in 0..10 {
            sleep_unless(Duration::from_millis(4), &|| stop.load(Ordering::SeqCst));
        }
        assert!(t.elapsed() < Duration::from_millis(200), "{:?}", t.elapsed());
    }

    fn status(state: &'static str, reason: &str) -> Status {
        let mut s = Status::new();
        s.state = state;
        s.layout_reason = reason.into();
        s
    }

    // A libraryfolders.vdf as Steam writes it: two libraries, doubled backslashes.
    const VDF: &str = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
		"label"		""
	}
}"#;

    #[test]
    fn library_paths_are_read_from_the_vdf_with_single_backslashes() {
        assert_eq!(
            library_paths(VDF),
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\SteamLibrary"),
            ]
        );
    }

    #[test]
    fn the_header_is_found_in_a_second_library() {
        let lmu_in_d = header_under(Path::new(r"D:\SteamLibrary"));
        let found = find_header_dir(
            Path::new(r"C:\Program Files (x86)\Steam"),
            VDF,
            |dir| dir == lmu_in_d,
        );
        assert_eq!(found, Some(lmu_in_d));
    }

    #[test]
    fn the_install_itself_is_checked_first_and_missing_gives_none() {
        let in_install = header_under(Path::new(r"C:\Program Files (x86)\Steam"));
        let steam = Path::new(r"C:\Program Files (x86)\Steam");
        let found = find_header_dir(steam, VDF, |dir| dir == in_install);
        assert_eq!(found, Some(in_install));
        assert_eq!(
            find_header_dir(Path::new(r"C:\Program Files (x86)\Steam"), VDF, |_| false),
            None
        );
    }

    #[test]
    fn the_registry_steam_root_comes_before_the_default() {
        let default = Path::new(DEFAULT_STEAM_ROOT);
        let from_registry = PathBuf::from(r"D:\Games\Steam");
        assert_eq!(steam_root(Some(from_registry.clone()), default), from_registry);
        assert_eq!(steam_root(None, default), default);
    }

    #[test]
    fn a_registry_string_is_read_up_to_its_trailing_nul() {
        let wide: Vec<u16> = "D:/Games/Steam\0".encode_utf16().collect();
        assert_eq!(path_from_wide(&wide), PathBuf::from("D:/Games/Steam"));
        let no_nul: Vec<u16> = "E:/Steam".encode_utf16().collect();
        assert_eq!(path_from_wide(&no_nul), PathBuf::from("E:/Steam"));
    }

    #[test]
    fn the_menu_line_says_what_the_recorder_is_doing() {
        assert_eq!(line(&Line::Status(status("recording", ""))), "Recording");
        let mut lossy = status("recording", "");
        lossy.dropped_pct = 3.4;
        assert_eq!(line(&Line::Status(lossy)), "Recording (3% dropped)");
        let mut fine = status("recording", "");
        fine.dropped_pct = 0.9;
        assert_eq!(line(&Line::Status(fine)), "Recording");
        assert_eq!(line(&Line::Status(status("no-game", ""))), "Waiting for LMU");
        assert_eq!(line(&Line::Status(status("waiting", ""))), "Waiting for LMU");
        assert_eq!(
            line(&Line::Status(status("refused", "disk full"))),
            "Recorder: disk full"
        );
        assert_eq!(line(&Line::Status(status("stopped", ""))), "Recorder: stopped");
        assert_eq!(line(&Line::Another), "Recorder: another recorder is running");
        assert_eq!(
            line(&Line::Failed("no C:\\x\\InternalsPlugin.hpp".into())),
            "Recorder: no C:\\x\\InternalsPlugin.hpp"
        );
    }

    #[test]
    fn a_missing_header_says_which_file() {
        let err = load_layout(Path::new(r"C:\no\such\dir")).err().unwrap();
        assert!(err.contains("InternalsPlugin.hpp"), "{err}");
    }
}
