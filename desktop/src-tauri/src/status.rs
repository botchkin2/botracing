// The tray's status line, from the last line of the watcher's heartbeat file
// (tools/uploader/heartbeat.mjs). Pure, so it is tested without a tray.
use chrono::{DateTime, Local, TimeZone};
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// The file's last 16 KB as text: the watcher appends a line per change, and
/// only the last line matters, so the whole file is never read.
pub fn read_tail(file: &Path) -> String {
    const TAIL: u64 = 16 * 1024;
    let Ok(mut f) = std::fs::File::open(file) else {
        return String::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(TAIL)));
    let mut bytes = Vec::new();
    let _ = f.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// An ISO UTC stamp as "YYYY-MM-DD HH:MM" in the given zone.
pub fn stamp<Tz: TimeZone>(iso: &str, zone: &Tz) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    let at = DateTime::parse_from_rfc3339(iso).ok()?;
    Some(at.with_timezone(zone).format("%Y-%m-%d %H:%M").to_string())
}

/// The last non-empty line of the file's text, parsed. None when there is no
/// complete JSON line yet (the watcher may be mid-write).
pub fn last_beat(text: &str) -> Option<Value> {
    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .and_then(|line| serde_json::from_str(line).ok())
}

/// One line for the tray menu.
pub fn line(beat: Option<&Value>) -> String {
    let Some(beat) = beat else {
        return "Starting…".into();
    };
    let state = beat["state"].as_str().unwrap_or("");
    let queue = beat["queue"].as_u64().unwrap_or(0);
    match state {
        "syncing" => {
            let done = beat["progress"]["done"].as_u64();
            let total = beat["progress"]["total"].as_u64();
            match (done, total) {
                (Some(d), Some(t)) => format!("Uploading {d} of {t}"),
                _ => "Uploading…".into(),
            }
        }
        "in-game" => "Waiting for the game to close".into(),
        "retrying" => "Retrying a failed upload later".into(),
        "error" => {
            let msg = beat["lastError"]["message"]
                .as_str()
                .unwrap_or("upload failed");
            format!("Error: {msg}")
        }
        "waiting-for-game" if queue > 0 => format!("{queue} to upload"),
        "waiting-for-game" => match beat["lastUploadAt"].as_str() {
            Some(at) => match stamp(at, &Local) {
                Some(local) => format!("Up to date (last upload {local})"),
                None => "Up to date".into(),
            },
            None => "Up to date".into(),
        },
        other if !other.is_empty() => other.to_string(),
        _ => "Starting…".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn beat(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn last_beat_skips_blank_and_half_written_lines() {
        let text = "{\"state\":\"in-game\"}\n{\"state\":\"syncing\"}\n\n";
        assert_eq!(last_beat(text).unwrap()["state"], "syncing");
        assert!(last_beat("{\"state\":\"syn").is_none());
        assert!(last_beat("").is_none());
    }

    #[test]
    fn a_utc_stamp_is_shown_in_the_local_zone() {
        let plus2 = chrono::FixedOffset::east_opt(2 * 3600).unwrap();
        assert_eq!(
            stamp("2026-10-06T23:30:12.000Z", &plus2).as_deref(),
            Some("2026-10-07 01:30")
        );
        assert_eq!(stamp("not a time", &plus2), None);
    }

    #[test]
    fn only_the_tail_of_a_big_file_is_read() {
        let file = std::env::temp_dir().join(format!("botracing-tail-{}", std::process::id()));
        let old = "{\"state\":\"old\"}
"
        .repeat(5000);
        std::fs::write(
            &file,
            format!(
                "{old}{{\"state\":\"last\"}}
"
            ),
        )
        .unwrap();
        let tail = read_tail(&file);
        assert!(tail.len() <= 16 * 1024);
        assert_eq!(last_beat(&tail).unwrap()["state"], "last");
        assert_eq!(read_tail(Path::new("no-such-file")), "");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn lines_say_what_is_happening() {
        assert_eq!(line(None), "Starting…");
        assert_eq!(
            line(Some(&beat(
                r#"{"state":"syncing","progress":{"done":2,"total":5}}"#
            ))),
            "Uploading 2 of 5"
        );
        assert_eq!(
            line(Some(&beat(r#"{"state":"waiting-for-game","queue":3}"#))),
            "3 to upload"
        );
        assert_eq!(
            line(Some(&beat(r#"{"state":"waiting-for-game","queue":0}"#))),
            "Up to date"
        );
        assert_eq!(
            line(Some(&beat(
                r#"{"state":"error","lastError":{"message":"sync crashed: x"}}"#
            ))),
            "Error: sync crashed: x"
        );
    }
}
