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
}

pub fn line(l: &Line) -> String {
    match l {
        Line::Starting => "Recorder: starting".into(),
        Line::Another => "Recorder: another recorder is running".into(),
        Line::Failed(why) => format!("Recorder: {why}"),
        Line::Status(s) => match s.state {
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
    /// and waits for it (or gives up after `wait`).
    pub fn stop(&mut self, wait: Duration) {
        self.stop.store(true, Ordering::SeqCst);
        let Some(join) = self.join.take() else { return };
        let end = std::time::Instant::now() + wait;
        while !join.is_finished() && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(20));
        }
        if join.is_finished() {
            let _ = join.join();
        }
    }
}

/// `LMU_SHM_HEADER_DIR` overrides the default Steam install.
pub fn header_dir() -> PathBuf {
    std::env::var_os("LMU_SHM_HEADER_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_HEADER_DIR))
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

    #[test]
    fn the_menu_line_says_what_the_recorder_is_doing() {
        assert_eq!(line(&Line::Status(status("recording", ""))), "Recording");
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
