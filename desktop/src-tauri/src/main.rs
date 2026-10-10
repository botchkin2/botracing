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
mod paths;
mod profile;
mod sidecar;
mod status;
mod update;
mod viewer;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(crate) type Shared<T> = Arc<Mutex<T>>;

/// True when a launch asks the running tray to quit (`--quit`).
fn wants_quit(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--quit")
}

/// True when this launch is a person starting BotRacing (the Start menu, a
/// shortcut, the installer's finish): the window opens, once they are signed
/// in. The logon start carries `--background` and stays a tray (`autostart`).
fn opens_window_on_launch(args: &[String]) -> bool {
    !wants_quit(args)
        && !args
            .iter()
            .skip(1)
            .any(|a| a == autostart::BACKGROUND_ARG)
}

/// What the poll loop does about the window a launch owes.
#[derive(Debug, PartialEq)]
enum LaunchWindow {
    Open,
    Wait,
    /// Signed out: the browser sign-in is the way in, no window beside it.
    Drop,
}

/// How many 5 s ticks a stored sign-in may take to come back (offline).
const LAUNCH_WINDOW_TICKS: u32 = 12;

fn launch_window(
    signed_in: bool,
    signing_in: bool,
    has_stored: bool,
    ticks: u32,
) -> LaunchWindow {
    if signed_in {
        LaunchWindow::Open
    } else if signing_in || !has_stored || ticks >= LAUNCH_WINDOW_TICKS {
        LaunchWindow::Drop
    } else {
        LaunchWindow::Wait
    }
}

/// True when the window opens at launch: a debug build with
/// `BOTRACING_OPEN_ON_START` set, for a walkthrough or a check of the window.
/// A release build never does.
fn opens_on_start(debug_build: bool, env_set: bool) -> bool {
    debug_build && env_set
}

/// The seat-test custom token file a test tray signs in with, instead of the
/// browser (thread 1 #3451, docs/TESTING.md). Only a tray under a
/// BOTRACING_PROFILE honours it, release builds included, so CI can sign in the
/// installer it ships (apex #3508); the real tray never does. The safety is the
/// uid check (auth::seat_test_sign_in): a token for anyone but seat-test is
/// refused, so the file can only ever make a tray seat-test.
fn seat_token_file(
    default_profile: bool,
    env: Option<std::ffi::OsString>,
) -> Option<std::path::PathBuf> {
    if default_profile {
        return None;
    }
    env.map(std::path::PathBuf::from)
}

/// Signs a local test tray in as seat-test from `file`, on its own thread.
/// Anything but a seat-test token is refused (auth::seat_test_uid).
fn start_seat_sign_in(account: Shared<account::Account>, file: std::path::PathBuf) {
    let Some(cfg) = account.lock().unwrap().begin_sign_in() else {
        return;
    };
    std::thread::spawn(move || {
        let result = std::fs::read_to_string(&file)
            .map_err(|e| format!("can't read {}: {e}", file.display()))
            .and_then(|text| auth::seat_test_sign_in(&cfg, text.trim()));
        let mut acct = account.lock().unwrap();
        acct.signing_in = false;
        match result {
            Ok(session) => acct.signed_in(session),
            Err(e) => acct.message = Some(format!("Sign-in failed: {e}")),
        }
    });
}

/// Sign in on a thread of its own: the browser step waits on a person. The
/// lock order everywhere is account, then supervisor.
fn start_sign_in(account: Shared<account::Account>) {
    let Some(cfg) = account.lock().unwrap().begin_sign_in() else {
        return;
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
    /// Whether the item is in the menu now: the problem and update items come and go.
    shown: AtomicBool,
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
        Ok(Live {
            id: spec.id,
            kind,
            shown: AtomicBool::new(true),
        })
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
    // The single-instance hold is named after the app identifier; a profile
    // (BOTRACING_PROFILE) gets its own (profile::identifier), so it runs next
    // to the real tray, is held to one copy itself, and `--quit` with the same
    // profile stops it: the clean stop for a seat's or CI's test tray.
    let mut context = tauri::generate_context!();
    let identifier = profile::identifier(&context.config().identifier);
    context.config_mut().identifier = identifier;
    // A second launch ends at once (two watchers would fight over the same
    // telemetry and state) and opens BotRacing in the browser instead.
    let builder = {
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
            // A second launch while the browser sign-in is open must not add a
            // window or tab of its own: the sign-in page is the way in.
            let signing_in = app
                .try_state::<Shared<account::Account>>()
                .is_some_and(|a| a.lock().unwrap().signing_in);
            if signing_in {
                return;
            }
            let app = app.clone();
            std::thread::spawn(move || open_window(&app));
        }))
    };
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The window's size and place, remembered.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            viewer::tray_uid,
            viewer::viewer_token,
            viewer::sign_out
        ])
        .setup(|app| {
            // `--quit` is a message to a running tray (the single-instance hold
            // forwards it and ends this process before we get here). Reaching
            // setup means there was none: exit, never start a tray in the
            // middle of an uninstall.
            if wants_quit(&std::env::args().collect::<Vec<_>>()) {
                std::process::exit(0);
            }
            let paths = Arc::new(sidecar::paths(&app.path().resource_dir()?));
            app.manage(paths.clone());
            if opens_on_start(
                cfg!(debug_assertions),
                std::env::var_os("BOTRACING_OPEN_ON_START").is_some(),
            ) {
                let handle = app.handle().clone();
                std::thread::spawn(move || open_window(&handle));
            }
            let account: Shared<account::Account> = Arc::new(Mutex::new(account::Account::new(
                auth::Config::from_build(),
                &paths.data,
                Box::new(account::CredentialManager),
            )));
            let supervisor: Shared<sidecar::Supervisor> =
                Arc::new(Mutex::new(sidecar::Supervisor::new()));
            app.manage(supervisor.clone());
            app.manage(account.clone());
            // Before the poll thread starts, so it never opens a browser
            // sign-in for a test tray that signs in from a file.
            if let Some(file) = seat_token_file(
                profile::is_default(),
                std::env::var_os("BOTRACING_SEAT_TOKEN_FILE"),
            ) {
                if account.lock().unwrap().needs_sign_in() {
                    start_seat_sign_in(account.clone(), file);
                }
            }

            // The tray menu is built from `menu::menu_items_for`, and every
            // update below goes through the same list, so the menu that ships
            // is the one the tests describe.
            let current_version = app.package_info().version.to_string();
            let update_slot: update::Slot = Arc::new(Mutex::new(None));
            let initial = menu::menu_items_for(&menu::MenuState::initial(&current_version));
            // Every item the menu can have: the optional ones are built once
            // and added to or taken out of the menu as the state changes.
            let mut every = menu::MenuState::initial(&current_version);
            every.problem = Some(String::new());
            every.update = Some(String::new());
            let live: Arc<Vec<Live>> = Arc::new(
                menu::menu_items_for(&every)
                    .iter()
                    .map(|spec| Live::build(app, spec))
                    .collect::<tauri::Result<Vec<_>>>()?,
            );
            for l in live.iter() {
                l.shown
                    .store(initial.iter().any(|i| i.id == l.id), Ordering::Relaxed);
            }
            let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = live
                .iter()
                .filter(|l| l.shown.load(Ordering::Relaxed))
                .map(Live::as_menu)
                .collect();
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

            // Cleanup of old recordings: once at start, then after each
            // uploader run. Only the real tray does it (not a walkthrough).
            let cleanup_paths = capture::prune_schedule::Paths::for_tray(&paths.data);
            if profile::is_default() {
                capture::prune_schedule::spawn(cleanup_paths.clone());
            }

            // iRacing's recorder: the same rules, its own thread.
            let iracing: Shared<Option<capture::runner::Handle>> = Arc::new(Mutex::new(
                (cfg!(windows)
                    && profile::is_default()
                    && std::env::var("BOTRACING_RECORDER").map_or(true, |v| v != "0"))
                .then(|| capture::runner::start_iracing(capture::runner::capture_root())),
            ));

            let (account_menu, sup_menu, pause_menu, slot_menu) = (
                account.clone(),
                supervisor.clone(),
                check(&live, "pause"),
                update_slot.clone(),
            );
            // Only the real tray starts with Windows and updates itself; a
            // walkthrough profile does neither.
            if profile::is_default() {
                // Always on; the Run value follows the exe if it moved (an update).
                let mut acct = account.lock().unwrap();
                if let Err(why) = paths::current_exe()
                    .map_err(|e| e.to_string())
                    .and_then(|exe| autostart::ensure_on(&autostart::Registry, &exe))
                {
                    acct.message = Some(format!("Start with Windows: {why}"));
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
            app.manage(iracing.clone());
            let recorder_menu = recorder.clone();
            let iracing_menu = iracing.clone();
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
                        let (account, sup, app) =
                            (account_menu.clone(), sup_menu.clone(), app.clone());
                        // Also closes the window and empties its storage: the
                        // window is never signed in as someone the tray is not.
                        std::thread::spawn(move || {
                            viewer::sign_out_everything(&app, &account, &sup)
                        });
                    }
                    "open" => {
                        // Off this thread: a window built from a menu handler
                        // can deadlock on Windows.
                        let app = app.clone();
                        std::thread::spawn(move || open_window(&app));
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
                        if let Some(rec) = iracing_menu.lock().unwrap().as_mut() {
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

            let cleanup_poll = cleanup_paths.clone();
            let menu_poll = menu.clone();
            let app_poll = app.handle().clone();
            let mut owes_window = opens_window_on_launch(&std::env::args().collect::<Vec<_>>());
            // A test tray signing in from a token file is not a person in a browser.
            let token_sign_in = seat_token_file(
                profile::is_default(),
                std::env::var_os("BOTRACING_SEAT_TOKEN_FILE"),
            )
            .is_some();
            let mut ticks = 0u32;
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
                    {
                        let acct = account.lock().unwrap();
                        let mut sup = supervisor.lock().unwrap();
                        sup.set_allowed(acct.should_run());
                        sup.tick(&paths);
                    }
                    if owes_window {
                        let (signed_in, signing_in, has_stored) = {
                            let acct = account.lock().unwrap();
                            (acct.session.is_some(), acct.signing_in, acct.has_stored())
                        };
                        // The browser sign-in is the way in, no window beside it; a
                        // token sign-in is quick and gets its window.
                        let browser = signing_in && !token_sign_in;
                        match launch_window(
                            signed_in,
                            browser || prompt,
                            has_stored || (signing_in && token_sign_in),
                            ticks,
                        ) {
                            LaunchWindow::Open => {
                                owes_window = false;
                                let app = app_poll.clone();
                                std::thread::spawn(move || open_window(&app));
                            }
                            LaunchWindow::Drop => owes_window = false,
                            LaunchWindow::Wait => ticks += 1,
                        }
                    }
                    let recorder_line = recorder
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map_or_else(|| "Recorder: off".to_string(), |r| r.line());
                    let iracing_line = iracing
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map_or_else(|| "iRacing: off".to_string(), |r| r.line());
                    let waiting = update_slot
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map(|p| p.version.clone());
                    let blocked = capture::prune::blocked_sims(
                        &capture::prune_policy::policy(),
                        &capture::prune::read_states(&cleanup_poll.state),
                    );
                    let state = {
                        let acct = account.lock().unwrap();
                        let sup = supervisor.lock().unwrap();
                        menu_state(
                            &acct,
                            &sup,
                            &paths,
                            [&recorder_line, &iracing_line],
                            &blocked,
                            waiting.as_deref(),
                            &current_version,
                        )
                    };
                    sync_menu(&menu_poll, &live, &menu::menu_items_for(&state));
                    std::thread::sleep(Duration::from_secs(5));
                }
            });
            Ok(())
        })
        .build(context)
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

/// Shows the window on the hosted app. If it cannot be built the system
/// browser takes over, and the status line says if even that fails.
fn open_window(app: &tauri::AppHandle) {
    let data = viewer::webview_dir(&app.state::<Arc<sidecar::Paths>>().data);
    if viewer::open(app, &data).is_err() {
        if let Err(why) = browser::open() {
            if let Some(account) = app.try_state::<Shared<account::Account>>() {
                account.lock().unwrap().message = Some(why);
            }
        }
    }
}

/// Everything the menu shows, from the account, the uploader's heartbeat and
/// the two recorders' lines.
fn menu_state(
    acct: &account::Account,
    sup: &sidecar::Supervisor,
    paths: &sidecar::Paths,
    recorder_lines: [&str; 2],
    cleanup_blocked: &[String],
    waiting_update: Option<&str>,
    version: &str,
) -> menu::MenuState {
    let beat = status::last_beat(&status::read_tail(&paths.status_file()));
    // The problems line takes the watcher's own state; each sim line its own part.
    let upload = status::upload(beat.as_ref());
    let upload_of = |sim: &str| status::upload_of(beat.as_ref(), sim);
    let lmu = menu::rec_of(recorder_lines[0]);
    let iracing = menu::rec_of(recorder_lines[1]);
    let signed_in = acct.session.is_some();
    let paused = acct.settings.paused;
    let another_account = paused
        && matches!(
            (&acct.owner_key, &acct.session),
            (Some(key), Some(session)) if *key != session.uid
        );
    let problems = menu::problems(&menu::Inputs {
        signed_in,
        has_stored: acct.has_stored(),
        config_missing: acct.config().missing().map(|r| r.to_string()),
        message: acct.message.as_deref(),
        another_account,
        supervisor_problem: sup.problem.as_deref(),
        upload: &upload,
        lmu: &lmu,
        iracing: &iracing,
        cleanup_blocked,
    });
    let uploads_on = signed_in && !paused;
    menu::MenuState {
        primary: menu::primary(acct),
        signed_in,
        paused,
        lmu: menu::sim_line("LMU", &lmu, &upload_of("lmu"), uploads_on),
        iracing: menu::sim_line("iRacing", &iracing, &upload_of("iracing"), uploads_on),
        problem: menu::problem_line(&problems),
        update: update::menu_line(waiting_update),
        version: format!("BotRacing {version}"),
    }
}

/// Puts the live menu in line with `specs`: the optional items are taken out
/// first, then added where the list has them, then every item's text is set.
fn sync_menu(menu: &Menu<tauri::Wry>, live: &[Live], specs: &[menu::Item]) {
    for item in live {
        let wanted = specs.iter().any(|s| s.id == item.id);
        if menu::OPTIONAL.contains(&item.id)
            && !wanted
            && item.shown.swap(false, Ordering::Relaxed)
        {
            let _ = menu.remove(item.as_menu());
        }
    }
    for (position, spec) in specs.iter().enumerate() {
        let Some(item) = live.iter().find(|l| l.id == spec.id) else {
            continue;
        };
        if !item.shown.swap(true, Ordering::Relaxed) {
            let _ = menu.insert(item.as_menu(), position);
        }
        item.apply(spec);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        launch_window, opens_on_start, opens_window_on_launch, seat_token_file, wants_quit,
        LaunchWindow,
    };

    #[test]
    fn only_a_test_profile_signs_in_from_a_file() {
        let file = || Some(std::ffi::OsString::from("seat.token"));
        // A profile (debug or release build alike): the file.
        assert_eq!(
            seat_token_file(false, file()),
            Some(std::path::PathBuf::from("seat.token"))
        );
        // The real tray, or no variable: the browser, as always.
        assert_eq!(seat_token_file(true, file()), None);
        assert_eq!(seat_token_file(false, None), None);
    }

    #[test]
    fn only_a_debug_build_opens_the_window_at_launch() {
        assert!(opens_on_start(true, true));
        assert!(!opens_on_start(true, false));
        assert!(
            !opens_on_start(false, true),
            "a release build ignores BOTRACING_OPEN_ON_START"
        );
        assert!(!opens_on_start(false, false));
    }

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

    #[test]
    fn a_person_starting_it_opens_the_window_and_the_logon_start_does_not() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        assert!(opens_window_on_launch(&args(&["botracing.exe"])));
        assert!(!opens_window_on_launch(&args(&[
            "botracing.exe",
            "--background"
        ])));
        assert!(!opens_window_on_launch(&args(&["botracing.exe", "--quit"])));
    }

    #[test]
    fn the_window_waits_for_a_stored_sign_in_and_never_sits_beside_the_browser_sign_in() {
        assert_eq!(launch_window(true, false, true, 0), LaunchWindow::Open);
        assert_eq!(launch_window(false, false, true, 3), LaunchWindow::Wait);
        assert_eq!(launch_window(false, false, true, 12), LaunchWindow::Drop);
        assert_eq!(launch_window(false, true, false, 0), LaunchWindow::Drop);
        assert_eq!(launch_window(false, false, false, 0), LaunchWindow::Drop);
    }
}
