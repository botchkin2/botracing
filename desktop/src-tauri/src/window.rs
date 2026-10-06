// "Open BotRacing": one window on the hosted web app, reused when it is
// already open (apex #81, marshal #82).
//
// The page is remote content, so it gets no way into the app:
// - no capability names it (capabilities/default.json has no `remote` entry
//   and no permissions), and the app registers no commands, so the page has
//   nothing to call;
// - it may navigate only within the BotRacing origin; any other link opens in
//   the system browser instead and the window stays where it is.
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// The hosts the BotRacing web app is served from; the first is the one the
/// window opens. Add the custom domain here when it lands: a host not in this
/// list is treated as an outside link.
pub const APP_HOSTS: &[&str] = &["botracing-61.web.app"];
const LABEL: &str = "app";

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

/// Whether a link that is not the app may be handed to the system browser:
/// web links only, never file:, javascript:, data: or a custom scheme.
pub fn opens_in_browser(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && !is_app_url(url)
}

fn to_browser(url: &Url) {
    if opens_in_browser(url) {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

/// The navigation rule: stay in the app origin, send everything else out.
fn navigate(url: &Url) -> bool {
    if is_app_url(url) {
        return true;
    }
    to_browser(url);
    false
}

/// Shows the window, creating it the first time. Call off the main thread: a
/// window built from a menu handler on Windows can deadlock.
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let url = format!("https://{}", APP_HOSTS[0])
        .parse::<Url>()
        .map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("BotRacing")
        .inner_size(1200.0, 800.0)
        .on_navigation(navigate)
        // target=_blank and window.open: never a new app window.
        .on_new_window(|url, _features| {
            to_browser(&url);
            NewWindowResponse::Deny
        })
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
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
        assert!(is_app_url_in(&url("https://botracing-61.web.app/"), &hosts));
        assert!(!is_app_url_in(
            &url("https://botracing.example.evil.test/"),
            &hosts
        ));
        assert!(!is_app_url_in(
            &url("https://sub.botracing.example/"),
            &hosts
        ));
        assert!(!is_app_url_in(
            &url("https://botracing.example@evil.test/"),
            &hosts
        ));
        assert!(!is_app_url_in(&url("http://botracing.example/"), &hosts));
        assert!(
            !APP_HOSTS.is_empty(),
            "the window needs a first host to open"
        );
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
            "data:text/html,hi",
            "ms-msdt:/id",
            "mailto:a@b.c",
        ] {
            assert!(!opens_in_browser(&url(never)), "{never}");
        }
    }

    // The page must have no way to drive the app (marshal #82): no capability
    // for the remote origin, no permissions at all, no commands registered.
    #[test]
    fn the_remote_page_has_no_way_into_the_app() {
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(
            caps.get("remote").is_none(),
            "a remote capability was added"
        );
        assert_eq!(caps["permissions"], serde_json::json!([]));
        assert_eq!(caps["windows"], serde_json::json!([]));
        let main = include_str!("main.rs");
        assert!(!main.contains("invoke_handler"), "a command was registered");
        assert!(!main.contains("withGlobalTauri"));
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(conf["app"].get("withGlobalTauri").is_none());
    }
}
