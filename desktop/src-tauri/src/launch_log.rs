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
    let file = data.join("launch.log");
    trim(&file);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .and_then(|mut f| {
            std::io::Write::write_all(&mut f, line(chrono::Utc::now(), step, facts).as_bytes())
        });
}

fn trim(file: &Path) {
    let Ok(meta) = std::fs::metadata(file) else { return };
    if meta.len() <= MAX_BYTES {
        return;
    }
    let Ok(text) = std::fs::read_to_string(file) else { return };
    let mut keep = &text[text.len() / 2..];
    // Start on a whole line.
    if let Some(i) = keep.find('\n') {
        keep = &keep[i + 1..];
    }
    let _ = std::fs::write(file, keep);
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
    fn arguments_are_quoted() {
        let args = vec!["a.exe".to_string(), "--background".to_string(), "".to_string()];
        assert_eq!(args_text(&args), r#"["a.exe", "--background", ""]"#);
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
