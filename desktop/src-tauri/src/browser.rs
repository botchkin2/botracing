// "Open BotRacing": the hosted web app, in the user's own browser (apex #191).
//
// It used to open an embedded window on the page, but Google refuses its sign-in
// inside an embedded webview, so the page's login button could never work
// there. The system browser is where Google sign-in works and where the user
// stays signed in, and it is one thing fewer to keep safe: the tray has no
// webview and no remote content in it.

/// The hosts the BotRacing web app is served from; the first is the one opened.
/// Add the custom domain here when it lands.
pub const APP_HOSTS: &[&str] = &["botracing-61.web.app"];

pub fn app_url() -> String {
    format!("https://{}", APP_HOSTS[0])
}

/// Opens the web app in the default browser. The Err is a sentence for the
/// tray's status line.
pub fn open() -> Result<(), String> {
    tauri_plugin_opener::open_url(app_url(), None::<&str>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_opens_over_https_at_the_first_host() {
        assert_eq!(app_url(), "https://botracing-61.web.app");
        assert!(!APP_HOSTS.is_empty());
        assert!(APP_HOSTS
            .iter()
            .all(|h| !h.contains('/') && !h.contains(':') && !h.contains('@')));
    }

    // The tray has no webview at all any more: no window code, no capability
    // for remote content, no commands for a page to call.
    #[test]
    fn the_tray_has_no_embedded_page_to_defend() {
        let main = include_str!("main.rs");
        for gone in [
            "WebviewWindow",
            "WebviewUrl",
            "mod window",
            "window::open",
            "on_navigation",
        ] {
            assert!(!main.contains(gone), "main.rs still has {gone}");
        }
        assert!(!main.contains("invoke_handler"), "a command was registered");
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(caps.get("remote").is_none());
        assert_eq!(caps["permissions"], serde_json::json!([]));
        assert_eq!(caps["windows"], serde_json::json!([]));
        assert!(
            !std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/src/window.rs")).exists()
        );
    }
}
