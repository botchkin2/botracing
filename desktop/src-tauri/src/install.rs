// What the installer leaves for the tray to say. When the installer could not
// delete an old logon task (LapUploader, LapRecorder: a task made with the
// highest privileges refuses a per-user installer), it writes the names to
// old-tasks.txt in the data folder. The tray reads the file once, shows one
// line in its status and deletes the file. Never an installer error.
use std::path::Path;

/// The only names the installer ever touches, exactly (never a pattern).
pub const OLD_TASKS: [&str; 2] = ["LapUploader", "LapRecorder"];

pub const FILE: &str = "old-tasks.txt";

/// "Remove the old LapRecorder task (Task Scheduler)", or None when the file
/// names nothing we know.
pub fn line_for(contents: &str) -> Option<String> {
    let names: Vec<&str> = OLD_TASKS
        .iter()
        .copied()
        .filter(|name| contents.lines().any(|l| l.trim() == *name))
        .collect();
    if names.is_empty() {
        None
    } else {
        Some(format!(
            "Remove the old {} task (Task Scheduler)",
            names.join(" and ")
        ))
    }
}

/// Reads and deletes the installer's note.
pub fn take(data: &Path) -> Option<String> {
    let file = data.join(FILE);
    let text = std::fs::read_to_string(&file).ok()?;
    let _ = std::fs::remove_file(&file);
    line_for(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_tasks_the_installer_could_not_remove() {
        assert_eq!(
            line_for("LapRecorder\r\n").as_deref(),
            Some("Remove the old LapRecorder task (Task Scheduler)")
        );
        assert_eq!(
            line_for("LapUploader\nLapRecorder\n").as_deref(),
            Some("Remove the old LapUploader and LapRecorder task (Task Scheduler)")
        );
    }

    #[test]
    fn only_the_exact_known_names_count() {
        assert_eq!(line_for(""), None);
        assert_eq!(line_for("Lap*\nSomethingElse\nLapRecorder2"), None);
    }

    #[test]
    fn the_note_is_read_once() {
        let dir = std::env::temp_dir().join(format!("botracing-install-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), "LapRecorder\r\n").unwrap();
        assert!(take(&dir).is_some());
        assert!(!dir.join(FILE).exists());
        assert_eq!(take(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
