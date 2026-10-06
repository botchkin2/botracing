// The tray's status line, from the last line of the watcher's heartbeat file
// (tools/uploader/heartbeat.mjs). Pure, so it is tested without a tray.
use serde_json::Value;

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
            Some(at) => format!(
                "Up to date (last upload {})",
                at.chars().take(16).collect::<String>().replace('T', " ")
            ),
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
            line(Some(&beat(
                r#"{"state":"waiting-for-game","queue":0,"lastUploadAt":"2026-10-06T00:30:12.000Z"}"#
            ))),
            "Up to date (last upload 2026-10-06 00:30)"
        );
        assert_eq!(
            line(Some(&beat(
                r#"{"state":"error","lastError":{"message":"sync crashed: x"}}"#
            ))),
            "Error: sync crashed: x"
        );
    }
}
