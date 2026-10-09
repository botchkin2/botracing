// "Open BotRacing": the hosted web app, in the user's own browser (apex #191).
//
// The tray's own window (viewer.rs) is the way in now; this is what is left of
// the system-browser route: the fallback when the window cannot be built, and
// where Google sign-in happens (Google refuses its sign-in inside an embedded
// webview, so the window is signed in by the tray instead, never by Google).

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
}
