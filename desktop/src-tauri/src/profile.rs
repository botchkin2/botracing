// BOTRACING_PROFILE: a second copy of the tray that shares nothing with the
// real one (apex #189). Walkthroughs of the signed-out first launch, sign-out
// and the like, and the side-by-side seat-test run (docs/TESTING.md), are done
// under a profile without touching a real stored sign-in. Unset (the normal
// case) every name below is what it always was.
//
// A profile has its own data folder (%LOCALAPPDATA%\BotRacing-<profile>), its
// own Credential Manager entry, its own watcher lock, and its own
// single-instance hold (`identifier` below): it runs beside the real tray, is
// held to one copy itself, and `botracing.exe --quit` under the same profile
// stops it. Release builds honour it too (apex #3508), so the installer CI
// ships is the one the e2e signs in: a profile shares no file, lock or sign-in
// with the real tray, and nothing sets the variable except a person or a test
// that means to.

/// What a profile name may contain; anything else is dropped. At most 32 chars.
pub fn suffix_of(value: Option<&str>) -> String {
    let clean: String = value
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(32)
        .collect();
    if clean.is_empty() {
        String::new()
    } else {
        format!("-{clean}")
    }
}

fn suffix() -> String {
    suffix_of(std::env::var("BOTRACING_PROFILE").ok().as_deref())
}

/// True for the normal, real tray.
pub fn is_default() -> bool {
    suffix().is_empty()
}

/// The folder under %LOCALAPPDATA% where the tray keeps its files.
pub fn data_dir_name() -> String {
    format!("BotRacing{}", suffix())
}

/// The Credential Manager service name the stored sign-in lives under.
pub fn keyring_service() -> String {
    format!("BotRacing{}", suffix())
}

/// The named pipe the watcher holds so only one runs per profile.
pub fn lock_pipe() -> String {
    format!(r"\\.\pipe\botracing-watch{}", suffix())
}

/// The tray tooltip, so two trays can be told apart.
pub fn tooltip() -> String {
    format!("BotRacing{}", suffix())
}

/// The app identifier the single-instance hold is named after: the real one,
/// or the real one with the profile's suffix. So each profile holds its own
/// lock beside the real tray, and `botracing.exe --quit` under the same
/// BOTRACING_PROFILE reaches that profile's tray and nothing else.
pub fn identifier(base: &str) -> String {
    identifier_of(base, &suffix())
}

fn identifier_of(base: &str, suffix: &str) -> String {
    format!("{base}{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_profile_means_every_name_is_what_it_always_was() {
        for value in [None, Some(""), Some("   "), Some("!!!")] {
            assert_eq!(suffix_of(value), "", "{value:?}");
        }
        // The real names, unchanged, when the variable is not set in this test run.
        if std::env::var_os("BOTRACING_PROFILE").is_none() {
            assert!(is_default());
            assert_eq!(data_dir_name(), "BotRacing");
            assert_eq!(keyring_service(), "BotRacing");
            assert_eq!(lock_pipe(), r"\\.\pipe\botracing-watch");
            assert_eq!(tooltip(), "BotRacing");
        }
    }

    #[test]
    fn each_profile_holds_its_own_single_instance_lock() {
        let base = "app.botracing.tray";
        assert_eq!(identifier_of(base, ""), base);
        assert_eq!(identifier_of(base, &suffix_of(Some("seat"))), "app.botracing.tray-seat");
        assert_ne!(
            identifier_of(base, &suffix_of(Some("seat"))),
            identifier_of(base, &suffix_of(Some("seat2")))
        );
    }

    #[test]
    fn a_profile_suffixes_the_names_and_keeps_to_safe_characters() {
        assert_eq!(suffix_of(Some("walk1")), "-walk1");
        assert_eq!(suffix_of(Some("my_test-2")), "-my_test-2");
        // Anything that is not a letter, digit, dash or underscore is dropped:
        // a profile cannot make a path out of itself.
        assert_eq!(suffix_of(Some("../x y!")), "-xy");
        assert_eq!(suffix_of(Some(r"a\b/c")), "-abc");
        let long = "a".repeat(100);
        assert_eq!(suffix_of(Some(&long)).len(), 1 + 32);
    }
}
