//! What a second launch did, in `<data>/launch.log`: the taskbar and Start menu
//! start `botracing.exe` again, the single-instance hold forwards it to the
//! running tray, and nothing on screen says whether the tray got it, what it
//! decided or whether the window came forward. One line per step, with the
//! time, so a report like "I clicked the icon and nothing opened" has evidence.
//! Appended, and cut to its newest half when it passes `MAX_BYTES`.
use std::path::Path;

const MAX_BYTES: u64 = 64 * 1024;

/// One log line: the UTC time, the step, and its facts.
pub fn line(now: chrono::DateTime<chrono::Utc>, step: &str, facts: &str) -> String {
    format!("{} {step} {facts}\n", now.format("%Y-%m-%dT%H:%M:%SZ"))
}

/// The arguments as the log shows them: quoted, so an empty one or one with a
/// space reads right.
pub fn args_text(args: &[String]) -> String {
    format!("{args:?}")
}

/// Appends a line; a log that cannot be written is silently skipped (it is a
/// diagnosis aid, never a reason for a launch to fail).
pub fn note(data: &Path, step: &str, facts: &str) {
    note_file(&data.join("launch.log"), step, facts);
}

/// The same line into any log file (the recorder's own, capture/runner.rs).
pub fn note_file(file: &Path, step: &str, facts: &str) {
    trim(file);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .and_then(|mut f| {
            std::io::Write::write_all(&mut f, line(chrono::Utc::now(), step, facts).as_bytes())
        });
}

fn trim(file: &Path) {
    let Ok(meta) = std::fs::metadata(file) else { return };
    if meta.len() <= MAX_BYTES {
        return;
    }
    let Ok(bytes) = std::fs::read(file) else { return };
    let _ = std::fs::write(file, newest_half(&bytes));
}

/// The bytes after the first newline at or past the middle. A newline is a
/// whole character in UTF-8, so the cut never splits one (the log holds args and
/// error text, which can be non-ASCII); no newline past the middle empties it.
fn newest_half(bytes: &[u8]) -> &[u8] {
    let mid = bytes.len() / 2;
    match bytes[mid..].iter().position(|b| *b == b'\n') {
        Some(i) => &bytes[mid + i + 1..],
        None => &[],
    }
}

/// %LOCALAPPDATA%\BotRacing[-<profile>], by name: the sidecar's paths are not built yet.
fn data_dir() -> std::path::PathBuf {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    local.join(crate::profile::data_dir_name())
}

/// The `panic` line's facts: the thread, where, and the panic's own message.
pub fn panic_facts(thread: &str, location: Option<(&str, u32)>, message: &str) -> String {
    let at = location.map_or_else(|| "unknown".to_string(), |(file, line)| format!("{file}:{line}"));
    format!("thread={thread} at={at} message={message:?}")
}

/// One `panic` line in `data`'s launch.log.
pub fn record_panic(data: &Path, thread: &str, location: Option<(&str, u32)>, message: &str) {
    note(data, "panic", &panic_facts(thread, location, message));
}

/// Every panic, in any thread, leaves a line in launch.log before the default
/// hook runs, so a tray that went down says why (ticket 86; before, there was no
/// hook and a panic in the watcher's supervisor left no record).
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|m| (*m).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(not text)".to_string());
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        let location = info.location().map(|l| (l.file(), l.line()));
        record_panic(&data_dir(), &thread, location, &message);
        previous(info);
    }));
}

/// The `launch` line: every process start, before the single-instance hold
/// forwards it. Written to the data folder by name (the sidecar's paths are not
/// built yet): %LOCALAPPDATA%\BotRacing[-<profile>].
pub fn note_launch() {
    let data = data_dir();
    let _ = std::fs::create_dir_all(&data);
    let args = std::env::args().collect::<Vec<_>>();
    note(
        &data,
        "launch",
        &format!(
            "args={} pid={} data={}",
            args_text(&args),
            std::process::id(),
            data.display()
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn a_line_has_the_time_the_step_and_the_facts() {
        let at = chrono::Utc.with_ymd_and_hms(2026, 10, 14, 23, 30, 5).unwrap();
        assert_eq!(
            line(at, "second launch", "args=[\"x\"]"),
            "2026-10-14T23:30:05Z second launch args=[\"x\"]\n"
        );
    }

    #[test]
    fn a_panic_line_says_the_thread_the_place_and_the_message() {
        assert_eq!(
            panic_facts("watcher", Some(("src/main.rs", 120)), "called `Option::unwrap()` on a `None` value"),
            r#"thread=watcher at=src/main.rs:120 message="called `Option::unwrap()` on a `None` value""#
        );
        assert_eq!(panic_facts("main", None, "x"), r#"thread=main at=unknown message="x""#);
    }

    #[test]
    fn a_recorded_panic_lands_in_launch_log() {
        let dir = std::env::temp_dir().join(format!("launch-panic-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        record_panic(&dir, "t", Some(("a.rs", 7)), "boom");
        let text = std::fs::read_to_string(dir.join("launch.log")).unwrap();
        assert!(text.contains(" panic thread=t at=a.rs:7 message=\"boom\""), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn arguments_are_quoted() {
        let args = vec!["a.exe".to_string(), "--background".to_string(), "".to_string()];
        assert_eq!(args_text(&args), r#"["a.exe", "--background", ""]"#);
    }

    #[test]
    fn the_cut_never_splits_a_multibyte_character() {
        // A line of 'Ü' (2 bytes each) straddling the midpoint, which lands
        // inside a character.
        let text = format!("a\n{}\nlast\n", "Ü".repeat(41));
        let bytes = text.as_bytes();
        assert!(!text.is_char_boundary(bytes.len() / 2));
        assert_eq!(newest_half(bytes), b"last\n");
        assert_eq!(newest_half(b"no newline past the middle"), b"");
    }

    #[test]
    fn the_log_is_cut_to_its_newest_lines_past_the_cap() {
        let dir = std::env::temp_dir().join(format!("launch-log-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("launch.log");
        let old: String = (0..4000).map(|i| format!("line {i:05} padding padding\n")).collect();
        std::fs::write(&file, &old).unwrap();
        assert!(old.len() as u64 > MAX_BYTES);
        note(&dir, "step", "facts");
        let after = std::fs::read_to_string(&file).unwrap();
        assert!((after.len() as u64) < MAX_BYTES);
        assert!(after.starts_with("line "), "starts on a whole line");
        assert!(after.contains("line 03999"), "the newest old line stays");
        assert!(!after.contains("line 00000"), "the oldest goes");
        assert!(after.ends_with("step facts\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
