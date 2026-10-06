// Who is signed in, whether uploads are allowed, and the files that follow
// from it. The refresh token lives in Windows Credential Manager; the ID token
// goes to the `token` file the watcher reads on every request (so it never
// outlives a sign-out); settings.json holds only what is not secret.
//
// Rules (pit wall thread 2, marshal #58 and #77):
// - the first sign-in of a uid starts Paused: until a person un-pauses it, the
//   watcher does not run, so nothing is uploaded under a uid whose owner key
//   has not been checked. Un-pausing is what confirms that uid.
// - a different uid signing in later is paused again.
// - a refresh that fails means the token file is deleted and the user must
//   sign in again; nothing uploads on a stale token.
// - sign-out stops the watcher, deletes the token file, then removes the
//   stored credential, in that order.
use crate::auth::{self, Config, Session};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Where the refresh token is kept.
pub trait SecretStore: Send {
    fn get(&self) -> Option<String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self);
}

/// Windows Credential Manager (the `keyring` crate).
pub struct CredentialManager;

impl CredentialManager {
    fn entry() -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new("BotRacing", "account")
    }
}

impl SecretStore for CredentialManager {
    fn get(&self) -> Option<String> {
        Self::entry().ok()?.get_password().ok()
    }
    fn set(&self, value: &str) -> Result<(), String> {
        Self::entry()
            .and_then(|e| e.set_password(value))
            .map_err(|e| e.to_string())
    }
    fn delete(&self) {
        if let Ok(entry) = Self::entry() {
            let _ = entry.delete_credential();
        }
    }
}

#[derive(Default, Clone, Debug, PartialEq)]
pub struct Settings {
    pub paused: bool,
    /// The uid whose owner key a person has seen and un-paused for.
    pub confirmed_uid: Option<String>,
}

impl Settings {
    fn load(file: &Path) -> Settings {
        let value: Value = std::fs::read_to_string(file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(Value::Null);
        Settings {
            paused: value["paused"].as_bool().unwrap_or(false),
            confirmed_uid: value["confirmedUid"].as_str().map(str::to_string),
        }
    }

    fn save(&self, file: &Path) {
        let value = json!({"paused": self.paused, "confirmedUid": self.confirmed_uid});
        let _ = std::fs::write(file, value.to_string());
    }
}

/// How soon before its end an ID token is replaced.
const REFRESH_MARGIN: Duration = Duration::from_secs(10 * 60);
/// How often the owner key is read again.
const OWNER_EVERY: Duration = Duration::from_secs(5 * 60);

pub struct Account {
    cfg: Config,
    data: PathBuf,
    secrets: Box<dyn SecretStore>,
    pub session: Option<Session>,
    pub owner_key: Option<String>,
    owner_checked: Option<SystemTime>,
    pub settings: Settings,
    /// Shown instead of the status while set ("Sign in again", an error).
    pub message: Option<String>,
    pub signing_in: bool,
}

impl Account {
    pub fn new(cfg: Config, data: &Path, secrets: Box<dyn SecretStore>) -> Account {
        let _ = std::fs::create_dir_all(data);
        let settings = Settings::load(&data.join("settings.json"));
        Account {
            cfg,
            data: data.to_path_buf(),
            secrets,
            session: None,
            owner_key: None,
            owner_checked: None,
            settings,
            message: None,
            signing_in: false,
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    fn token_file(&self) -> PathBuf {
        self.data.join("token")
    }

    fn settings_file(&self) -> PathBuf {
        self.data.join("settings.json")
    }

    /// Uploads are allowed: signed in and not paused.
    pub fn should_run(&self) -> bool {
        self.session.is_some() && !self.settings.paused
    }

    /// Signed in as a uid nobody has un-paused for yet.
    pub fn unconfirmed(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|s| self.settings.confirmed_uid.as_deref() != Some(&s.uid))
    }

    /// The ID token to the file the watcher reads, replaced whole.
    fn write_token(&self, session: &Session) {
        let tmp = self.data.join("token.tmp");
        if std::fs::write(&tmp, &session.id_token).is_ok() {
            let _ = std::fs::rename(&tmp, self.token_file());
        }
    }

    fn store_refresh(&self, session: &Session) {
        let stored = json!({
            "uid": session.uid,
            "email": session.email,
            "refresh": session.refresh_token,
        });
        if let Err(e) = self.secrets.set(&stored.to_string()) {
            // Without the stored credential the next start asks to sign in
            // again; the session in hand still works.
            eprintln!("could not keep the sign-in: {e}");
        }
    }

    /// Which Google token Firebase accepted, kept in the data folder so the
    /// PR note can say (marshal #75). Not secret: only the word.
    pub fn record_accepted(&self, accepted: auth::Accepted) {
        let _ = std::fs::write(
            self.data.join("last-signin.txt"),
            format!(
                "firebase accepted: {accepted:?}
"
            ),
        );
    }

    /// A completed sign-in: keep it, write the token, and pause when this uid
    /// has not been confirmed.
    pub fn signed_in(&mut self, session: Session) {
        self.store_refresh(&session);
        self.write_token(&session);
        if self.settings.confirmed_uid.as_deref() != Some(&session.uid) {
            self.settings.paused = true;
            self.settings.save(&self.settings_file());
        }
        self.session = Some(session);
        self.message = None;
        self.owner_key = None;
        self.owner_checked = None;
        self.refresh_owner();
    }

    /// At start: continue the stored sign-in with a fresh token, if there is
    /// one. A stored sign-in that can no longer be refreshed is dropped.
    pub fn restore(&mut self) {
        let Some(stored) = self.secrets.get() else {
            return;
        };
        let value: Value = serde_json::from_str(&stored).unwrap_or(Value::Null);
        let (Some(uid), Some(refresh)) = (value["uid"].as_str(), value["refresh"].as_str()) else {
            self.secrets.delete();
            return;
        };
        let old = Session {
            id_token: String::new(),
            refresh_token: refresh.to_string(),
            uid: uid.to_string(),
            email: value["email"].as_str().unwrap_or_default().to_string(),
            expires_at: SystemTime::now(),
        };
        match auth::refresh(&self.cfg, &old) {
            Ok(session) => {
                self.store_refresh(&session);
                self.write_token(&session);
                self.session = Some(session);
                self.refresh_owner();
            }
            Err(e) => self.sign_in_lost(&e),
        }
    }

    /// The token cannot be renewed: remove what would let the watcher upload.
    fn sign_in_lost(&mut self, why: &str) {
        let _ = std::fs::remove_file(self.token_file());
        self.secrets.delete();
        self.session = None;
        self.owner_key = None;
        self.message = Some(format!("Sign in again ({why})"));
    }

    /// Called every few seconds: renews the ID token before it runs out and
    /// rereads the owner key now and then.
    pub fn maintain(&mut self) {
        let Some(session) = self.session.clone() else {
            return;
        };
        if session.expires_within(REFRESH_MARGIN) {
            match auth::refresh(&self.cfg, &session) {
                Ok(next) => {
                    self.store_refresh(&next);
                    self.write_token(&next);
                    self.session = Some(next);
                }
                Err(e) => {
                    self.sign_in_lost(&e);
                    return;
                }
            }
        }
        let due = self
            .owner_checked
            .and_then(|at| at.elapsed().ok())
            .is_none_or(|age| age > OWNER_EVERY);
        if due {
            self.refresh_owner();
        }
    }

    fn refresh_owner(&mut self) {
        let Some(session) = &self.session else {
            return;
        };
        self.owner_checked = Some(SystemTime::now());
        match auth::owner_key(&self.cfg, &session.id_token) {
            Ok(key) => self.owner_key = Some(key),
            Err(e) => {
                self.owner_key = None;
                eprintln!("could not read the owner key: {e}");
            }
        }
    }

    /// A person's choice. Un-pausing confirms the signed-in uid.
    pub fn set_paused(&mut self, paused: bool) {
        self.settings.paused = paused;
        if !paused {
            if let Some(session) = &self.session {
                self.settings.confirmed_uid = Some(session.uid.clone());
            }
        }
        self.settings.save(&self.settings_file());
    }

    /// Stops the watcher (`stop`), deletes the token file, then removes the
    /// stored credential: in that order, so there is never a running watcher
    /// holding a token for a user who has signed out.
    pub fn sign_out(&mut self, stop: impl FnOnce()) {
        stop();
        let _ = std::fs::remove_file(self.token_file());
        self.secrets.delete();
        self.session = None;
        self.owner_key = None;
        self.owner_checked = None;
        self.message = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::test_support::*;
    use std::sync::{Arc, Mutex};

    /// A secret store in memory, shared so a "restart" can see it.
    #[derive(Clone, Default)]
    struct Memory(Arc<Mutex<Option<String>>>);
    impl SecretStore for Memory {
        fn get(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
        fn delete(&self) {
            *self.0.lock().unwrap() = None;
        }
    }

    fn data_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("botracing-acct-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn session(uid: &str, expires_in: u64) -> Session {
        Session {
            id_token: format!("ID-{uid}"),
            refresh_token: format!("REF-{uid}"),
            uid: uid.into(),
            email: format!("{uid}@x.y"),
            expires_at: SystemTime::now() + Duration::from_secs(expires_in),
        }
    }

    // The stub answers /me with an owner key and the refresh endpoint with a
    // new token for the uid in the request.
    fn server() -> String {
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                (200, r#"{"ownerKey":"botkin"}"#.into())
            } else {
                (
                    200,
                    r#"{"id_token":"ID-REFRESHED","refresh_token":"REF-NEW","user_id":"u1","expires_in":"3600"}"#.into(),
                )
            }
        });
        base
    }

    #[test]
    fn the_first_sign_in_is_paused_and_unpausing_confirms_the_uid() {
        let dir = data_dir("first");
        let mem = Memory::default();
        let mut a = Account::new(cfg(&server()), &dir, Box::new(mem.clone()));
        a.signed_in(session("u1", 3600));
        assert!(a.settings.paused, "first sign-in must start paused");
        assert!(a.unconfirmed());
        assert!(!a.should_run());
        assert_eq!(a.owner_key.as_deref(), Some("botkin"));
        assert_eq!(std::fs::read_to_string(dir.join("token")).unwrap(), "ID-u1");

        a.set_paused(false);
        assert!(a.should_run());
        assert!(!a.unconfirmed());

        // A restart keeps the choice and the sign-in.
        let mut b = Account::new(cfg(&server()), &dir, Box::new(mem));
        b.restore();
        assert_eq!(b.session.as_ref().map(|s| s.uid.as_str()), Some("u1"));
        assert!(
            b.should_run(),
            "a confirmed uid keeps running after a restart"
        );
    }

    #[test]
    fn a_different_uid_signing_in_later_is_paused_again() {
        let dir = data_dir("other");
        let mut a = Account::new(cfg(&server()), &dir, Box::new(Memory::default()));
        a.signed_in(session("u1", 3600));
        a.set_paused(false);
        assert!(a.should_run());
        a.sign_out(|| {});
        a.signed_in(session("u2", 3600));
        assert!(a.settings.paused);
        assert!(!a.should_run());
        // And the first uid, signing back in, is still confirmed? No: only one
        // uid is confirmed at a time, so it asks again.
        a.set_paused(false);
        a.sign_out(|| {});
        a.signed_in(session("u1", 3600));
        assert!(a.settings.paused);
    }

    #[test]
    fn sign_out_stops_then_deletes_the_token_then_the_credential() {
        let dir = data_dir("out");
        let mem = Memory::default();
        let mut a = Account::new(cfg(&server()), &dir, Box::new(mem.clone()));
        a.signed_in(session("u1", 3600));
        a.set_paused(false);
        let seen_by_stop = Mutex::new(None);
        a.sign_out(|| {
            // At the moment the watcher is stopped, the token and the stored
            // credential must both still exist.
            *seen_by_stop.lock().unwrap() = Some((dir.join("token").exists(), mem.get().is_some()));
        });
        assert_eq!(*seen_by_stop.lock().unwrap(), Some((true, true)));
        assert!(!dir.join("token").exists());
        assert!(mem.get().is_none());
        assert!(a.session.is_none() && !a.should_run());
    }

    #[test]
    fn a_failed_refresh_deletes_the_token_and_asks_to_sign_in_again() {
        let dir = data_dir("lost");
        let mem = Memory::default();
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                (200, r#"{"ownerKey":"botkin"}"#.into())
            } else {
                (400, r#"{"error":{"message":"TOKEN_EXPIRED"}}"#.into())
            }
        });
        let mut a = Account::new(cfg(&base), &dir, Box::new(mem.clone()));
        a.signed_in(session("u1", 3600));
        a.set_paused(false);
        // The token is about to run out, and Firebase refuses the refresh.
        a.session = Some(session("u1", 60));
        a.maintain();
        assert!(a.session.is_none());
        assert!(
            !dir.join("token").exists(),
            "no token may be left to upload with"
        );
        assert!(mem.get().is_none());
        assert!(a
            .message
            .as_deref()
            .unwrap_or("")
            .starts_with("Sign in again"));
        assert!(!a.should_run());
    }

    #[test]
    fn a_token_near_its_end_is_renewed_and_the_file_replaced() {
        let dir = data_dir("renew");
        let mut a = Account::new(cfg(&server()), &dir, Box::new(Memory::default()));
        a.signed_in(session("u1", 3600));
        a.set_paused(false);
        a.session = Some(session("u1", 120));
        a.maintain();
        assert_eq!(a.session.as_ref().unwrap().id_token, "ID-REFRESHED");
        assert_eq!(
            std::fs::read_to_string(dir.join("token")).unwrap(),
            "ID-REFRESHED"
        );
        // A token with plenty left is left alone.
        a.maintain();
        assert_eq!(a.session.as_ref().unwrap().id_token, "ID-REFRESHED");
    }

    #[test]
    fn nothing_stored_means_signed_out_without_a_message() {
        let dir = data_dir("none");
        let mut a = Account::new(cfg(&server()), &dir, Box::new(Memory::default()));
        a.restore();
        assert!(a.session.is_none() && a.message.is_none() && !a.should_run());
        assert!(!dir.join("token").exists());
    }
}
