// Who is signed in, whether uploads are allowed, and the files that follow
// from it. The refresh token lives in Windows Credential Manager; the ID token
// goes to the `token` file the watcher reads on every request (so it never
// outlives a sign-out); settings.json holds only what is not secret.
//
// Rules (pit wall thread 2, marshal #58, #77 and #85):
// - the first sign-in of a uid starts Paused: until a person un-pauses it, the
//   watcher does not run, so nothing is uploaded under a uid whose owner key
//   has not been checked. Un-pausing is what confirms that uid, and it is
//   refused until the owner key is known.
// - a different uid signing in later is paused again.
// - only a definitive refusal from Firebase ends a sign-in (the token file and
//   the credential go, the user must sign in again). A dropped connection or a
//   5xx keeps both and tries again; an expired token does not upload.
// - sign-out stops the watcher, deletes the token file, then removes the
//   stored credential, in that order.
// - the account lock is never held across a network call: `plan` decides what
//   to do under the lock, `run` does it without, `apply` records the result.
use crate::auth::{self, Config, RefreshError, Session};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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
        keyring::Entry::new(&crate::profile::keyring_service(), "account")
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
    /// Start with Windows: `None` until the first launch records it (on).
    pub start_with_windows: Option<bool>,
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
            start_with_windows: value["startWithWindows"].as_bool(),
        }
    }

    /// Written whole to a neighbour file and renamed over, so a crash never
    /// leaves half a settings file (which would read as "not paused").
    fn save(&self, file: &Path) {
        let value = json!({
            "paused": self.paused,
            "confirmedUid": self.confirmed_uid,
            "startWithWindows": self.start_with_windows,
        });
        let tmp = file.with_extension("json.tmp");
        if std::fs::write(&tmp, value.to_string()).is_ok() {
            let _ = std::fs::rename(&tmp, file);
        }
    }
}

/// How soon before its end an ID token is replaced.
const REFRESH_MARGIN: Duration = Duration::from_secs(10 * 60);
/// How often the owner key is read again.
const OWNER_EVERY: Duration = Duration::from_secs(5 * 60);
/// How long to wait after a network failure before trying again.
const RETRY_AFTER: Duration = Duration::from_secs(30);

/// A stored sign-in not yet continued with a fresh token.
#[derive(Clone)]
struct Stored {
    uid: String,
    email: String,
    refresh: String,
}

/// What `plan` found to do. The network part (`run`) needs no lock.
pub enum Work {
    Restore(Session),
    Refresh(Session),
    Owner(String),
}

pub enum Done {
    Restore(Result<Session, RefreshError>),
    Refresh(Result<Session, RefreshError>),
    Owner(Result<String, String>),
}

/// The network step of a piece of work.
pub fn run(cfg: &Config, work: Work) -> Done {
    match work {
        Work::Restore(old) => Done::Restore(auth::refresh(cfg, &old)),
        Work::Refresh(old) => Done::Refresh(auth::refresh(cfg, &old)),
        Work::Owner(id_token) => Done::Owner(auth::owner_key(cfg, &id_token)),
    }
}

/// Does everything due, taking the lock only between network calls.
pub fn maintain(account: &Mutex<Account>) {
    let cfg = account.lock().unwrap().cfg.clone();
    loop {
        let Some(work) = account.lock().unwrap().plan() else {
            return;
        };
        let done = run(&cfg, work);
        account.lock().unwrap().apply(done);
    }
}

pub struct Account {
    cfg: Config,
    data: PathBuf,
    secrets: Box<dyn SecretStore>,
    pub session: Option<Session>,
    pub owner_key: Option<String>,
    /// Why the owner key is not known, for the menu.
    pub owner_error: Option<String>,
    owner_checked: Option<SystemTime>,
    stored: Option<Stored>,
    retry_after: Option<SystemTime>,
    pub settings: Settings,
    /// Shown instead of the status while set ("Sign in again", an error).
    pub message: Option<String>,
    pub signing_in: bool,
    /// The browser sign-in has been opened by the tray itself this launch.
    prompted: bool,
}

impl Account {
    /// Reads the settings and the stored sign-in; nothing goes over the
    /// network until `plan` and `run`.
    pub fn new(cfg: Config, data: &Path, secrets: Box<dyn SecretStore>) -> Account {
        let _ = std::fs::create_dir_all(data);
        let settings = Settings::load(&data.join("settings.json"));
        let stored = secrets.get().and_then(|text| {
            let value: Value = serde_json::from_str(&text).ok()?;
            Some(Stored {
                uid: value["uid"].as_str()?.to_string(),
                email: value["email"].as_str().unwrap_or_default().to_string(),
                refresh: value["refresh"].as_str()?.to_string(),
            })
        });
        Account {
            cfg,
            data: data.to_path_buf(),
            secrets,
            session: None,
            owner_key: None,
            owner_error: None,
            owner_checked: None,
            stored,
            retry_after: None,
            settings,
            message: None,
            signing_in: false,
            prompted: false,
        }
    }

    /// Signed out for good: no session, nothing stored to continue, and no
    /// sign-in under way. (A stored sign-in that is only waiting for the
    /// network is not this.)
    pub fn needs_sign_in(&self) -> bool {
        self.session.is_none() && self.stored.is_none() && !self.signing_in
    }

    /// A stored sign-in exists that has not been continued yet.
    pub fn has_stored(&self) -> bool {
        self.stored.is_some()
    }

    /// True once per launch, when the tray should open the browser sign-in by
    /// itself: the user is signed out for good and this build can sign in. A
    /// click on the menu opens it any time; this is only the automatic one, so
    /// a tray that starts at logon does not keep throwing browser tabs at
    /// someone who closed the first (thread 2 #180).
    pub fn take_prompt(&mut self) -> bool {
        if self.prompted || !self.needs_sign_in() || self.cfg.missing().is_some() {
            return false;
        }
        self.prompted = true;
        true
    }

    /// Starts a browser sign-in: the config to use, or None when one is under
    /// way or the tray is signed in. The only way in, so two clicks, a click
    /// and the launch prompt, or a click and a second launch can never open two
    /// browser pages.
    pub fn begin_sign_in(&mut self) -> Option<Config> {
        if self.signing_in || self.session.is_some() {
            return None;
        }
        self.signing_in = true;
        self.message = None;
        Some(self.cfg.clone())
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

    /// Uploads are allowed: signed in with a token that has not run out, and
    /// not paused. (An expired token cannot upload; it would only fail.)
    pub fn should_run(&self) -> bool {
        !self.settings.paused
            && self
                .session
                .as_ref()
                .is_some_and(|s| s.expires_at > SystemTime::now())
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

    /// A completed sign-in: keep it, write the token, and pause when this uid
    /// has not been confirmed. The owner key is read by the next `plan`.
    pub fn signed_in(&mut self, session: Session) {
        self.store_refresh(&session);
        self.write_token(&session);
        if self.settings.confirmed_uid.as_deref() != Some(&session.uid) {
            self.settings.paused = true;
            self.settings.save(&self.settings_file());
        }
        self.session = Some(session);
        self.stored = None;
        self.message = None;
        self.owner_key = None;
        self.owner_checked = None;
        self.retry_after = None;
    }

    /// The next thing to do over the network, if anything is due.
    pub fn plan(&mut self) -> Option<Work> {
        if self.retry_after.is_some_and(|at| SystemTime::now() < at) {
            return None;
        }
        if let Some(stored) = &self.stored {
            return Some(Work::Restore(Session {
                id_token: String::new(),
                refresh_token: stored.refresh.clone(),
                uid: stored.uid.clone(),
                email: stored.email.clone(),
                expires_at: SystemTime::now(),
            }));
        }
        let session = self.session.as_ref()?;
        if session.expires_within(REFRESH_MARGIN) {
            return Some(Work::Refresh(session.clone()));
        }
        let due = self
            .owner_checked
            .and_then(|at| at.elapsed().ok())
            .is_none_or(|age| age > OWNER_EVERY);
        // Stamped now so a slow answer is not asked for twice.
        let id_token = session.id_token.clone();
        if due {
            self.owner_checked = Some(SystemTime::now());
            return Some(Work::Owner(id_token));
        }
        None
    }

    pub fn apply(&mut self, done: Done) {
        match done {
            Done::Restore(Ok(session)) | Done::Refresh(Ok(session)) => {
                self.store_refresh(&session);
                self.write_token(&session);
                let uid_changed = self.session.as_ref().is_some_and(|s| s.uid != session.uid);
                if self.session.is_none() || uid_changed {
                    self.owner_checked = None;
                }
                self.session = Some(session);
                self.stored = None;
                self.retry_after = None;
                self.message = None;
            }
            Done::Restore(Err(RefreshError::Rejected(why)))
            | Done::Refresh(Err(RefreshError::Rejected(why))) => self.sign_in_lost(&why),
            Done::Restore(Err(RefreshError::Transient(why)))
            | Done::Refresh(Err(RefreshError::Transient(why))) => {
                // The network failed. Nothing says the credential is bad: keep
                // it and try again.
                self.retry_after = Some(SystemTime::now() + RETRY_AFTER);
                self.message = Some(format!("Offline, will retry ({why})"));
            }
            Done::Restore(Err(RefreshError::Service(why)))
            | Done::Refresh(Err(RefreshError::Service(why))) => {
                // Firebase answered with something that does not end a
                // sign-in (a wrong web key, a 5xx, a 429): kept the same way,
                // but "offline" would be the wrong thing to tell the user.
                self.retry_after = Some(SystemTime::now() + RETRY_AFTER);
                self.message = Some(format!("Sign-in service problem, will retry ({why})"));
            }
            Done::Owner(Ok(key)) => {
                self.owner_key = Some(key);
                self.owner_error = None;
                self.confirm_own_account();
            }
            Done::Owner(Err(e)) => {
                self.owner_key = None;
                eprintln!("could not read the owner key: {e}");
                self.owner_error = Some(e);
            }
        }
    }

    /// The first sign-in pauses until the owner is known. When the owner is
    /// the signed-in uid (the person's own account), it is confirmed here and
    /// the uploads start without a word; another owner keeps the pause.
    fn confirm_own_account(&mut self) {
        let Some(session) = &self.session else { return };
        // Only once per uid: a pause the person set after confirming stays put.
        let unconfirmed = self.settings.confirmed_uid.as_deref() != Some(session.uid.as_str());
        if unconfirmed
            && self.settings.paused
            && self.owner_key.as_deref() == Some(session.uid.as_str())
        {
            self.settings.paused = false;
            self.settings.confirmed_uid = Some(session.uid.clone());
            self.settings.save(&self.settings_file());
        }
    }

    /// Firebase refused the sign-in for good: remove what would let the
    /// watcher upload.
    fn sign_in_lost(&mut self, why: &str) {
        let _ = std::fs::remove_file(self.token_file());
        self.secrets.delete();
        self.session = None;
        self.stored = None;
        self.owner_key = None;
        self.retry_after = None;
        self.message = Some(format!("Sign in again ({why})"));
    }

    /// A person's choice. Un-pausing confirms the signed-in uid, and is
    /// refused (an Err with a sentence) while the owner key is not known:
    /// confirming means having seen the owner.
    pub fn set_paused(&mut self, paused: bool) -> Result<(), String> {
        if !paused && self.unconfirmed() && self.owner_key.is_none() {
            return Err(match &self.owner_error {
                Some(why) => format!("Can't un-pause: the owner key is not known ({why})"),
                None => "Can't un-pause: the owner key is not known yet".into(),
            });
        }
        self.settings.paused = paused;
        if !paused {
            if let Some(session) = &self.session {
                self.settings.confirmed_uid = Some(session.uid.clone());
            }
        }
        self.settings.save(&self.settings_file());
        Ok(())
    }

    /// Records the Start with Windows choice (the Run value itself is
    /// `autostart`'s).
    pub fn record_start_with_windows(&mut self, on: bool) {
        self.settings.start_with_windows = Some(on);
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
        self.stored = None;
        self.owner_key = None;
        self.owner_checked = None;
        self.retry_after = None;
        self.message = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::test_support::*;
    use std::sync::Arc;
    use std::time::Instant;

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

    const REFRESHED: &str = r#"{"id_token":"ID-REFRESHED","refresh_token":"REF-NEW","user_id":"u1","expires_in":"3600"}"#;

    // /me answers with an owner key; the refresh endpoint with a new token.
    fn server() -> String {
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                (200, r#"{"ownerKey":"botkin"}"#.into())
            } else {
                (200, REFRESHED.into())
            }
        });
        base
    }

    fn account(base: &str, dir: &Path, mem: &Memory) -> Mutex<Account> {
        Mutex::new(Account::new(cfg(base), dir, Box::new(mem.clone())))
    }

    #[test]
    fn the_owners_own_sign_in_starts_unpaused_and_says_nothing() {
        let dir = data_dir("own");
        let mem = Memory::default();
        let a = account(&server(), &dir, &mem);
        a.lock().unwrap().signed_in(session("botkin", 3600));
        maintain(&a);
        let acct = a.lock().unwrap();
        assert_eq!(acct.owner_key.as_deref(), Some("botkin"));
        assert!(
            !acct.settings.paused && acct.should_run(),
            "own account runs unpaused"
        );
        assert!(!acct.unconfirmed());
    }

    #[test]
    fn a_pause_the_person_sets_after_confirming_survives_the_next_owner_read() {
        let dir = data_dir("repause");
        let mem = Memory::default();
        let a = account(&server(), &dir, &mem);
        a.lock().unwrap().signed_in(session("botkin", 3600));
        maintain(&a);
        {
            let mut acct = a.lock().unwrap();
            assert!(
                !acct.settings.paused,
                "own account confirmed at the first read"
            );
            acct.set_paused(true).unwrap();
        }
        maintain(&a);
        assert!(
            a.lock().unwrap().settings.paused,
            "the owner read must not undo a pause"
        );
    }

    #[test]
    fn the_first_sign_in_is_paused_and_unpausing_confirms_the_uid() {
        let dir = data_dir("first");
        let mem = Memory::default();
        let a = account(&server(), &dir, &mem);
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        let mut acct = a.lock().unwrap();
        assert!(acct.settings.paused, "first sign-in must start paused");
        assert!(acct.unconfirmed() && !acct.should_run());
        assert_eq!(acct.owner_key.as_deref(), Some("botkin"));
        assert_eq!(std::fs::read_to_string(dir.join("token")).unwrap(), "ID-u1");

        acct.set_paused(false).unwrap();
        assert!(acct.should_run() && !acct.unconfirmed());
        drop(acct);

        // A restart keeps the choice and the sign-in.
        let b = account(&server(), &dir, &mem);
        maintain(&b);
        let acct = b.lock().unwrap();
        assert_eq!(acct.session.as_ref().map(|s| s.uid.as_str()), Some("u1"));
        assert!(
            acct.should_run(),
            "a confirmed uid keeps running after a restart"
        );
    }

    #[test]
    fn unpausing_is_refused_until_the_owner_key_is_known() {
        let dir = data_dir("noowner");
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                (500, r#"{"error":{"message":"down"}}"#.into())
            } else {
                (200, REFRESHED.into())
            }
        });
        let a = account(&base, &dir, &Memory::default());
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        let mut acct = a.lock().unwrap();
        assert!(acct.owner_key.is_none());
        let err = acct.set_paused(false).unwrap_err();
        assert!(err.contains("owner key is not known"), "{err}");
        assert!(err.contains("500"), "the reason is in the message: {err}");
        assert!(acct.owner_error.is_some());
        assert!(acct.settings.paused, "still paused");
        assert_eq!(acct.settings.confirmed_uid, None, "nothing confirmed");
        assert!(!acct.should_run());
    }

    #[test]
    fn a_page_instead_of_json_shows_the_real_reason_for_the_unknown_owner() {
        let dir = data_dir("html");
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                (200, "<!doctype html>".into())
            } else {
                (200, REFRESHED.into())
            }
        });
        let a = account(&base, &dir, &Memory::default());
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        let acct = a.lock().unwrap();
        assert!(acct.owner_key.is_none());
        let why = acct.owner_error.clone().unwrap_or_default();
        assert!(
            why.starts_with("unexpected answer from the server"),
            "{why}"
        );
    }

    #[test]
    fn a_different_uid_signing_in_later_is_paused_again() {
        let dir = data_dir("other");
        let a = account(&server(), &dir, &Memory::default());
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        a.lock().unwrap().set_paused(false).unwrap();
        assert!(a.lock().unwrap().should_run());
        a.lock().unwrap().sign_out(|| {});
        a.lock().unwrap().signed_in(session("u2", 3600));
        maintain(&a);
        assert!(a.lock().unwrap().settings.paused);
        assert!(!a.lock().unwrap().should_run());
        // Only one uid is confirmed at a time: the first asks again.
        a.lock().unwrap().set_paused(false).unwrap();
        a.lock().unwrap().sign_out(|| {});
        a.lock().unwrap().signed_in(session("u1", 3600));
        assert!(a.lock().unwrap().settings.paused);
    }

    #[test]
    fn sign_out_stops_then_deletes_the_token_then_the_credential() {
        let dir = data_dir("out");
        let mem = Memory::default();
        let a = account(&server(), &dir, &mem);
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        a.lock().unwrap().set_paused(false).unwrap();
        let seen_by_stop = Mutex::new(None);
        a.lock().unwrap().sign_out(|| {
            // When the watcher is stopped, the token and the stored
            // credential must both still exist.
            *seen_by_stop.lock().unwrap() = Some((dir.join("token").exists(), mem.get().is_some()));
        });
        assert_eq!(*seen_by_stop.lock().unwrap(), Some((true, true)));
        assert!(!dir.join("token").exists());
        assert!(mem.get().is_none());
        let acct = a.lock().unwrap();
        assert!(acct.session.is_none() && !acct.should_run());
    }

    #[test]
    fn a_refusal_from_firebase_ends_the_sign_in() {
        let dir = data_dir("lost");
        let mem = Memory::default();
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                (200, r#"{"ownerKey":"botkin"}"#.into())
            } else {
                (400, r#"{"error":{"message":"TOKEN_EXPIRED"}}"#.into())
            }
        });
        let a = account(&base, &dir, &mem);
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        a.lock().unwrap().set_paused(false).unwrap();
        // The token is about to run out, and Firebase refuses the refresh.
        a.lock().unwrap().session = Some(session("u1", 60));
        maintain(&a);
        let acct = a.lock().unwrap();
        assert!(acct.session.is_none());
        assert!(
            !dir.join("token").exists(),
            "no token may be left to upload with"
        );
        assert!(mem.get().is_none(), "the credential goes with it");
        let message = acct.message.clone().unwrap_or_default();
        assert!(
            message.starts_with("Sign in again") && message.contains("TOKEN_EXPIRED"),
            "{message}"
        );
        assert!(!acct.should_run());
    }

    #[test]
    fn a_server_error_or_no_network_keeps_the_sign_in_and_tries_again() {
        for (name, base, says) in [
            (
                "5xx",
                stub(|_, _| (503, r#"{"error":{"message":"unavailable"}}"#.into())).0,
                // The service answered: not "offline".
                "Sign-in service problem, will retry",
            ),
            // Nothing listens here: a refused connection.
            (
                "offline",
                "http://127.0.0.1:9".to_string(),
                "Offline, will retry",
            ),
        ] {
            let dir = data_dir(&format!("transient-{name}"));
            let mem = Memory::default();
            // A stored sign-in from an earlier run, restored at start.
            mem.set(r#"{"uid":"u1","email":"u1@x.y","refresh":"REF-u1"}"#)
                .unwrap();
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("token"), "OLD-TOKEN").unwrap();
            let a = account(&base, &dir, &mem);
            maintain(&a);
            let mut acct = a.lock().unwrap();
            assert!(acct.session.is_none(), "{name}: not signed in yet");
            assert!(mem.get().is_some(), "{name}: the credential must be kept");
            let message = acct.message.clone().unwrap_or_default();
            assert!(message.starts_with(says), "{name}: {message}");
            assert!(!acct.should_run(), "{name}");
            assert!(
                acct.plan().is_none(),
                "{name}: no hammering, it waits before retrying"
            );
        }
    }

    #[test]
    fn a_wrong_web_key_keeps_every_stored_sign_in_and_says_why() {
        // A rotated or wrong Firebase web key answers 400 API_KEY_INVALID to
        // every refresh. It must not sign anyone out (marshal #186).
        let dir = data_dir("wrong-key");
        let mem = Memory::default();
        mem.set(r#"{"uid":"u1","email":"u1@x.y","refresh":"REF-u1"}"#)
            .unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("token"), "OLD-TOKEN").unwrap();
        let (base, _) = stub(|_, _| (400, r#"{"error":{"message":"API_KEY_INVALID"}}"#.into()));
        let a = account(&base, &dir, &mem);
        maintain(&a);
        let mut acct = a.lock().unwrap();
        assert!(mem.get().is_some(), "the stored sign-in must survive");
        assert!(dir.join("token").exists(), "and the token file");
        assert!(
            acct.has_stored() && !acct.needs_sign_in(),
            "still waiting, not signed out"
        );
        let message = acct.message.clone().unwrap_or_default();
        assert!(
            message.starts_with("Sign-in service problem, will retry")
                && message.contains("API_KEY_INVALID"),
            "{message}"
        );
        assert!(!acct.take_prompt(), "and no browser is opened");
    }

    #[test]
    fn a_stored_sign_in_is_continued_when_the_network_is_back() {
        let dir = data_dir("back");
        let mem = Memory::default();
        mem.set(r#"{"uid":"u1","email":"u1@x.y","refresh":"REF-u1"}"#)
            .unwrap();
        let a = account(&server(), &dir, &mem);
        maintain(&a);
        let acct = a.lock().unwrap();
        assert_eq!(acct.session.as_ref().unwrap().id_token, "ID-REFRESHED");
        assert_eq!(
            std::fs::read_to_string(dir.join("token")).unwrap(),
            "ID-REFRESHED"
        );
        assert_eq!(acct.owner_key.as_deref(), Some("botkin"));
    }

    #[test]
    fn an_expired_token_does_not_upload_even_when_the_refresh_failed() {
        let dir = data_dir("expired");
        let (base, _) = stub(|_, _| (503, "{}".into()));
        let a = account(&base, &dir, &Memory::default());
        {
            let mut acct = a.lock().unwrap();
            acct.signed_in(session("u1", 3600));
            acct.settings.paused = false;
            acct.session = Some(session("u1", 0));
        }
        std::thread::sleep(Duration::from_millis(20));
        maintain(&a);
        assert!(
            !a.lock().unwrap().should_run(),
            "an expired token must not run the watcher"
        );
    }

    #[test]
    fn a_token_near_its_end_is_renewed_and_the_file_replaced() {
        let dir = data_dir("renew");
        let a = account(&server(), &dir, &Memory::default());
        a.lock().unwrap().signed_in(session("u1", 3600));
        maintain(&a);
        a.lock().unwrap().set_paused(false).unwrap();
        a.lock().unwrap().session = Some(session("u1", 120));
        maintain(&a);
        let acct = a.lock().unwrap();
        assert_eq!(acct.session.as_ref().unwrap().id_token, "ID-REFRESHED");
        assert_eq!(
            std::fs::read_to_string(dir.join("token")).unwrap(),
            "ID-REFRESHED"
        );
    }

    #[test]
    fn nothing_stored_means_signed_out_without_a_message_or_work() {
        let dir = data_dir("none");
        let a = account(&server(), &dir, &Memory::default());
        maintain(&a);
        let mut acct = a.lock().unwrap();
        assert!(acct.session.is_none() && acct.message.is_none() && !acct.should_run());
        assert!(acct.plan().is_none());
        assert!(!dir.join("token").exists());
    }

    #[test]
    fn the_account_lock_is_free_while_a_network_call_is_in_flight() {
        let dir = data_dir("lock");
        let (base, _) = stub(|path, _| {
            if path.contains("/me") {
                std::thread::sleep(Duration::from_millis(1200));
                (200, r#"{"ownerKey":"botkin"}"#.into())
            } else {
                (200, REFRESHED.into())
            }
        });
        let a = Arc::new(account(&base, &dir, &Memory::default()));
        a.lock().unwrap().signed_in(session("u1", 3600));
        let worker = {
            let a = a.clone();
            std::thread::spawn(move || maintain(&a))
        };
        std::thread::sleep(Duration::from_millis(300));
        let started = Instant::now();
        drop(a.lock().unwrap());
        assert!(
            started.elapsed() < Duration::from_millis(400),
            "the lock was held across the network call ({:?})",
            started.elapsed()
        );
        worker.join().unwrap();
        assert_eq!(a.lock().unwrap().owner_key.as_deref(), Some("botkin"));
    }

    #[test]
    fn the_settings_file_is_replaced_whole() {
        let dir = data_dir("settings");
        let a = account(&server(), &dir, &Memory::default());
        a.lock().unwrap().signed_in(session("u1", 3600));
        let text = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["paused"], true);
        assert!(
            !dir.join("settings.json.tmp").exists(),
            "no temp file left behind"
        );
    }

    #[test]
    fn the_browser_sign_in_opens_by_itself_once_per_launch() {
        let dir = data_dir("prompt-once");
        let a = account(&server(), &dir, &Memory::default());
        let mut acct = a.lock().unwrap();
        assert!(acct.take_prompt(), "signed out on launch: open it");
        assert!(!acct.take_prompt(), "not on the next tick");
        // The user closed the tab or it timed out: the failure is shown, the
        // browser is not opened again by itself.
        acct.message = Some("Sign-in failed: no answer from the browser (timed out)".into());
        for _ in 0..5 {
            assert!(!acct.take_prompt());
        }
        // Signing out later in the same launch does not re-open it either.
        acct.signed_in(session("u1", 3600));
        acct.sign_out(|| {});
        assert!(!acct.take_prompt());
    }

    #[test]
    fn a_stored_sign_in_that_is_only_offline_does_not_open_a_browser() {
        let dir = data_dir("prompt-offline");
        let mem = Memory::default();
        mem.set(r#"{"uid":"u1","email":"u1@x.y","refresh":"REF-u1"}"#)
            .unwrap();
        let (base, _) = stub(|_, _| (503, "{}".into()));
        let a = account(&base, &dir, &mem);
        maintain(&a);
        let mut acct = a.lock().unwrap();
        assert!(acct.has_stored() && acct.session.is_none());
        assert!(!acct.needs_sign_in());
        assert!(!acct.take_prompt(), "offline is not signed out");
    }

    #[test]
    fn a_sign_in_the_server_refused_does_open_it_once() {
        let dir = data_dir("prompt-refused");
        let mem = Memory::default();
        mem.set(r#"{"uid":"u1","email":"u1@x.y","refresh":"REF-u1"}"#)
            .unwrap();
        let (base, _) = stub(|_, _| (400, r#"{"error":{"message":"TOKEN_EXPIRED"}}"#.into()));
        let a = account(&base, &dir, &mem);
        maintain(&a);
        let mut acct = a.lock().unwrap();
        assert!(acct.needs_sign_in(), "refused for good: signed out");
        assert!(acct.take_prompt());
        assert!(!acct.take_prompt());
    }

    // Botkin's two tabs on 0.1.1: whatever asks for a sign-in (the launch prompt,
    // a menu click, a second click), only one gets to open a browser page.
    #[test]
    fn only_one_browser_sign_in_can_begin_at_a_time() {
        let dir = data_dir("begin-once");
        let a = account(&server(), &dir, &Memory::default());
        let mut acct = a.lock().unwrap();
        let mut opened = 0;
        for _ in 0..5 {
            if acct.begin_sign_in().is_some() {
                opened += 1;
            }
        }
        assert_eq!(opened, 1, "five asks, one browser page");
        assert!(acct.signing_in);
        // Once it ended (cancelled or timed out), the next ask may begin.
        acct.signing_in = false;
        assert!(acct.begin_sign_in().is_some());
        acct.signing_in = false;
        // Signed in: nothing to begin.
        acct.signed_in(session("u1", 3600));
        assert!(acct.begin_sign_in().is_none());
    }

    #[test]
    fn nothing_opens_while_signed_in_while_signing_in_or_in_a_build_without_the_client() {
        let dir = data_dir("prompt-other");
        let a = account(&server(), &dir, &Memory::default());
        let mut acct = a.lock().unwrap();
        acct.signing_in = true;
        assert!(!acct.take_prompt(), "a sign-in is already under way");
        acct.signing_in = false;
        acct.signed_in(session("u1", 3600));
        assert!(!acct.take_prompt(), "signed in");
        drop(acct);

        let mut cfg_missing = cfg(&server());
        cfg_missing.firebase_key.clear();
        let mut bare = Account::new(
            cfg_missing,
            &data_dir("prompt-missing"),
            Box::new(Memory::default()),
        );
        assert!(bare.needs_sign_in());
        assert!(
            !bare.take_prompt(),
            "a build without the Firebase key cannot sign in; the status says so"
        );
        // The once-per-launch flag was not spent on it.
        assert!(!bare.prompted);
    }
}
