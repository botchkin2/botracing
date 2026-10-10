// What the uploader is doing, from the last line of the watcher's heartbeat file
// (tools/uploader/heartbeat.mjs). Pure, so it is tested without a tray.
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

/// The last non-empty line of the file's text, parsed. None when there is no
/// complete JSON line yet (the watcher may be mid-write).
pub fn last_beat(text: &str) -> Option<Value> {
    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .and_then(|line| serde_json::from_str(line).ok())
}

/// What the uploader is doing, from its last heartbeat. The menu words it.
#[derive(Clone, Debug, PartialEq)]
pub enum Upload {
    Starting,
    Syncing {
        done: Option<u64>,
        total: Option<u64>,
    },
    Queued(u64),
    InGame,
    Retrying,
    Error(String),
    Idle,
}

pub fn upload(beat: Option<&Value>) -> Upload {
    let Some(beat) = beat else {
        return Upload::Starting;
    };
    let queue = beat["queue"].as_u64().unwrap_or(0);
    match beat["state"].as_str().unwrap_or("") {
        "syncing" => Upload::Syncing {
            done: beat["progress"]["done"].as_u64(),
            total: beat["progress"]["total"].as_u64(),
        },
        "in-game" => Upload::InGame,
        "retrying" => Upload::Retrying,
        "error" => Upload::Error(
            beat["lastError"]["message"]
                .as_str()
                .unwrap_or("upload failed")
                .to_string(),
        ),
        "waiting-for-game" if queue > 0 => Upload::Queued(queue),
        "waiting-for-game" => Upload::Idle,
        _ => Upload::Starting,
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
    fn the_heartbeat_says_what_the_uploader_is_doing() {
        assert_eq!(upload(None), Upload::Starting);
        assert_eq!(
            upload(Some(&beat(
                r#"{"state":"syncing","progress":{"done":2,"total":5}}"#
            ))),
            Upload::Syncing {
                done: Some(2),
                total: Some(5)
            }
        );
        assert_eq!(
            upload(Some(&beat(r#"{"state":"waiting-for-game","queue":3}"#))),
            Upload::Queued(3)
        );
        assert_eq!(
            upload(Some(&beat(r#"{"state":"waiting-for-game","queue":0}"#))),
            Upload::Idle
        );
        assert_eq!(
            upload(Some(&beat(r#"{"state":"in-game"}"#))),
            Upload::InGame
        );
        assert_eq!(
            upload(Some(&beat(r#"{"state":"retrying"}"#))),
            Upload::Retrying
        );
        assert_eq!(
            upload(Some(&beat(
                r#"{"state":"error","lastError":{"message":"sync crashed: x"}}"#
            ))),
            Upload::Error("sync crashed: x".into())
        );
        assert_eq!(upload(Some(&beat(r#"{"state":"new-state"}"#))), Upload::Starting);
    }
}
