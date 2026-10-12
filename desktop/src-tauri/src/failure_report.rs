// The tray's report that the uploader is not staying up. The uploader is what
// normally sends the status doc (tools/uploader/heartbeat.mjs), so when it
// cannot start or keeps exiting, nothing would reach Settings: the tray sends
// one heartbeat itself, to the same endpoint, with the same token, for the same
// host (so the same Settings row, which the next real heartbeat replaces).
//
// It carries the tray's version, `state: error` and one `uploader-stopped`
// problem: why (an exit code, or that node would not start) and the last line
// the uploader wrote to uploader/sidecar.log, scrubbed like the uploader's own
// messages (heartbeat.mjs: user folders, tokens and addresses out, 120 chars).
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

/// The id the uploader gives this PC: the first 8 hex digits of sha1(hostname)
/// (heartbeat.mjs hostIdOf). It must match, or Settings shows two PCs.
pub fn host_id_of(hostname: &str) -> String {
    let digest = Sha1::digest(hostname.as_bytes());
    digest.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

/// The DNS host name, the one node's os.hostname() reads on Windows.
#[cfg(windows)]
pub fn hostname() -> Option<String> {
    use windows_sys::Win32::System::SystemInformation::{
        ComputerNameDnsHostname, GetComputerNameExW,
    };
    let mut buf = [0u16; 256];
    let mut len = buf.len() as u32;
    // SAFETY: buf and len describe the same writable buffer.
    let ok = unsafe { GetComputerNameExW(ComputerNameDnsHostname, buf.as_mut_ptr(), &mut len) };
    (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
}

#[cfg(not(windows))]
pub fn hostname() -> Option<String> {
    std::env::var("HOSTNAME").ok()
}

const MESSAGE_MAX: usize = 120;

/// First line only, user folders replaced, tokens and addresses redacted, cut
/// to 120 characters (the same rules as the uploader's problem messages).
pub fn scrub(text: &str) -> String {
    static FOLDERS: LazyLock<Regex> = LazyLock::new(|| {
        // The profile folder up to the next separator: a name with a space
        // ("Jane Doe") is one folder.
        Regex::new(r#"(?i)[a-z]:[\\/]users[\\/][^\\/'"]+"#).unwrap()
    });
    static TOKEN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"eyJ[\w-]+\.[\w-]+\.[\w-]+").unwrap());
    static EMAIL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[\w.+-]+@[\w-]+(\.[\w-]+)+").unwrap());
    let line = text.lines().next().unwrap_or("");
    let line = FOLDERS.replace_all(line, "~");
    let line = TOKEN.replace_all(&line, "<token>");
    let line = EMAIL.replace_all(&line, "<email>");
    line.chars().take(MESSAGE_MAX).collect()
}

/// The line of a log's last run that names the cause: after the last start
/// marker, the first line that reads `Error: ...` (also `TypeError: ...` and
/// `Error [ERR_X]: ...`), else the first non-empty line. Node's crash output
/// ends in a stack and `Node.js v24...`, so the last line says nothing.
pub fn cause_line(text: &str) -> String {
    static ERROR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\w*Error\b").unwrap());
    let run = text.rfind("--- uploader start").map_or(text, |at| {
        text[at..].split_once('\n').map_or("", |(_, rest)| rest)
    });
    let lines: Vec<&str> = run
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    lines
        .iter()
        .find(|l| ERROR.is_match(l))
        .or_else(|| lines.first())
        .map_or(String::new(), |l| l.to_string())
}

/// `cause_line` of the end of the uploader's log (its last 8 KB).
pub fn last_line(log: &Path) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = std::fs::File::open(log) else {
        return String::new();
    };
    let len = file.metadata().map_or(0, |m| m.len());
    let _ = file.seek(SeekFrom::Start(len.saturating_sub(8000)));
    let mut tail = Vec::new();
    let _ = file.read_to_end(&mut tail);
    cause_line(&String::from_utf8_lossy(&tail))
}

/// The PC's name as the uploader reads it from config.json, else its default.
pub fn label_of(uploader_home: &Path) -> String {
    std::fs::read_to_string(uploader_home.join("config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v.get("label")?.as_str().map(str::to_string))
        .unwrap_or_else(|| "Race PC".to_string())
}

/// What the server requires of a heartbeat, plus the one problem. No
/// `lmuFound`: the tray did not look, and Settings must not say "LMU not
/// found" because the uploader would not start.
pub fn body(
    host_id: &str,
    label: &str,
    version: &str,
    reason: &str,
    last: &str,
    count: u32,
    at: &str,
) -> Value {
    let message = if last.is_empty() {
        scrub(reason)
    } else {
        scrub(&format!("{reason}: {last}"))
    };
    let mut problem = json!({"kind": "uploader-stopped", "at": at, "message": message});
    if count > 0 {
        problem["count"] = json!(count);
    }
    json!({
        "hostId": host_id,
        "label": label,
        "version": version,
        "state": "error",
        "problems": [problem],
    })
}

/// POSTs the heartbeat. Ok(status) for any HTTP answer; Err only when the
/// server could not be reached.
pub fn send(api: &str, token: &str, body: &Value) -> Result<u16, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .build();
    match agent
        .post(&format!("{api}/heartbeat"))
        .set("Authorization", &format!("Bearer {token}"))
        .send_json(body)
    {
        Ok(response) => Ok(response.status()),
        Err(ureq::Error::Status(code, _)) => Ok(code),
        Err(other) => Err(other.to_string()),
    }
}

/// Everything the report needs from the tray, so tests can aim it at a stub.
pub struct Report<'a> {
    pub api: &'a str,
    pub token_file: &'a Path,
    pub uploader_home: &'a Path,
    pub log: &'a Path,
    pub version: &'a str,
    pub reason: &'a str,
    pub count: u32,
}

/// Builds and sends one report. A missing token file (signed out) or a
/// refused request is returned, not retried: the next exit reports again.
pub fn report(r: &Report) -> Result<u16, String> {
    let token = std::fs::read_to_string(r.token_file)
        .map_err(|e| format!("no token: {e}"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err("no token".into());
    }
    let host = host_id_of(&hostname().ok_or("no host name")?);
    let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let body = body(
        &host,
        &label_of(r.uploader_home),
        r.version,
        r.reason,
        &last_line(r.log),
        r.count,
        &at,
    );
    send(r.api, &token, &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_id_is_the_uploaders() {
        // heartbeat.mjs hostIdOf: sha1 hex, first 8 digits.
        assert_eq!(host_id_of("abc"), "a9993e36");
        assert_eq!(host_id_of("DESKTOP-JRIRDB4"), "ddde1d71");
    }

    #[test]
    fn messages_are_one_scrubbed_line_of_120() {
        let secret = scrub(
            "Error: ENOENT C:\\Users\\Jane Doe\\x for a@b.example eyJhbGciOi.eyJzdWIiOiIx.sig\nsecond line",
        );
        assert!(!secret.contains("Jane"), "{secret}");
        assert!(!secret.contains("a@b.example"), "{secret}");
        assert!(!secret.contains("eyJ"), "{secret}");
        assert!(!secret.contains("second"), "{secret}");
        assert_eq!(scrub(&"x".repeat(500)).len(), 120);
    }

    #[test]
    fn the_body_has_what_the_server_requires_and_one_problem() {
        let b = body(
            "ab12cd34",
            "Race PC",
            "0.1.3",
            "exit code: 1",
            "Error: boom",
            3,
            "2026-10-10T02:00:00.000Z",
        );
        assert_eq!(
            b,
            json!({
                "hostId": "ab12cd34", "label": "Race PC", "version": "0.1.3",
                "state": "error",
                "problems": [{"kind": "uploader-stopped", "at": "2026-10-10T02:00:00.000Z",
                    "message": "exit code: 1: Error: boom", "count": 3}],
            })
        );
        let none = body("h", "L", "v", "r", "", 0, "t");
        assert_eq!(none["problems"][0]["message"], "r");
        assert!(none["problems"][0].get("count").is_none());
    }

    #[test]
    fn the_last_line_skips_the_start_markers() {
        let dir = std::env::temp_dir().join(format!("botracing-ll-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("sidecar.log");
        // A real node crash (`node -e "throw new Error('x')"` on Windows, CRLF),
        // after an older run that failed differently: the cause is the first
        // Error line of the LAST run, not the closing `Node.js v24...` line.
        let crash = "--- uploader start (unix 1) ---\r\nError: an older run\r\n\
             --- uploader start (unix 2) ---\r\n[eval]:1\r\nthrow new Error('x')\r\n^\r\n\r\n\
             Error: x\r\n    at [eval]:1:7\r\n    at runScriptInThisContext (node:internal/vm:219:10)\r\n\
             \r\nNode.js v24.19.0\r\n";
        std::fs::write(&log, crash).unwrap();
        assert_eq!(last_line(&log), "Error: x");
        assert_eq!(
            cause_line("--- uploader start (unix 1) ---\nTypeError [ERR_INVALID_ARG_TYPE]: bad\nNode.js v24\n"),
            "TypeError [ERR_INVALID_ARG_TYPE]: bad"
        );
        // No Error line: the first line written.
        assert_eq!(
            cause_line("--- uploader start (unix 1) ---\nsomething odd\nsecond\n"),
            "something odd"
        );
        std::fs::write(&log, "--- uploader start (unix 1) ---\n").unwrap();
        assert_eq!(last_line(&log), "");
        assert_eq!(last_line(&dir.join("missing.log")), "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The same name node reads, on a Windows PC with node (a developer's, not
    // every CI image): `cargo test -- --ignored host_id_matches_node`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn host_id_matches_node() {
        let out = std::process::Command::new("node")
            .args([
                "-e",
                "console.log(require('crypto').createHash('sha1').update(require('os').hostname()).digest('hex').slice(0,8))",
            ])
            .output()
            .expect("node");
        let node = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_eq!(host_id_of(&hostname().unwrap()), node);
    }
}
