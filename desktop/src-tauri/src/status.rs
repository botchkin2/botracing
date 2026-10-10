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

/// One sim's part of the heartbeat (`sims.<id>`, tools/uploader/heartbeat.mjs
/// simsDoc): its own queue, its own sync's progress, its retry and its error. A
/// heartbeat from an uploader that has no `sims` yet reads as the whole
/// watcher, as before.
pub fn upload_of(beat: Option<&Value>, sim: &str) -> Upload {
    let Some(b) = beat else {
        return Upload::Starting;
    };
    let Some(s) = b["sims"].get(sim).filter(|s| s.is_object()) else {
        return upload(beat);
    };
    if let Some(message) = s["lastError"]["message"].as_str() {
        return Upload::Error(message.to_string());
    }
    if s["syncing"].as_bool() == Some(true) {
        return Upload::Syncing {
            done: s["progress"]["done"].as_u64(),
            total: s["progress"]["total"].as_u64(),
        };
    }
    if b["state"].as_str() == Some("in-game") {
        return Upload::InGame;
    }
    if s["retryAt"].is_string() {
        return Upload::Retrying;
    }
    match s["queue"].as_u64().unwrap_or(0) {
        0 => Upload::Idle,
        n => Upload::Queued(n),
    }
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

    #[test]
    fn each_sim_reads_its_own_part_of_the_heartbeat() {
        let b = beat(
            r#"{"state":"syncing","queue":7,"progress":{"done":2,"total":5},
                "sims":{
                  "lmu":{"queue":2,"syncing":false,"progress":null,"retryAt":null,"lastError":null},
                  "iracing":{"queue":5,"syncing":true,"progress":{"done":2,"total":5},"retryAt":null,"lastError":null}}}"#,
        );
        assert_eq!(upload_of(Some(&b), "lmu"), Upload::Queued(2));
        assert_eq!(
            upload_of(Some(&b), "iracing"),
            Upload::Syncing {
                done: Some(2),
                total: Some(5)
            }
        );
    }

    #[test]
    fn a_sims_error_retry_and_idle_are_its_own() {
        let b = beat(
            r#"{"state":"error","queue":3,
                "sims":{
                  "lmu":{"queue":0,"syncing":false,"progress":null,"retryAt":null,"lastError":{"at":"x","message":"sync crashed"}},
                  "iracing":{"queue":1,"syncing":false,"progress":null,"retryAt":"2026-10-09T12:00:00.000Z","lastError":null}}}"#,
        );
        assert_eq!(upload_of(Some(&b), "lmu"), Upload::Error("sync crashed".into()));
        assert_eq!(upload_of(Some(&b), "iracing"), Upload::Retrying);
        let idle = beat(
            r#"{"state":"waiting-for-game","queue":0,"sims":{"lmu":{"queue":0,"syncing":false,"progress":null,"retryAt":null,"lastError":null}}}"#,
        );
        assert_eq!(upload_of(Some(&idle), "lmu"), Upload::Idle);
        let ingame = beat(
            r#"{"state":"in-game","queue":1,"sims":{"lmu":{"queue":1,"syncing":false,"progress":null,"retryAt":null,"lastError":null}}}"#,
        );
        assert_eq!(upload_of(Some(&ingame), "lmu"), Upload::InGame);
    }

    #[test]
    fn a_heartbeat_without_sims_reads_as_the_whole_watcher_and_no_beat_is_starting() {
        let old = beat(r#"{"state":"syncing","progress":{"done":2,"total":5}}"#);
        assert_eq!(upload_of(Some(&old), "lmu"), upload(Some(&old)));
        // A sim the heartbeat does not list falls back too.
        let one = beat(r#"{"state":"waiting-for-game","queue":4,"sims":{"lmu":{"queue":4}}}"#);
        assert_eq!(upload_of(Some(&one), "iracing"), Upload::Queued(4));
        assert_eq!(upload_of(None, "lmu"), Upload::Starting);
    }
}
