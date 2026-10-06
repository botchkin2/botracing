// BotRacing tray app: a tray icon, a status line, sign-in, and the Node
// sidecar that watches the telemetry folder and uploads. No windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod auth;
mod sidecar;
mod status;
mod window;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

type Shared<T> = Arc<Mutex<T>>;

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
            Ok((session, accepted)) => {
                acct.record_accepted(accepted);
                acct.signed_in(session);
            }
            Err(e) => acct.message = Some(format!("Sign-in failed: {e}")),
        }
    });
}

fn main() {
    tauri::Builder::default()
        // A second launch ends at once: two watchers would fight over the
        // same telemetry and the same state.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = Arc::new(sidecar::paths(&app.path().resource_dir()?));
            let account: Shared<account::Account> = Arc::new(Mutex::new(account::Account::new(
                auth::Config::from_build(),
                &paths.data,
                Box::new(account::CredentialManager),
            )));
            // Debug builds only: BOTRACING_OPEN_ON_START opens the window at
            // start, so it can be checked without clicking the tray.
            #[cfg(debug_assertions)]
            if std::env::var_os("BOTRACING_OPEN_ON_START").is_some() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let _ = window::open(&handle);
                });
            }
            let supervisor: Shared<sidecar::Supervisor> =
                Arc::new(Mutex::new(sidecar::Supervisor::new()));

            let line = |id: &str, text: &str| MenuItem::with_id(app, id, text, false, None::<&str>);
            let status_item = line("status", "Starting…")?;
            let account_item = line("account", "Not signed in")?;
            let uid_item = line("uid", "uid —")?;
            let owner_item = line("owner", "owner —")?;
            let signin =
                MenuItem::with_id(app, "signin", "Sign in with Google", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open BotRacing", true, None::<&str>)?;
            let pause =
                CheckMenuItem::with_id(app, "pause", "Pause uploads", true, false, None::<&str>)?;
            let folder = MenuItem::with_id(app, "folder", "Open data folder", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status_item,
                    &account_item,
                    &uid_item,
                    &owner_item,
                    &PredefinedMenuItem::separator(app)?,
                    &signin,
                    &open,
                    &pause,
                    &folder,
                    &quit,
                ],
            )?;

            let (paths_menu, account_menu, sup_menu, pause_menu) = (
                paths.clone(),
                account.clone(),
                supervisor.clone(),
                pause.clone(),
            );
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("BotRacing")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "signin" => {
                        let (account, sup) = (account_menu.clone(), sup_menu.clone());
                        std::thread::spawn(move || {
                            let signed_in = account.lock().unwrap().session.is_some();
                            if signed_in {
                                let mut acct = account.lock().unwrap();
                                acct.sign_out(|| sup.lock().unwrap().set_allowed(false));
                            } else {
                                start_sign_in(account);
                            }
                        });
                    }
                    "open" => {
                        // Off this thread: building a window from a menu
                        // handler can deadlock on Windows.
                        let app = app.clone();
                        std::thread::spawn(move || {
                            if let Err(e) = window::open(&app) {
                                eprintln!("could not open the BotRacing window: {e}");
                            }
                        });
                    }
                    "folder" => {
                        let _ = tauri_plugin_opener::open_path(&paths_menu.data, None::<&str>);
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
                    "quit" => {
                        sup_menu.lock().unwrap().stop();
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            std::thread::spawn(move || {
                loop {
                    // The network part runs without the account lock held.
                    account::maintain(&account);
                    let (status, account_text, uid, owner, sign, checked, signing) = {
                        let acct = account.lock().unwrap();
                        let mut sup = supervisor.lock().unwrap();
                        sup.set_allowed(acct.should_run());
                        sup.tick(&paths);
                        let status = status_text(&acct, &sup, &paths);
                        let who = acct.session.as_ref();
                        (
                            status,
                            match who {
                                Some(s) => format!("Signed in as {}", s.email),
                                None if acct.signing_in => {
                                    "Signing in… finish in your browser".into()
                                }
                                None => "Not signed in".into(),
                            },
                            format!("uid {}", who.map_or("—", |s| s.uid.as_str())),
                            match (who, &acct.owner_key) {
                                (Some(_), Some(key)) => format!("owner {key}"),
                                (Some(_), None) => match &acct.owner_error {
                                    Some(why) => format!("owner unknown: {why}"),
                                    None => "owner unknown (not read yet)".into(),
                                },
                                (None, _) => "owner —".into(),
                            },
                            if who.is_some() {
                                "Sign out"
                            } else {
                                "Sign in with Google"
                            },
                            acct.settings.paused,
                            acct.signing_in,
                        )
                    };
                    let _ = status_item.set_text(status);
                    let _ = account_item.set_text(account_text);
                    let _ = uid_item.set_text(uid);
                    let _ = owner_item.set_text(owner);
                    let _ = signin.set_text(sign);
                    let _ = signin.set_enabled(!signing);
                    let _ = pause.set_checked(checked);
                    std::thread::sleep(Duration::from_secs(5));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("BotRacing failed to start")
        .run(|_app, event| {
            // Closing the BotRacing window must not end the tray app: only
            // Quit does (it exits with a code).
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

/// The first line of the menu: what a person needs to know right now.
fn status_text(
    acct: &account::Account,
    sup: &sidecar::Supervisor,
    paths: &sidecar::Paths,
) -> String {
    if let Some(message) = &acct.message {
        return message.clone();
    }
    if acct.session.is_none() {
        return match acct.config().missing() {
            Some(reason) => format!("Can't sign in: {reason}"),
            None => "Sign in to start uploading".into(),
        };
    }
    if acct.settings.paused {
        return if acct.unconfirmed() {
            "Paused. Check the owner below, then un-pause".into()
        } else {
            "Paused".into()
        };
    }
    if let Some(problem) = &sup.problem {
        return problem.clone();
    }
    status::line(status::last_beat(&status::read_tail(&paths.status_file())).as_ref())
}
