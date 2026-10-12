// Keeps the tray current. At launch and every 6 hours it asks the update
// endpoint (`GET /api/tray/latest`) whether a newer BotRacing exists; if so it
// downloads the installer quietly and keeps it on disk. Nothing installs while
// the tray runs: the installer runs when the person quits (or picks "Restart
// to update"), so an update never cuts an upload short, and the tray comes
// back by itself afterwards (the updater passes the NSIS installer `/R`).
//
// The check works signed out. The installer is useless without an account, so
// it gates nothing, and a release that broke sign-in must still be able to
// fix itself. The user's ID token is sent when there is one, only so the
// endpoint can count who has which version. The release is verified against
// the updater public key in tauri.conf.json (whose private half only CI
// holds) again at install time, so a file changed on disk is refused.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const FAILED_RETRY: Duration = Duration::from_secs(30 * 60);

/// A downloaded update waiting for the person to quit.
pub struct Pending {
    pub version: String,
    update: Update,
    file: PathBuf,
}

impl Pending {
    /// Runs the installer. On Windows this ends the process.
    pub fn install(self) -> Result<(), String> {
        let bytes = std::fs::read(&self.file).map_err(|e| e.to_string())?;
        self.update.install(bytes).map_err(|e| e.to_string())
    }
}

pub type Slot = Arc<Mutex<Option<Pending>>>;

#[derive(Debug, PartialEq)]
enum Outcome {
    UpToDate,
    Downloaded,
    Failed,
}

/// The Authorization header value from the token file's text; None when the
/// file is empty (signed out): the check then goes without one.
fn bearer(token_file_text: &str) -> Option<String> {
    let token = token_file_text.trim();
    (!token.is_empty()).then(|| format!("Bearer {token}"))
}

fn wait_after(outcome: &Outcome) -> Duration {
    match outcome {
        Outcome::Failed => FAILED_RETRY,
        Outcome::UpToDate | Outcome::Downloaded => CHECK_EVERY,
    }
}

/// Where a version's installer is kept.
fn file_for(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!("{version}.exe"))
}

/// The file names in the update folder that are not `keep`'s installer: old
/// versions and half-written downloads.
fn stale(names: &[String], keep: &str) -> Vec<String> {
    let kept = format!("{keep}.exe");
    names.iter().filter(|n| **n != kept).cloned().collect()
}

/// The update item's text while an update is waiting; None leaves the item out.
pub fn menu_line(pending: Option<&str>) -> Option<String> {
    pending.map(|version| format!("Restart to update to {version}"))
}

fn remove_stale(dir: &Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    for name in stale(&names, keep) {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

async fn check_once(app: &AppHandle, token_file: &Path, dir: &Path, slot: &Slot) -> Outcome {
    if slot.lock().unwrap().is_some() {
        return Outcome::Downloaded;
    }
    let mut builder = app.updater_builder();
    if let Some(auth) = std::fs::read_to_string(token_file)
        .ok()
        .and_then(|text| bearer(&text))
    {
        builder = match builder.header("Authorization", auth) {
            Ok(builder) => builder,
            Err(_) => return Outcome::Failed,
        };
    }
    let Ok(updater) = builder.build() else {
        return Outcome::Failed;
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return Outcome::UpToDate,
        Err(_) => return Outcome::Failed,
    };
    let file = file_for(dir, &update.version);
    // Kept across a restart of the tray: only fetched when it is not here.
    if std::fs::metadata(&file).map_or(true, |m| m.len() == 0) {
        let Ok(bytes) = update.download(|_, _| {}, || {}).await else {
            return Outcome::Failed;
        };
        let part = dir.join(format!("{}.part", update.version));
        let written = std::fs::create_dir_all(dir)
            .and_then(|_| std::fs::write(&part, &bytes))
            .and_then(|_| std::fs::rename(&part, &file));
        if written.is_err() {
            return Outcome::Failed;
        }
    }
    remove_stale(dir, &update.version);
    *slot.lock().unwrap() = Some(Pending {
        version: update.version.clone(),
        update,
        file,
    });
    Outcome::Downloaded
}

/// Checks on a thread of its own, for the life of the tray.
pub fn spawn(app: AppHandle, token_file: PathBuf, dir: PathBuf, slot: Slot) {
    std::thread::spawn(move || loop {
        let outcome = tauri::async_runtime::block_on(check_once(&app, &token_file, &dir, &slot));
        std::thread::sleep(wait_after(&outcome));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_sent_when_there_is_one_and_the_check_goes_without_otherwise() {
        assert_eq!(bearer("abc\n"), Some("Bearer abc".into()));
        assert_eq!(bearer("  \n"), None);
        assert_eq!(bearer(""), None);
    }

    #[test]
    fn waits_longer_once_it_has_answered() {
        assert_eq!(wait_after(&Outcome::UpToDate), CHECK_EVERY);
        assert_eq!(wait_after(&Outcome::Downloaded), CHECK_EVERY);
        assert!(wait_after(&Outcome::Failed) < CHECK_EVERY);
    }

    #[test]
    fn the_menu_line_offers_a_restart_only_when_an_update_is_waiting() {
        assert_eq!(menu_line(None), None);
        assert_eq!(
            menu_line(Some("0.1.1")),
            Some("Restart to update to 0.1.1".into())
        );
    }

    #[test]
    fn the_installer_is_kept_by_version() {
        assert_eq!(
            file_for(Path::new("data/update"), "0.2.0"),
            Path::new("data/update").join("0.2.0.exe")
        );
    }

    #[test]
    fn only_the_current_installer_is_kept() {
        let names = vec!["0.1.1.exe".into(), "0.2.0.exe".into(), "0.2.0.part".into()];
        assert_eq!(stale(&names, "0.2.0"), vec!["0.1.1.exe", "0.2.0.part"]);
    }
}
