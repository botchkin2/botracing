//! Tests only: what the tray sends, put through the server's own contract
//! (contract/check.mjs, contract/README.md). A field or type the server would
//! refuse, or one no real payload has, fails `cargo test`.

use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

/// Panics with the server's reason unless `contract/check.mjs <kind>` takes
/// `body` (kind: heartbeat | recorder-status).
pub fn server_takes(kind: &str, body: &Value) {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contract/check.mjs");
    let mut child = Command::new("node")
        .args([script, kind])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("node on PATH: the contract check runs the server's validator");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(body.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{kind} {body}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
