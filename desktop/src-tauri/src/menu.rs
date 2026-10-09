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
}
