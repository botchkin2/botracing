// The second way `botracing.exe --quit` reaches a running tray: a file in the
// tray's own data folder. The first way, the single-instance window message,
// only reaches a tray on the caller's own desktop (tauri-plugin-single-instance
// finds it with FindWindowW). A tray in another session or window station (fast
// user switching, RDP beside the console, a batch logon, axle's #3598 matrix
// cell) never gets that message, and the uninstaller could not stop it. The file
// needs only the same user's %LOCALAPPDATA%: the tray's poll loop looks for it
// every tick and quits (thread 1 #3604/#3609).
use std::path::{Path, PathBuf};

const NAME: &str = "quit-request";

pub fn file(data: &Path) -> PathBuf {
    data.join(NAME)
}

/// Asks the tray that owns `data` to quit. Written by a `--quit` that found no
/// tray window to hand the request to.
pub fn request(data: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(data)?;
    std::fs::write(file(data), b"quit\n")
}

/// True once when a quit was requested; the request is consumed.
pub fn take(data: &Path) -> bool {
    std::fs::remove_file(file(data)).is_ok()
}

/// A request left from before this tray started (a `--quit` with no tray
/// running) is not for this tray: dropped at launch.
pub fn clear_stale(data: &Path) {
    let _ = std::fs::remove_file(file(data));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_is_taken_once_and_a_stale_one_is_dropped() {
        let data = std::env::temp_dir().join(format!("botracing-quit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        // Nothing asked: nothing to take (the data folder need not exist yet).
        assert!(!take(&data));
        request(&data).unwrap();
        assert!(file(&data).is_file());
        assert!(take(&data));
        assert!(!take(&data), "a request is consumed");
        // A launch drops one left over from before it started.
        request(&data).unwrap();
        clear_stale(&data);
        assert!(!take(&data));
        let _ = std::fs::remove_dir_all(&data);
    }
}
