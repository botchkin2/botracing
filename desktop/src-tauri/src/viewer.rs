// "Open BotRacing": the tray's own window on the hosted web app (pit-wall
// thread 55, decision 2026-10-05; rake's design, apex's order). One window,
// signed in as the tray's user with no Google in the webview.
//
// The page is remote content, so what it can reach is small and pinned down:
// - the capability `viewer.json` names exactly the app origin and exactly three
//   commands, `tray_uid`, `viewer_token` and `sign_out`; nothing else (no fs, shell,
//   opener, events). Whatever the page can call, an XSS on it could call too;
//   `tray_uid` and `viewer_token` give it only the user's own session, `sign_out` ends it;
// - the commands refuse a caller that is not the app origin;
// - navigation stays on the app origin; any other link opens in the system
//   browser and the window stays where it is (never accounts.google.com);
// - the custom token reaches the page over IPC and never in a URL, so it is not
//   in WebView2's history.
use crate::account::{self, Account};
use crate::browser::{app_url, APP_HOSTS};
use crate::sidecar::{Paths, Supervisor};
use crate::Shared;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, State, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub const LABEL: &str = "main";
const OFFLINE_PAGE: &str = "offline.html";

/// True only for a BotRacing origin itself: https, exactly one of the hosts,
/// the default port, and no `user@` in front
/// (`https://botracing-61.web.app@evil.example` is a request to evil.example).
pub fn is_app_url(url: &Url) -> bool {
    is_app_url_in(url, APP_HOSTS)
}

fn is_app_url_in(url: &Url, hosts: &[&str]) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| hosts.contains(&host))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

/// Whether a link that is not the app may go to the system browser: web links
/// only, never file:, javascript:, data: or a custom scheme.
pub fn opens_in_browser(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && !is_app_url(url)
}

fn to_browser(url: &Url) {
    if opens_in_browser(url) {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

/// The navigation rule: the app origin, and the tray's own offline page; every
/// other address goes out to the system browser and the window stays put.
fn navigate(url: &Url) -> bool {
    if navigation_allowed(url) {
        return true;
    }
    to_browser(url);
    false
}

/// What the window may show itself: the app origin and the offline page.
pub fn navigation_allowed(url: &Url) -> bool {
    is_app_url(url) || is_offline_page(url)
}

/// The bundled "can't reach BotRacing" page (the tray's own file, no IPC
/// capability names it).
fn is_offline_page(url: &Url) -> bool {
    // tauri://localhost on other platforms, http(s)://tauri.localhost on Windows.
    matches!(url.host_str(), Some("tauri.localhost") | Some("localhost"))
        && url.path() == format!("/{OFFLINE_PAGE}")
}

/// How long "Open BotRacing" waits on the site before it shows the offline
/// page: the window appears within this even with no network (rake #3161).
const REACHABLE_WAIT: Duration = Duration::from_millis(1500);

/// Whether the app's site answers: a failed load in the webview would show
/// WebView2's own error page, so the tray checks first.
fn reachable(url: &str) -> bool {
    ureq::AgentBuilder::new()
        .timeout(REACHABLE_WAIT)
        .build()
        .head(url)
        .call()
        .is_ok()
}

/// Tauri's own WebView2 arguments on Windows; any we add must keep them.
const DEFAULT_BROWSER_ARGS: &str = "--disable-features=msWebOoUI,msPdfOOUI,msSmartScreenProtection";

/// The WebView2 arguments for a debug build with `BOTRACING_DEVTOOLS_PORT`
/// set: a CDP port on loopback, for a proof of the window. Any local process
/// can attach to that port, so a release build never opens one, and a value
/// that is not a port is ignored.
fn devtools_args(debug_build: bool, port: Option<&str>) -> Option<String> {
    let port: u16 = port?.parse().ok().filter(|p| *p > 0)?;
    debug_build.then(|| format!("{DEFAULT_BROWSER_ARGS} --remote-debugging-port={port}"))
}

/// One open at a time: two quick clicks of "Open BotRacing" would both find no
/// window, and the second build would fail on the taken label.
static OPENING: Mutex<()> = Mutex::new(());

/// Shows the window, creating it the first time. Call off the main thread: a
/// window built from a menu handler on Windows can deadlock.
pub fn open(app: &AppHandle, webview_data: &Path) -> Result<(), String> {
    let _one = OPENING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    wipe_if_owed(webview_data);
    let url = app_url();
    let target = if reachable(&url) {
        WebviewUrl::External(url.parse::<Url>().map_err(|e| e.to_string())?)
    } else {
        WebviewUrl::App(OFFLINE_PAGE.into())
    };
    let mut builder = WebviewWindowBuilder::new(app, LABEL, target);
    let port = std::env::var("BOTRACING_DEVTOOLS_PORT").ok();
    if let Some(args) = devtools_args(cfg!(debug_assertions), port.as_deref()) {
        builder = builder.additional_browser_args(&args);
    }
    let window = builder
        .title("BotRacing")
        .inner_size(1200.0, 800.0)
        // The window's own storage, apart from the tray's data and per profile
        // (the tray's data folder is already per profile).
        .data_directory(webview_data.to_path_buf())
        .on_navigation(navigate)
        // target=_blank and window.open: never a new app window.
        .on_new_window(|url, _features| {
            to_browser(&url);
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| e.to_string())?;
    // Closing hides: the tray keeps running, and the next open is instant.
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
    Ok(())
}

/// What the tray hands the page.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewerToken {
    pub custom_token: String,
    pub uid: String,
}

/// The server's answer (`POST /api/tray/viewer`) as the page needs it. The uid
/// must be the tray's own: a token for anyone else is refused here.
pub fn parse_viewer_answer(body: &Value, expected_uid: &str) -> Result<ViewerToken, String> {
    let text = |k: &str| body[k].as_str().unwrap_or_default().to_string();
    let (custom_token, uid) = (text("customToken"), text("uid"));
    if custom_token.is_empty() || uid.is_empty() {
        return Err("the server's answer was missing the sign-in".into());
    }
    if uid != expected_uid {
        return Err("the server answered for another user".into());
    }
    Ok(ViewerToken { custom_token, uid })
}

fn request_viewer_token(
    tray_api: &str,
    id_token: &str,
    expected_uid: &str,
) -> Result<ViewerToken, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .build();
    let response = agent
        .post(&format!("{tray_api}/viewer"))
        .set("Authorization", &format!("Bearer {id_token}"))
        .send_json(serde_json::json!({}))
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "sign in again".to_string(),
            ureq::Error::Status(429, _) => "too many sign-ins: try again later".to_string(),
            other => format!("couldn't reach BotRacing: {other}"),
        })?;
    let body: Value = response.into_json().map_err(|e| e.to_string())?;
    parse_viewer_answer(&body, expected_uid)
}

/// A command may only be asked by the app's own page: the capability says so,
/// and this checks it again at the call.
fn from_app(webview: &Webview) -> Result<(), String> {
    match webview.url() {
        Ok(url) if is_app_url(&url) => Ok(()),
        _ => Err("not the BotRacing page".into()),
    }
}

/// Who the tray is signed in as, or null. The page compares its own user with
/// this on every load: a sign-in kept in the webview from another tray user
/// (or one left by a sign-out that could not empty the folder) is signed out
/// (rake #3161). The uid only, nothing that signs anyone in.
#[tauri::command]
pub fn tray_uid(
    webview: Webview,
    account: State<'_, Shared<Account>>,
) -> Result<Option<String>, String> {
    from_app(&webview)?;
    let acct = account.lock().unwrap();
    Ok(acct.session.as_ref().map(|s| s.uid.clone()))
}

/// The page asks for a sign-in on load when it is signed out. Fresh each call:
/// nothing is kept. An ID token about to run out is renewed first, the same
/// renewal the tray's own loop makes.
#[tauri::command(async)]
pub fn viewer_token(
    webview: Webview,
    account: State<'_, Shared<Account>>,
) -> Result<ViewerToken, String> {
    from_app(&webview)?;
    // The network calls run without the account lock held.
    let (cfg, session) = {
        let acct = account.lock().unwrap();
        let session = acct.session.clone().ok_or("Sign in from the tray icon")?;
        (acct.config().clone(), session)
    };
    let session = if session.expires_within(account::REFRESH_MARGIN) {
        account::refresh_now(&account, &cfg, session)?
    } else {
        session
    };
    request_viewer_token(&cfg.tray_api, &session.id_token, &session.uid)
}

/// Signs the tray out and forgets the window's sign-in. Same as the tray menu's
/// "Sign out": the window can never stay signed in as someone the tray is not.
pub fn sign_out_everything(
    app: &AppHandle,
    account: &Shared<Account>,
    supervisor: &Shared<Supervisor>,
) {
    {
        let mut acct = account.lock().unwrap();
        acct.sign_out(|| supervisor.lock().unwrap().set_allowed(false));
    }
    forget(app);
}

/// Closes the window and deletes its storage folder, so nothing of the sign-in
/// is left in the webview profile. Always, whether or not the window was
/// opened in this run: a sign-in persisted by an earlier run lives in the
/// folder, not in the window (rake #3161).
pub fn forget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.clear_all_browsing_data();
        // `destroy`, not `close`: close only hides it (see `open`).
        let _ = window.destroy();
    }
    if let Some(paths) = app.try_state::<Arc<Paths>>() {
        let dir = webview_dir(&paths.data);
        // WebView2 lets go of its files a moment after the window goes.
        std::thread::spawn(move || {
            wipe(&dir, WIPE_TRIES, Duration::from_millis(250));
        });
    }
}

/// The window's storage, under the tray's own (per profile) data folder.
pub fn webview_dir(data: &Path) -> PathBuf {
    data.join("webview")
}

const WIPE_TRIES: u32 = 20;

/// The mark that a wipe is owed: left when the folder could not be deleted
/// yet, and honoured before the next window is built.
fn wipe_mark(dir: &Path) -> PathBuf {
    dir.with_extension("wipe")
}

/// Deletes the storage folder, trying again while WebView2 still holds it.
/// The mark goes first and stays until the folder is gone, so a wipe cut short
/// (the tray quit, a file still locked) is finished by the next `open`. True
/// once the folder is gone.
pub fn wipe(dir: &Path, tries: u32, wait: Duration) -> bool {
    let mark = wipe_mark(dir);
    let _ = std::fs::write(&mark, b"");
    for attempt in 0..tries.max(1) {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => break,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) if attempt + 1 < tries => std::thread::sleep(wait),
            Err(_) => return false,
        }
    }
    let _ = std::fs::remove_file(&mark);
    true
}

/// Finishes a wipe an earlier sign-out could not: no window exists here, so
/// nothing holds the folder.
fn wipe_if_owed(dir: &Path) {
    if wipe_mark(dir).exists() {
        wipe(dir, 3, Duration::from_millis(100));
    }
}

#[tauri::command(async)]
pub fn sign_out(
    webview: Webview,
    window: WebviewWindow,
    account: State<'_, Shared<Account>>,
    supervisor: State<'_, Shared<Supervisor>>,
) -> Result<(), String> {
    from_app(&webview)?;
    sign_out_everything(window.app_handle(), &account, &supervisor);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn only_a_debug_build_opens_a_devtools_port() {
        let args = devtools_args(true, Some("9333")).unwrap();
        assert!(args.ends_with(" --remote-debugging-port=9333"));
        assert!(
            args.starts_with(DEFAULT_BROWSER_ARGS),
            "Tauri's own arguments stay"
        );
        assert_eq!(
            devtools_args(false, Some("9333")),
            None,
            "a release build never opens one"
        );
        assert_eq!(devtools_args(true, None), None);
        for bad in ["", "0", "x", "70000", "9333 --no-sandbox"] {
            assert_eq!(
                devtools_args(true, Some(bad)),
                None,
                "{bad:?} is not a port"
            );
        }
    }

    #[test]
    fn only_the_botracing_origin_is_the_app() {
        for ok in [
            "https://botracing-61.web.app",
            "https://botracing-61.web.app/",
            "https://botracing-61.web.app/session/abc?x=1#top",
        ] {
            assert!(is_app_url(&url(ok)), "{ok}");
        }
        for bad in [
            "http://botracing-61.web.app/",
            "https://botracing-61.web.app:8443/",
            "https://botracing-61.web.app.evil.example/",
            "https://evilbotracing-61.web.app/",
            "https://botracing-61.web.app@evil.example/",
            "https://user:pw@botracing-61.web.app/",
            "https://example.com/",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "about:blank",
        ] {
            assert!(!is_app_url(&url(bad)), "{bad}");
        }
    }

    #[test]
    fn a_second_host_in_the_list_is_the_app_and_lookalikes_still_are_not() {
        let hosts = ["botracing-61.web.app", "botracing.example"];
        assert!(is_app_url_in(&url("https://botracing.example/x"), &hosts));
        assert!(!is_app_url_in(
            &url("https://botracing.example.evil.test/"),
            &hosts
        ));
        assert!(!is_app_url_in(
            &url("https://sub.botracing.example/"),
            &hosts
        ));
        assert!(!is_app_url_in(&url("http://botracing.example/"), &hosts));
    }

    #[test]
    fn only_web_links_go_to_the_system_browser() {
        assert!(opens_in_browser(&url("https://garage61.net/x")));
        assert!(opens_in_browser(&url("http://example.com/")));
        // The app itself is not "external", and nothing else is handed over.
        assert!(!opens_in_browser(&url("https://botracing-61.web.app/")));
        for never in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "mailto:a@b.example",
            "ms-settings:",
        ] {
            assert!(!opens_in_browser(&url(never)), "{never}");
        }
    }

    #[test]
    fn the_window_navigates_only_within_the_app_and_its_offline_page() {
        assert!(navigation_allowed(&url(
            "https://botracing-61.web.app/plan"
        )));
        assert!(navigation_allowed(&url(
            "http://tauri.localhost/offline.html"
        )));
        // Every other address is refused (and, for a web link, sent out).
        for refused in [
            "https://accounts.google.com/signin",
            "https://garage61.net/",
            "http://tauri.localhost/other.html",
            "http://tauri.localhost/offline.html/../secret",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
        ] {
            assert!(!navigation_allowed(&url(refused)), "{refused}");
        }
    }

    #[test]
    fn the_server_answer_must_be_for_the_tray_user_and_complete() {
        let ok = serde_json::json!({"customToken": "t", "uid": "u1", "email": "a@b.example"});
        assert_eq!(
            parse_viewer_answer(&ok, "u1"),
            Ok(ViewerToken {
                custom_token: "t".into(),
                uid: "u1".into()
            })
        );
        assert!(parse_viewer_answer(&ok, "someone-else").is_err());
        for missing in [
            serde_json::json!({"uid": "u1"}),
            serde_json::json!({"customToken": "t"}),
            serde_json::json!({}),
            serde_json::json!({"customToken": "", "uid": "u1"}),
        ] {
            assert!(parse_viewer_answer(&missing, "u1").is_err(), "{missing}");
        }
    }

    // What the page can reach is pinned here, replacing the "no embedded page"
    // test from #292: the capability names exactly the app origin and exactly
    // the three commands, with no other permission; the commands are the only
    // ones registered; navigation refuses everything else.
    #[test]
    fn the_page_can_reach_exactly_the_app_origin_and_three_commands() {
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/viewer.json")).unwrap();
        assert_eq!(caps["windows"], serde_json::json!([LABEL]));
        assert_eq!(
            caps["remote"]["urls"],
            serde_json::json!(APP_HOSTS
                .iter()
                .map(|h| format!("https://{h}/*"))
                .collect::<Vec<_>>())
        );
        let mut permissions: Vec<String> = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap().to_string())
            .collect();
        permissions.sort();
        assert_eq!(
            permissions,
            ["allow-sign-out", "allow-tray-uid", "allow-viewer-token"]
        );

        // The tray's other capability grants nothing and names no window.
        let default: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(default.get("remote").is_none());
        assert_eq!(default["permissions"], serde_json::json!([]));
        assert_eq!(default["windows"], serde_json::json!([]));

        // Only these three commands are registered, and the build declares them.
        let main = include_str!("main.rs");
        assert!(main.contains(
            "generate_handler![viewer::tray_uid, viewer::viewer_token, viewer::sign_out]"
        ));
        assert_eq!(main.matches("generate_handler!").count(), 1);
        let build = include_str!("../build.rs");
        assert!(build.contains(r#"&["tray_uid", "viewer_token", "sign_out"]"#));
    }
    #[test]
    fn a_wipe_deletes_the_storage_and_its_mark() {
        let data = std::env::temp_dir().join(format!("botracing-wipe-{}", std::process::id()));
        let dir = webview_dir(&data);
        std::fs::create_dir_all(dir.join("EBWebView/Default/IndexedDB")).unwrap();
        std::fs::write(dir.join("EBWebView/Default/IndexedDB/x.log"), b"session").unwrap();
        assert!(wipe(&dir, 3, Duration::from_millis(1)));
        assert!(!dir.exists());
        assert!(!wipe_mark(&dir).exists());
        // Nothing to delete is a finished wipe too.
        assert!(wipe(&dir, 1, Duration::ZERO));
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn a_wipe_that_cannot_finish_leaves_its_mark_for_the_next_open() {
        let data = std::env::temp_dir().join(format!("botracing-wipe-owed-{}", std::process::id()));
        std::fs::create_dir_all(&data).unwrap();
        // A file where the folder should be: remove_dir_all fails on it every time.
        let dir = webview_dir(&data);
        std::fs::write(&dir, b"not a folder").unwrap();
        assert!(!wipe(&dir, 2, Duration::from_millis(1)));
        assert!(
            wipe_mark(&dir).exists(),
            "the mark stays until the folder is gone"
        );
        std::fs::remove_file(&dir).unwrap();
        wipe_if_owed(&dir);
        assert!(!wipe_mark(&dir).exists());
        let _ = std::fs::remove_dir_all(&data);
    }
}
