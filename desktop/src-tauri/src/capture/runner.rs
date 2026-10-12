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
const CHUNK_MS: u64 = 60_000;

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
            "recording" => "Recording".into(),
            "refused" => format!("Recorder: {}", s.layout_reason),
            "stopped" => "Recorder: stopped".into(),
            // No game and a game between sessions both read the same to a driver.
            _ => "Waiting for LMU".into(),
        },
    }
}

fn now_ms() -> u64 {
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

/// `LAP_CAPTURE` overrides `%LOCALAPPDATA%\lap-capture`, the folder the
/// uploader reads (tools/sessions/sync.mjs).
pub fn capture_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("LAP_CAPTURE") {
        return PathBuf::from(dir);
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("lap-capture")
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

#[cfg(windows)]
fn run(stop: &AtomicBool, line: &Mutex<Line>, root: PathBuf, header_dir: PathBuf) {
    use crate::capture::win::{RecorderLock, Shm};
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
            return;
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
    let mut rec = match Recorder::new(layout, root, Shm { size }, CHUNK_MS) {
        Ok(rec) => rec,
        Err(why) => {
            say(Line::Failed(format!("the game's header: {why}")));
            return;
        }
    };
    drive(&mut rec, stop, line);
}

/// iRacing's recorder on its own thread, into the same capture folder. It needs
/// no header files and no mutex: the SDK's map is read-only and read by any
/// number of tools.
#[cfg(windows)]
pub fn start_iracing(root: PathBuf) -> Handle {
    use crate::capture::ir_recorder::{line as ir_line, IrRecorder, IrSource};
    use crate::capture::win::IrShm;
    let stop = Arc::new(AtomicBool::new(false));
    let line = Arc::new(Mutex::new(Line::Text("Waiting for iRacing".into())));
    let (stop_t, line_t) = (stop.clone(), line.clone());
    let join = std::thread::Builder::new()
        .name("recorder-iracing".into())
        .spawn(move || {
            crate::capture::win::lower_priority();
            let mut rec = IrRecorder::new(IrShm::new(), root);
            while !stop_t.load(Ordering::SeqCst) {
                let wait = rec.tick(now_ms());
                *line_t.lock().unwrap() = Line::Text(ir_line(&rec.status));
                rec.src().wait(wait);
            }
            rec.shutdown(now_ms());
            *line_t.lock().unwrap() = Line::Text(ir_line(&rec.status));
        })
        .ok();
    Handle { stop, join, line }
}

/// The loop: tick, publish the status for the menu, sleep what the tick asked.
pub fn drive<S: Source>(rec: &mut Recorder<S>, stop: &AtomicBool, line: &Mutex<Line>) {
    while !stop.load(Ordering::SeqCst) {
        let sleep = rec.tick(now_ms());
        *line.lock().unwrap() = Line::Status(rec.status.clone());
        std::thread::sleep(sleep);
    }
    rec.shutdown(now_ms());
    *line.lock().unwrap() = Line::Status(rec.status.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

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
