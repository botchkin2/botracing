// Keeps the tray current. At launch and every 6 hours it asks the update
// endpoint (`GET /api/tray/latest`, which takes the user's ID token) whether a
// newer BotRacing exists; if so it downloads the installer quietly and keeps
// it. Nothing installs while the tray runs: the installer runs when the person
// quits (or picks "Restart to update"), so an update never cuts an upload
// short. The release is checked against the updater public key in
// tauri.conf.json, whose private half only CI holds.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
// Signed out there is nobody to ask as: look again soon, the sign-in may come.
const NO_TOKEN_RETRY: Duration = Duration::from_secs(60);
const FAILED_RETRY: Duration = Duration::from_secs(30 * 60);

/// A downloaded update waiting for the person to quit.
pub struct Pending {
    pub version: String,
    update: Update,
    bytes: Vec<u8>,
}

impl Pending {
    /// Runs the installer. On Windows this ends the process.
    pub fn install(self) -> Result<(), String> {
        self.update.install(self.bytes).map_err(|e| e.to_string())
    }
}

pub type Slot = Arc<Mutex<Option<Pending>>>;

#[derive(Debug, PartialEq)]
enum Outcome {
    NoToken,
    UpToDate,
    Downloaded,
    Failed,
}

/// The Authorization header value from the token file's text; None when the
/// file is empty (signed out).
fn bearer(token_file_text: &str) -> Option<String> {
    let token = token_file_text.trim();
    (!token.is_empty()).then(|| format!("Bearer {token}"))
}

fn wait_after(outcome: &Outcome) -> Duration {
    match outcome {
        Outcome::NoToken => NO_TOKEN_RETRY,
        Outcome::Failed => FAILED_RETRY,
        Outcome::UpToDate | Outcome::Downloaded => CHECK_EVERY,
    }
}

/// The menu line for the update item: its text and whether it can be clicked.
pub fn menu_line(current: &str, pending: Option<&str>) -> (String, bool) {
    match pending {
        Some(version) => (format!("Restart to update to {version}"), true),
        None => (format!("BotRacing {current}"), false),
    }
}

async fn check_once(app: &AppHandle, token_file: &Path, slot: &Slot) -> Outcome {
    if slot.lock().unwrap().is_some() {
        return Outcome::Downloaded;
    }
    let Some(auth) = std::fs::read_to_string(token_file)
        .ok()
        .and_then(|text| bearer(&text))
    else {
        return Outcome::NoToken;
    };
    let updater = match app
        .updater_builder()
        .header("Authorization", auth)
        .and_then(|builder| builder.build())
    {
        Ok(updater) => updater,
        Err(_) => return Outcome::Failed,
    };
    match updater.check().await {
        Ok(Some(update)) => match update.download(|_, _| {}, || {}).await {
            Ok(bytes) => {
                *slot.lock().unwrap() = Some(Pending {
                    version: update.version.clone(),
                    update,
                    bytes,
                });
                Outcome::Downloaded
            }
            Err(_) => Outcome::Failed,
        },
        Ok(None) => Outcome::UpToDate,
        Err(_) => Outcome::Failed,
    }
}

/// Checks on a thread of its own, for the life of the tray.
pub fn spawn(app: AppHandle, token_file: PathBuf, slot: Slot) {
    std::thread::spawn(move || loop {
        let outcome = tauri::async_runtime::block_on(check_once(&app, &token_file, &slot));
        std::thread::sleep(wait_after(&outcome));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_needs_a_token() {
        assert_eq!(bearer("abc\n"), Some("Bearer abc".into()));
        assert_eq!(bearer("  \n"), None);
        assert_eq!(bearer(""), None);
    }

    #[test]
    fn waits_longer_once_it_has_answered() {
        assert_eq!(wait_after(&Outcome::UpToDate), CHECK_EVERY);
        assert_eq!(wait_after(&Outcome::Downloaded), CHECK_EVERY);
        assert!(wait_after(&Outcome::NoToken) < wait_after(&Outcome::Failed));
        assert!(wait_after(&Outcome::Failed) < CHECK_EVERY);
    }

    #[test]
    fn the_menu_line_offers_a_restart_only_when_an_update_is_waiting() {
        assert_eq!(menu_line("0.1.0", None), ("BotRacing 0.1.0".into(), false));
        assert_eq!(
            menu_line("0.1.0", Some("0.1.1")),
            ("Restart to update to 0.1.1".into(), true)
        );
    }
}
