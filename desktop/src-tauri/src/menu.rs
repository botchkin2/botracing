// What the tray menu says about signing in. Pure, so each state is tested.
//
// The top item is the way in: signed out it is "Sign in" (a click
// opens the browser sign-in), while one is in progress it says so, and signed
// in it names the account. Signing in is never something to hunt for.
use crate::account::Account;

/// The top menu item: its text, and whether it can be clicked.
pub fn primary(acct: &Account) -> (String, bool) {
    match &acct.session {
        Some(s) => (format!("Signed in as {}", s.email), false),
        None if acct.signing_in => ("Signing in… finish in your browser".into(), false),
        None => ("Sign in".into(), true),
    }
}

/// The status line when there is no sign-in: uploads are paused, and why if
/// something went wrong (a sign-in that failed, timed out or was cancelled).
pub fn signed_out_status(message: Option<&str>) -> String {
    match message {
        Some(m) => format!("Not signed in: uploads paused. {m}"),
        None => "Not signed in: uploads paused".into(),
    }
}

/// The status line when a stored sign-in exists but could not be continued yet
/// (offline): the user is still signed in as far as the tray knows.
pub fn waiting_status(message: Option<&str>) -> String {
    message.map_or_else(|| "Signing back in…".into(), str::to_string)
}

/// The menu as data. The live tray is built from `menu_items_for` and updated
/// from it, so a test of this list covers what ships.
#[derive(Clone, Debug, PartialEq)]
pub struct MenuState {
    pub primary: (String, bool),
    pub signed_in: bool,
    pub paused: bool,
    pub status: String,
    pub recorder: String,
    /// The update line and whether it can be clicked.
    pub update: (String, bool),
    pub start_with_windows: bool,
    pub default_profile: bool,
}

impl MenuState {
    /// The state from the account and the live lines the setup computes.
    pub fn of(
        acct: &Account,
        status: String,
        recorder: String,
        update: (String, bool),
        start_with_windows: bool,
    ) -> MenuState {
        MenuState {
            primary: primary(acct),
            signed_in: acct.session.is_some(),
            paused: acct.settings.paused,
            status,
            recorder,
            update,
            start_with_windows,
            default_profile: crate::profile::is_default(),
        }
    }

    /// The state before the first poll: signed out, starting up.
    pub fn initial(update: (String, bool)) -> MenuState {
        MenuState {
            primary: ("Sign in".into(), true),
            signed_in: false,
            paused: false,
            status: "Starting…".into(),
            recorder: "Recorder: starting".into(),
            update,
            start_with_windows: false,
            default_profile: crate::profile::is_default(),
        }
    }
}

/// One entry of the tray menu. `checked` is set only for a check item.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: &'static str,
    pub text: String,
    pub enabled: bool,
    pub checked: Option<bool>,
}

fn item(id: &'static str, text: impl Into<String>, enabled: bool) -> Item {
    Item { id, text: text.into(), enabled, checked: None }
}

/// The tray menu's items in order. The status and recorder lines are the only
/// text that varies by state beyond the sign-in item; no uid or owner line.
pub fn menu_items_for(state: &MenuState) -> Vec<Item> {
    vec![
        item("signin", state.primary.0.clone(), state.primary.1),
        item("status", state.status.clone(), false),
        item("recorder", state.recorder.clone(), false),
        item("separator", "", false),
        item("signout", "Sign out", state.signed_in),
        item("open", "Open BotRacing", true),
        Item { id: "pause", text: "Pause uploads".into(), enabled: true, checked: Some(state.paused) },
        Item {
            id: "autostart",
            text: "Start with Windows".into(),
            enabled: state.default_profile,
            checked: Some(state.start_with_windows),
        },
        item("older", "Upload older sessions…", true),
        item("folder", "Open data folder", true),
        item("update", state.update.0.clone(), state.update.1),
        item("quit", "Quit", true),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account::{Account, SecretStore};
    use crate::auth::{Config, Session};
    use std::time::{Duration, SystemTime};

    struct NoSecrets;
    impl SecretStore for NoSecrets {
        fn get(&self) -> Option<String> {
            None
        }
        fn set(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn delete(&self) {}
    }

    fn account() -> Account {
        let dir = std::env::temp_dir().join(format!("botracing-menu-{}", std::process::id()));
        Account::new(Config::from_build(), &dir, Box::new(NoSecrets))
    }

    #[test]
    fn signed_out_the_top_item_is_a_clickable_sign_in() {
        let a = account();
        assert_eq!(primary(&a), ("Sign in".to_string(), true));
    }

    #[test]
    fn while_signing_in_the_top_item_says_so_and_cannot_be_clicked_again() {
        let mut a = account();
        a.signing_in = true;
        let (text, enabled) = primary(&a);
        assert!(text.starts_with("Signing in"), "{text}");
        assert!(!enabled);
    }

    #[test]
    fn signed_in_the_top_item_names_the_account() {
        let mut a = account();
        a.session = Some(Session {
            id_token: "t".into(),
            refresh_token: "r".into(),
            uid: "u".into(),
            email: "driver@example.com".into(),
            expires_at: SystemTime::now() + Duration::from_secs(3600),
        });
        assert_eq!(
            primary(&a),
            ("Signed in as driver@example.com".to_string(), false)
        );
    }

    #[test]
    fn the_signed_out_status_says_uploads_are_paused_and_why_it_failed() {
        assert_eq!(signed_out_status(None), "Not signed in: uploads paused");
        assert_eq!(
            signed_out_status(Some(
                "Sign-in failed: no answer from the browser (timed out)"
            )),
            "Not signed in: uploads paused. Sign-in failed: no answer from the browser (timed out)"
        );
        assert_eq!(waiting_status(None), "Signing back in…");
        assert_eq!(
            waiting_status(Some("Offline, will retry (x)")),
            "Offline, will retry (x)"
        );
    }

    fn state(signed_in: bool, paused: bool, primary: (&str, bool)) -> MenuState {
        MenuState {
            primary: (primary.0.into(), primary.1),
            signed_in,
            paused,
            status: "status".into(),
            recorder: "Recorder: off".into(),
            update: ("up to date".into(), false),
            start_with_windows: false,
            default_profile: true,
        }
    }

    fn ids(items: &[Item]) -> Vec<&'static str> {
        items.iter().map(|i| i.id).collect()
    }

    #[test]
    fn a_fresh_own_account_is_unpaused_with_no_uid_or_owner_line() {
        let items = menu_items_for(&state(true, false, ("Signed in as a@b.c", false)));
        assert_eq!(
            ids(&items),
            ["signin", "status", "recorder", "separator", "signout", "open", "pause", "autostart", "older", "folder", "update", "quit"]
        );
        let pause = items.iter().find(|i| i.id == "pause").unwrap();
        assert_eq!(pause.checked, Some(false), "no Paused for the own account");
        assert!(items.iter().all(|i| !i.text.starts_with("uid") && !i.text.starts_with("owner")));
    }

    #[test]
    fn another_owner_keeps_the_pause_checked() {
        let items = menu_items_for(&state(true, true, ("Signed in as a@b.c", false)));
        let pause = items.iter().find(|i| i.id == "pause").unwrap();
        assert_eq!(pause.checked, Some(true));
        assert!(items.iter().all(|i| !i.text.starts_with("owner")));
    }

    #[test]
    fn signed_out_offers_sign_in_and_no_sign_out() {
        let items = menu_items_for(&state(false, false, ("Sign in", true)));
        let signin = items.iter().find(|i| i.id == "signin").unwrap();
        assert_eq!((signin.text.as_str(), signin.enabled), ("Sign in", true));
        let signout = items.iter().find(|i| i.id == "signout").unwrap();
        assert!(!signout.enabled, "nothing to sign out of");
    }
}
