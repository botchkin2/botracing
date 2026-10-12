// What the tray menu says. Pure, so each state is tested.
//
// The top item is the way in: signed out it is "Sign in" (a click opens the
// browser sign-in), while one is in progress it says so, and signed in it
// names the account. Then one line per sim, a problems line only when
// something is wrong, an update item only while one is waiting, and the few
// actions. Nothing else: the settings that used to be here are fixed.
use crate::account::Account;
use crate::status::Upload;

/// The top menu item: its text, and whether it can be clicked.
pub fn primary(acct: &Account) -> (String, bool) {
    match &acct.session {
        Some(s) => (format!("Signed in as {}", s.email), false),
        None if acct.signing_in => ("Signing in… finish in your browser".into(), false),
        None => ("Sign in".into(), true),
    }
}

/// What a sim's recorder is doing, read from the line its recorder prints
/// (`capture::runner::line`, `ir_recorder::line`; the tests bind to both).
#[derive(Clone, Debug, PartialEq)]
pub enum Rec {
    Recording,
    /// Waiting for the game, starting, or switched off: nothing is wrong.
    Idle,
    /// The recorder cannot record; the words, no advice.
    Problem(String),
}

pub fn rec_of(line: &str) -> Rec {
    let text = line
        .strip_prefix("Recorder: ")
        .or_else(|| line.strip_prefix("iRacing: "))
        .unwrap_or(line);
    if text.starts_with("Recording") {
        return Rec::Recording;
    }
    if text.starts_with("Waiting") || matches!(text, "starting" | "off") {
        return Rec::Idle;
    }
    let mut chars = text.chars();
    let first = chars.next().map(|c| c.to_uppercase().collect::<String>());
    Rec::Problem(first.unwrap_or_default() + chars.as_str())
}

/// One sim's line: what it is doing now. Recording first; else the upload.
pub fn sim_line(label: &str, rec: &Rec, upload: &Upload, uploads_on: bool) -> String {
    let state = match (rec, upload) {
        (Rec::Recording, _) => "Recording".to_string(),
        (Rec::Problem(_), _) => "Not recording".to_string(),
        (Rec::Idle, _) if !uploads_on => "Uploads paused".to_string(),
        (Rec::Idle, Upload::Syncing { done: Some(d), total: Some(t) }) => {
            format!("Uploading {d} of {t}")
        }
        (Rec::Idle, Upload::Syncing { .. }) => "Uploading".to_string(),
        (Rec::Idle, Upload::Queued(n)) => format!("{n} to upload"),
        (Rec::Idle, Upload::InGame) => "Waiting for the game to close".to_string(),
        (Rec::Idle, Upload::Retrying) => "Upload will retry".to_string(),
        (Rec::Idle, Upload::Error(_)) => "Upload failed".to_string(),
        (Rec::Idle, Upload::Starting) => "Starting…".to_string(),
        (Rec::Idle, Upload::Idle) => "Up to date".to_string(),
    };
    format!("{label}: {state}")
}

/// What is wrong, worst first. Each is a few words and no advice.
pub struct Inputs<'a> {
    pub signed_in: bool,
    /// A stored sign-in exists but has not been continued yet (offline).
    pub has_stored: bool,
    /// The build lacks something sign-in needs.
    pub config_missing: Option<String>,
    /// The account's own message (a failed sign-in, an update that failed...).
    pub message: Option<&'a str>,
    /// Uploads go to another account than the one signed in.
    pub another_account: bool,
    pub supervisor_problem: Option<&'a str>,
    pub upload: &'a Upload,
    pub lmu: &'a Rec,
    pub iracing: &'a Rec,
    /// Sims whose cleanup waits on an upload that keeps failing.
    pub cleanup_blocked: &'a [String],
}

pub fn problems(i: &Inputs) -> Vec<String> {
    let mut out = Vec::new();
    if !i.signed_in {
        if i.has_stored {
            out.push(i.message.map_or_else(|| "Signing back in…".into(), str::to_string));
        } else if let Some(reason) = &i.config_missing {
            out.push(format!("Can't sign in: {reason}"));
        } else {
            out.push(match i.message {
                Some(m) => format!("Not signed in: uploads paused. {m}"),
                None => "Not signed in: uploads paused".into(),
            });
        }
        return finish(out, i);
    }
    if let Some(m) = i.message {
        out.push(m.to_string());
    }
    if i.another_account {
        out.push("Uploads go to another account".into());
    }
    if let Some(p) = i.supervisor_problem {
        out.push(p.to_string());
    }
    if let Upload::Error(m) = i.upload {
        out.push(format!("Upload error: {m}"));
    }
    finish(out, i)
}

fn finish(mut out: Vec<String>, i: &Inputs) -> Vec<String> {
    for (label, rec) in [("LMU", i.lmu), ("iRacing", i.iracing)] {
        if let Rec::Problem(why) = rec {
            out.push(format!("{label}: {why}"));
        }
    }
    if !i.cleanup_blocked.is_empty() {
        out.push("Cleanup is waiting on failing uploads".into());
    }
    out
}

/// The problems as the one line the menu shows: the worst, then how many more.
pub fn problem_line(list: &[String]) -> Option<String> {
    let first = list.first()?;
    Some(match list.len() {
        1 => first.clone(),
        n => format!("{first} (+{})", n - 1),
    })
}

/// The menu as data. The live tray is built from `menu_items_for` and updated
/// from it, so a test of this list covers what ships.
#[derive(Clone, Debug, PartialEq)]
pub struct MenuState {
    pub primary: (String, bool),
    pub signed_in: bool,
    pub paused: bool,
    pub lmu: String,
    pub iracing: String,
    /// Shown only when something is wrong.
    pub problem: Option<String>,
    /// "Restart to update to x", only while an update is waiting.
    pub update: Option<String>,
    /// "BotRacing 0.1.x", always last and disabled.
    pub version: String,
}

impl MenuState {
    /// The state before the first poll: signed out, starting up.
    pub fn initial(version: &str) -> MenuState {
        MenuState {
            primary: ("Sign in".into(), true),
            signed_in: false,
            paused: false,
            lmu: "LMU: Starting…".into(),
            iracing: "iRacing: Starting…".into(),
            problem: None,
            update: None,
            version: format!("BotRacing {version}"),
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
    Item {
        id,
        text: text.into(),
        enabled,
        checked: None,
    }
}

/// The ids that come and go with the state; every other item is always there.
pub const OPTIONAL: [&str; 2] = ["problem", "update"];

/// The tray menu's items in order.
pub fn menu_items_for(state: &MenuState) -> Vec<Item> {
    let mut items = vec![
        item("signin", state.primary.0.clone(), state.primary.1),
        item("lmu", state.lmu.clone(), false),
        item("iracing", state.iracing.clone(), false),
    ];
    if let Some(problem) = &state.problem {
        items.push(item("problem", problem.clone(), false));
    }
    if let Some(update) = &state.update {
        items.push(item("update", update.clone(), true));
    }
    items.push(item("separator", "", false));
    items.push(item("open", "Open BotRacing", true));
    items.push(Item {
        id: "pause",
        text: "Pause uploads".into(),
        enabled: true,
        checked: Some(state.paused),
    });
    items.push(item("signout", "Sign out", state.signed_in));
    items.push(item("quit", "Quit", true));
    items.push(item("version", state.version.clone(), false));
    items
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

    fn state() -> MenuState {
        MenuState {
            primary: ("Signed in as a@b.c".into(), false),
            signed_in: true,
            paused: false,
            lmu: "LMU: Up to date".into(),
            iracing: "iRacing: Up to date".into(),
            problem: None,
            update: None,
            version: "BotRacing 0.1.3".into(),
        }
    }

    fn ids(items: &[Item]) -> Vec<&'static str> {
        items.iter().map(|i| i.id).collect()
    }

    fn texts(items: &[Item]) -> Vec<String> {
        items.iter().map(|i| i.text.clone()).collect()
    }

    #[test]
    fn signed_out_the_menu_is_the_way_in_and_the_few_actions() {
        let mut s = state();
        s.primary = ("Sign in".into(), true);
        s.signed_in = false;
        s.problem = Some("Not signed in: uploads paused".into());
        let items = menu_items_for(&s);
        assert_eq!(
            texts(&items),
            [
                "Sign in",
                "LMU: Up to date",
                "iRacing: Up to date",
                "Not signed in: uploads paused",
                "",
                "Open BotRacing",
                "Pause uploads",
                "Sign out",
                "Quit",
                "BotRacing 0.1.3",
            ]
        );
        let get = |id: &str| items.iter().find(|i| i.id == id).unwrap().clone();
        assert!(get("signin").enabled);
        assert!(!get("signout").enabled, "nothing to sign out of");
        assert!(!get("problem").enabled && !get("version").enabled);
    }

    #[test]
    fn recording_signed_in_has_no_problem_and_no_update_item() {
        let mut s = state();
        s.lmu = "LMU: Recording".into();
        let items = menu_items_for(&s);
        assert_eq!(
            ids(&items),
            [
                "signin", "lmu", "iracing", "separator", "open", "pause", "signout", "quit",
                "version"
            ]
        );
        assert_eq!(items[1].text, "LMU: Recording");
        let get = |id: &str| items.iter().find(|i| i.id == id).unwrap().clone();
        assert!(get("signout").enabled);
        assert_eq!(get("pause").checked, Some(false));
    }

    #[test]
    fn a_waiting_update_is_one_clickable_item_above_the_separator() {
        let mut s = state();
        s.update = Some("Restart to update to 0.1.4".into());
        let items = menu_items_for(&s);
        assert_eq!(
            ids(&items),
            [
                "signin", "lmu", "iracing", "update", "separator", "open", "pause", "signout",
                "quit", "version"
            ]
        );
        let update = items.iter().find(|i| i.id == "update").unwrap();
        assert!(update.enabled);
        assert_eq!(update.text, "Restart to update to 0.1.4");
    }

    #[test]
    fn a_problem_and_an_update_together_keep_the_problem_first() {
        let mut s = state();
        s.problem = Some("Disk full".into());
        s.update = Some("Restart to update to 0.1.4".into());
        s.paused = true;
        let items = menu_items_for(&s);
        assert_eq!(
            ids(&items),
            [
                "signin", "lmu", "iracing", "problem", "update", "separator", "open", "pause",
                "signout", "quit", "version"
            ]
        );
        assert_eq!(
            items.iter().find(|i| i.id == "pause").unwrap().checked,
            Some(true)
        );
    }

    #[test]
    fn nothing_of_the_removed_settings_is_in_the_menu() {
        let mut s = state();
        s.problem = Some("x".into());
        s.update = Some("y".into());
        let all = ids(&menu_items_for(&s));
        for gone in [
            "autostart",
            "older",
            "folder",
            "recorder",
            "status",
            "cleanup-status",
            "cleanup-lmu",
            "cleanup-iracing",
            "cleanup-keep",
            "cleanup-cap",
        ] {
            assert!(!all.contains(&gone), "{gone} is back");
        }
        for id in OPTIONAL {
            assert!(all.contains(&id));
        }
    }

    #[test]
    fn the_recorders_own_words_are_read_the_same_way() {
        use crate::capture::runner::{line, Line};
        assert_eq!(rec_of(&line(&Line::Starting)), Rec::Idle);
        assert_eq!(rec_of("Recorder: off"), Rec::Idle);
        assert_eq!(rec_of("iRacing: off"), Rec::Idle);
        assert_eq!(rec_of("Waiting for LMU"), Rec::Idle);
        assert_eq!(rec_of("Recording"), Rec::Recording);
        assert_eq!(rec_of("Recording (3% dropped)"), Rec::Recording);
        assert_eq!(rec_of("iRacing: Recording"), Rec::Recording);
        assert_eq!(rec_of("Waiting for iRacing"), Rec::Idle);
        assert_eq!(
            rec_of(&line(&Line::Another)),
            Rec::Problem("Another recorder is running".into())
        );
        assert_eq!(
            rec_of("Recorder: disk full"),
            Rec::Problem("Disk full".into())
        );
        assert_eq!(
            rec_of("iRacing: disk full"),
            Rec::Problem("Disk full".into())
        );
    }

    #[test]
    fn a_sim_line_says_what_that_sim_is_doing_now() {
        let idle = Rec::Idle;
        let up = |u: &Upload| sim_line("LMU", &idle, u, true);
        assert_eq!(
            sim_line("LMU", &Rec::Recording, &Upload::Idle, true),
            "LMU: Recording"
        );
        assert_eq!(up(&Upload::Idle), "LMU: Up to date");
        assert_eq!(up(&Upload::Queued(2)), "LMU: 2 to upload");
        assert_eq!(
            up(&Upload::Syncing {
                done: Some(2),
                total: Some(5)
            }),
            "LMU: Uploading 2 of 5"
        );
        assert_eq!(
            up(&Upload::Syncing {
                done: None,
                total: None
            }),
            "LMU: Uploading"
        );
        assert_eq!(up(&Upload::Error("x".into())), "LMU: Upload failed");
        assert_eq!(
            sim_line(
                "iRacing",
                &Rec::Problem("Disk full".into()),
                &Upload::Idle,
                true
            ),
            "iRacing: Not recording"
        );
        assert_eq!(
            sim_line("LMU", &idle, &Upload::Idle, false),
            "LMU: Uploads paused"
        );
    }

    fn inputs<'a>(upload: &'a Upload, rec: &'a Rec, blocked: &'a [String]) -> Inputs<'a> {
        Inputs {
            signed_in: true,
            has_stored: false,
            config_missing: None,
            message: None,
            another_account: false,
            supervisor_problem: None,
            upload,
            lmu: rec,
            iracing: rec,
            cleanup_blocked: blocked,
        }
    }

    #[test]
    fn a_healthy_tray_has_no_problems() {
        let (up, rec) = (Upload::Idle, Rec::Idle);
        assert!(problems(&inputs(&up, &rec, &[])).is_empty());
        assert_eq!(problem_line(&[]), None);
    }

    #[test]
    fn signed_out_is_one_problem_whatever_else_is_true() {
        let (up, rec) = (Upload::Error("x".into()), Rec::Problem("Disk full".into()));
        let mut i = inputs(&up, &rec, &[]);
        i.signed_in = false;
        assert_eq!(problems(&i)[0], "Not signed in: uploads paused");
        i.message = Some("Sign-in failed: no answer from the browser (timed out)");
        assert_eq!(
            problems(&i)[0],
            "Not signed in: uploads paused. Sign-in failed: no answer from the browser (timed out)"
        );
        i.has_stored = true;
        i.message = None;
        assert_eq!(problems(&i)[0], "Signing back in…");
        i.has_stored = false;
        i.config_missing = Some("built without the Firebase web key".into());
        assert_eq!(
            problems(&i)[0],
            "Can't sign in: built without the Firebase web key"
        );
    }

    #[test]
    fn several_problems_show_the_worst_and_a_count() {
        let up = Upload::Error("sync crashed".into());
        let rec = Rec::Problem("Another recorder is running".into());
        let blocked = vec!["lmu".to_string()];
        let mut i = inputs(&up, &rec, &blocked);
        i.supervisor_problem = Some("Uploader stopped (exit code: 1), restarting");
        i.another_account = true;
        let list = problems(&i);
        assert_eq!(
            list,
            [
                "Uploads go to another account",
                "Uploader stopped (exit code: 1), restarting",
                "Upload error: sync crashed",
                "LMU: Another recorder is running",
                "iRacing: Another recorder is running",
                "Cleanup is waiting on failing uploads",
            ]
        );
        assert_eq!(
            problem_line(&list).as_deref(),
            Some("Uploads go to another account (+5)")
        );
        assert_eq!(
            problem_line(&list[..1]).as_deref(),
            Some("Uploads go to another account")
        );
    }

    #[test]
    fn the_initial_menu_is_signed_out_and_starting_with_the_version_last() {
        let items = menu_items_for(&MenuState::initial("0.1.3"));
        assert_eq!(items.first().unwrap().text, "Sign in");
        assert_eq!(items.last().unwrap().text, "BotRacing 0.1.3");
        assert!(!ids(&items).contains(&"problem"));
    }
}
