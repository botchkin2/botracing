// BotRacing tray app: a tray icon, a status line, sign-in, and the Node
// sidecar that watches the telemetry folder and uploads. No windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod auth;
mod autostart;
mod browser;
mod capture;
mod install;
mod menu;
mod profile;
mod sidecar;
mod status;
mod update;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

type Shared<T> = Arc<Mutex<T>>;

/// True when a launch asks the running tray to quit (`--quit`).
fn wants_quit(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--quit")
}

/// Sign in on a thread of its own: the browser step waits on a person. The
/// lock order everywhere is account, then supervisor.
fn start_sign_in(account: Shared<account::Account>) {
    let cfg = {
        let mut acct = account.lock().unwrap();
        if acct.signing_in || acct.session.is_some() {
            return;
        }
        acct.signing_in = true;
        acct.message = None;
        acct.config().clone()
    };
    std::thread::spawn(move || {
        let result = auth::sign_in(
            &cfg,
            |url| {
                let _ = tauri_plugin_opener::open_url(url, None::<&str>);
            },
            SIGN_IN_TIMEOUT,
        );
        let mut acct = account.lock().unwrap();
        acct.signing_in = false;
        match result {
            Ok(session) => acct.signed_in(session),
            // Cancelled, timed out or refused: the top item stays "Sign in"
            // and the status says why.
            Err(e) => acct.message = Some(format!("Sign-in failed: {e}")),
        }
    });
}

/// One item of the tray menu: built from `menu::menu_items_for`, updated from it.
struct Live {
    id: &'static str,
    kind: Kind,
}

enum Kind {
    Plain(MenuItem<tauri::Wry>),
    Check(CheckMenuItem<tauri::Wry>),
    Separator(PredefinedMenuItem<tauri::Wry>),
}

impl Live {
    fn build<M: Manager<tauri::Wry>>(m: &M, spec: &menu::Item) -> tauri::Result<Live> {
        let kind = match spec.checked {
            Some(on) => Kind::Check(CheckMenuItem::with_id(
                m,
                spec.id,
                &spec.text,
                spec.enabled,
                on,
                None::<&str>,
            )?),
            None if spec.id == "separator" => Kind::Separator(PredefinedMenuItem::separator(m)?),
            None => Kind::Plain(MenuItem::with_id(
                m,
                spec.id,
                &spec.text,
                spec.enabled,
                None::<&str>,
            )?),
        };
        Ok(Live { id: spec.id, kind })
    }

    fn apply(&self, spec: &menu::Item) {
        match &self.kind {
            Kind::Plain(item) => {
                let _ = item.set_text(&spec.text);
                let _ = item.set_enabled(spec.enabled);
            }
            Kind::Check(item) => {
                let _ = item.set_text(&spec.text);
                let _ = item.set_enabled(spec.enabled);
                let _ = item.set_checked(spec.checked.unwrap_or(false));
            }
            Kind::Separator(_) => {}
        }
    }

    fn as_menu(&self) -> &dyn IsMenuItem<tauri::Wry> {
        match &self.kind {
            Kind::Plain(item) => item,
            Kind::Check(item) => item,
            Kind::Separator(item) => item,
        }
    }
}

/// A check item's handle, for the callbacks that read its state.
fn check(live: &[Live], id: &str) -> CheckMenuItem<tauri::Wry> {
    match live.iter().find(|l| l.id == id).map(|l| &l.kind) {
        Some(Kind::Check(item)) => item.clone(),
        _ => unreachable!("menu item {id} is a check item"),
    }
}

fn main() {
    let builder = tauri::Builder::default();
    // A second launch ends at once (two watchers would fight over the same
    // telemetry and state) and opens BotRacing in the browser instead. A
    // profile (BOTRACING_PROFILE, for walkthroughs) is a separate copy that
    // runs next to the real tray, so it is not held to this.
    let builder = if profile::is_default() {
        builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // `botracing.exe --quit` is how the installer and uninstaller ask
            // the running tray to stop: the watcher is stopped first (so a
            // recording closes with its end time), then the tray exits.
            if wants_quit(&args) {
                if let Some(sup) = app.try_state::<Shared<sidecar::Supervisor>>() {
                    sup.lock().unwrap().stop();
                }
                if let Some(rec) = app.try_state::<Shared<Option<capture::runner::Handle>>>() {
                    if let Some(rec) = rec.lock().unwrap().as_mut() {
                        rec.stop(Duration::from_secs(5));
                    }
                }
                app.exit(0);
                return;
            }
            std::thread::spawn(|| {
                let _ = browser::open();
            });
        }))
    } else {
        builder
    };
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // `--quit` is a message to a running tray (the single-instance hold
            // forwards it and ends this process before we get here). Reaching
            // setup means there was none: exit, never start a tray in the
            // middle of an uninstall.
            if wants_quit(&std::env::args().collect::<Vec<_>>()) {
                std::process::exit(0);
            }
            let paths = Arc::new(sidecar::paths(&app.path().resource_dir()?));
            let account: Shared<account::Account> = Arc::new(Mutex::new(account::Account::new(
                auth::Config::from_build(),
                &paths.data,
                Box::new(account::CredentialManager),
            )));
            let supervisor: Shared<sidecar::Supervisor> =
                Arc::new(Mutex::new(sidecar::Supervisor::new()));
            app.manage(supervisor.clone());

            // The tray menu is built from `menu::menu_items_for`, and every
            // update below goes through the same list, so the menu that ships
            // is the one the tests describe.
            let current_version = app.package_info().version.to_string();
            let update_slot: update::Slot = Arc::new(Mutex::new(None));
            let items = menu::menu_items_for(&menu::MenuState::initial(update::menu_line(
                &current_version,
                None,
            )));
            let live: Arc<Vec<Live>> = Arc::new(
                items
                    .iter()
                    .map(|spec| Live::build(app, spec))
                    .collect::<tauri::Result<Vec<_>>>()?,
            );
            let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = live.iter().map(Live::as_menu).collect();
            let menu = Menu::with_items(app, &refs)?;

            // The recorder is local and independent of sign-in and of pausing
            // uploads. A walkthrough profile does not record, and
            // BOTRACING_RECORDER=0 turns it off.
            let recorder: Shared<Option<capture::runner::Handle>> = Arc::new(Mutex::new(
                (cfg!(windows)
                    && profile::is_default()
                    && std::env::var("BOTRACING_RECORDER").map_or(true, |v| v != "0"))
                .then(|| {
                    capture::runner::start(
                        capture::runner::capture_root(),
                        capture::runner::header_dir(),
                    )
                }),
            ));

            let (paths_menu, account_menu, sup_menu, pause_menu, slot_menu) = (
                paths.clone(),
                account.clone(),
                supervisor.clone(),
                check(&live, "pause"),
                update_slot.clone(),
            );
            let start_with_windows_menu = check(&live, "autostart");
            // Only the real tray starts with Windows and updates itself; a
            // walkthrough profile does neither.
            if profile::is_default() {
                // First launch records "on"; after that the choice is kept, and
                // the Run value follows the exe if it moved (an update).
                let mut acct = account.lock().unwrap();
                let choice = acct.settings.start_with_windows;
                match std::env::current_exe()
                    .map_err(|e| e.to_string())
                    .and_then(|exe| autostart::reconcile(choice, &autostart::Registry, &exe))
                {
                    Ok(on) => {
                        if choice != Some(on) {
                            acct.record_start_with_windows(on);
                        }
                    }
                    Err(why) => acct.message = Some(format!("Start with Windows: {why}")),
                }
                // The installer could not remove an old logon task: say so once.
                if let Some(line) = install::take(&paths.data) {
                    acct.message = Some(line);
                }
                drop(acct);
                update::spawn(
                    app.handle().clone(),
                    paths.token_file(),
                    paths.data.join("update"),
                    update_slot.clone(),
                );
            }
            app.manage(recorder.clone());
            let recorder_menu = recorder.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip(profile::tooltip())
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "signin" => {
                        let account = account_menu.clone();
                        std::thread::spawn(move || start_sign_in(account));
                    }
                    "signout" => {
                        let (account, sup) = (account_menu.clone(), sup_menu.clone());
                        std::thread::spawn(move || {
                            let mut acct = account.lock().unwrap();
                            acct.sign_out(|| sup.lock().unwrap().set_allowed(false));
                        });
                    }
                    "open" => {
                        // The system browser, off this thread. If it cannot
                        // be opened, the status line says so.
                        let account = account_menu.clone();
                        std::thread::spawn(move || {
                            if let Err(why) = browser::open() {
                                account.lock().unwrap().message = Some(why);
                            }
                        });
                    }
                    "folder" => {
                        let _ = tauri_plugin_opener::open_path(&paths_menu.data, None::<&str>);
                    }
                    "older" => {
                        // The watcher sees this file and runs a sync that
                        // lifts the first-run window; a failure shows in the
                        // status line.
                        let request = paths_menu.older_request_file();
                        let written = std::fs::create_dir_all(paths_menu.sessions_dir())
                            .and_then(|_| std::fs::write(&request, b""));
                        if let Err(why) = written {
                            account_menu.lock().unwrap().message =
                                Some(format!("Can't ask for older sessions: {why}"));
                        }
                    }
                    "autostart" => {
                        let on = start_with_windows_menu.is_checked().unwrap_or(false);
                        let mut acct = account_menu.lock().unwrap();
                        match std::env::current_exe()
                            .map_err(|e| e.to_string())
                            .and_then(|exe| autostart::set(on, &autostart::Registry, &exe))
                        {
                            Ok(()) => {
                                acct.record_start_with_windows(on);
                                acct.message = None;
                            }
                            // The check mark is put back from the registry next tick.
                            Err(why) => acct.message = Some(why),
                        }
                    }
                    "pause" => {
                        let paused = pause_menu.is_checked().unwrap_or(false);
                        let mut acct = account_menu.lock().unwrap();
                        match acct.set_paused(paused) {
                            Ok(()) => acct.message = None,
                            // The checkbox is put back from settings next tick.
                            Err(why) => acct.message = Some(why),
                        }
                        sup_menu.lock().unwrap().set_allowed(acct.should_run());
                    }
                    // Quit and "Restart to update" both stop the watcher first;
                    // a waiting update installs here, never while uploading.
                    "quit" | "update" => {
                        sup_menu.lock().unwrap().stop();
                        // Finish the open chunk and write endUtc before exiting.
                        if let Some(rec) = recorder_menu.lock().unwrap().as_mut() {
                            rec.stop(Duration::from_secs(5));
                        }
                        let pending = slot_menu.lock().unwrap().take();
                        if let Some(Err(why)) = pending.map(update::Pending::install) {
                            account_menu.lock().unwrap().message =
                                Some(format!("Update failed: {why}"));
                        }
                        // On Windows a started installer ends the process.
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            std::thread::spawn(move || {
                loop {
                    // The network part runs without the account lock held.
                    account::maintain(&account);
                    // Signed out on launch: open the browser sign-in by
                    // itself, once. Signed out never sits silently in the tray.
                    let prompt = account.lock().unwrap().take_prompt();
                    if prompt {
                        start_sign_in(account.clone());
                    }
                    let status = {
                        let acct = account.lock().unwrap();
                        let mut sup = supervisor.lock().unwrap();
                        sup.set_allowed(acct.should_run());
                        sup.tick(&paths);
                        status_text(&acct, &sup, &paths)
                    };
                    let recording = recorder
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map_or_else(|| "Recorder: off".to_string(), |r| r.line());
                    let waiting = update_slot
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map(|p| p.version.clone());
                    let update = update::menu_line(&current_version, waiting.as_deref());
                    let start_with_windows =
                        profile::is_default() && autostart::is_on(&autostart::Registry);
                    let state = {
                        let acct = account.lock().unwrap();
                        menu::MenuState::of(&acct, status, recording, update, start_with_windows)
                    };
                    for spec in menu::menu_items_for(&state) {
                        if let Some(item) = live.iter().find(|l| l.id == spec.id) {
                            item.apply(&spec);
                        }
                    }
                    std::thread::sleep(Duration::from_secs(5));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("BotRacing failed to start")
        .run(|_app, event| {
            // The tray has no windows, so the app would exit the moment it
            // looked like the last one closed: only Quit ends it (it exits
            // with a code).
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

/// The status line of the menu: what a person needs to know right now.
fn status_text(
    acct: &account::Account,
    sup: &sidecar::Supervisor,
    paths: &sidecar::Paths,
) -> String {
    if acct.session.is_none() {
        // A stored sign-in that has not been continued yet (offline).
        if acct.has_stored() {
            return menu::waiting_status(acct.message.as_deref());
        }
        if let Some(reason) = acct.config().missing() {
            return format!("Can't sign in: {reason}");
        }
        return menu::signed_out_status(acct.message.as_deref());
    }
    if let Some(message) = &acct.message {
        return message.clone();
    }
    if acct.settings.paused {
        return match (&acct.owner_key, &acct.session) {
            (Some(key), Some(session)) if *key != session.uid => {
                "Uploads go to another account: check Settings".into()
            }
            _ => "Paused".into(),
        };
    }
    if let Some(problem) = &sup.problem {
        return problem.clone();
    }
    status::line(status::last_beat(&status::read_tail(&paths.status_file())).as_ref())
}

#[cfg(test)]
mod tests {
    use super::wants_quit;

    #[test]
    fn only_a_quit_argument_asks_the_tray_to_quit() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        assert!(wants_quit(&args(&["botracing.exe", "--quit"])));
        assert!(!wants_quit(&args(&["botracing.exe"])));
        assert!(
            !wants_quit(&args(&["--quit"])),
            "argument 0 is the exe, never a request"
        );
        assert!(!wants_quit(&args(&["botracing.exe", "--quiet"])));
    }
}
