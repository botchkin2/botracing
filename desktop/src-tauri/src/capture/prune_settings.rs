// The tray's cleanup choices: which sims' recordings may be pruned, how many
// days to keep them, and the size cap. Stored as prune.json in the uploader's
// folder. A missing or unreadable file, or a value outside the menu's choices,
// gives the default for that field.
use std::fs;
use std::io;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::prune::Policy;

/// The keep periods the menu cycles through, in days.
pub const KEEP_CHOICES: [u32; 3] = [7, 14, 30];
/// The size caps the menu cycles through, in gigabytes (10^9 bytes).
pub const CAP_CHOICES_GB: [u32; 3] = [5, 10, 20];

#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    pub lmu: bool,
    pub iracing: bool,
    pub keep_days: u32,
    pub cap_gb: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            lmu: true,
            iracing: true,
            keep_days: 14,
            cap_gb: 10,
        }
    }
}

impl Settings {
    /// The prune policy these settings mean: the sims switched on, the keep
    /// period and the size cap.
    pub fn policy(&self) -> Policy {
        let mut sims = Vec::new();
        if self.lmu {
            sims.push("lmu".to_string());
        }
        if self.iracing {
            sims.push("iracing".to_string());
        }
        Policy {
            keep: Duration::from_secs(86_400 * u64::from(self.keep_days)),
            cap_bytes: u64::from(self.cap_gb) * 1_000_000_000,
            sims,
        }
    }

    /// The keep period after the current one in the menu's cycle.
    pub fn next_keep_days(&self) -> u32 {
        next_in(&KEEP_CHOICES, self.keep_days)
    }

    /// The size cap after the current one in the menu's cycle.
    pub fn next_cap_gb(&self) -> u32 {
        next_in(&CAP_CHOICES_GB, self.cap_gb)
    }
}

fn next_in(choices: &[u32], current: u32) -> u32 {
    let i = choices
        .iter()
        .position(|c| *c == current)
        .map_or(0, |i| (i + 1) % choices.len());
    choices[i]
}

/// The settings in `path`, or the defaults when it cannot be read.
pub fn load(path: &Path) -> Settings {
    let defaults = Settings::default();
    let Ok(text) = fs::read_to_string(path) else {
        return defaults;
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return defaults;
    };
    Settings {
        lmu: v
            .get("lmu")
            .and_then(Value::as_bool)
            .unwrap_or(defaults.lmu),
        iracing: v
            .get("iracing")
            .and_then(Value::as_bool)
            .unwrap_or(defaults.iracing),
        keep_days: choice(&v, "keepDays", &KEEP_CHOICES, defaults.keep_days),
        cap_gb: choice(&v, "capGb", &CAP_CHOICES_GB, defaults.cap_gb),
    }
}

fn choice(v: &Value, key: &str, allowed: &[u32], default: u32) -> u32 {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| allowed.contains(n))
        .unwrap_or(default)
}

/// Writes the settings to `path`, through a temp file so a crash never leaves
/// half a file behind.
pub fn save(path: &Path, s: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let text = json!({
        "lmu": s.lmu,
        "iracing": s.iracing,
        "keepDays": s.keep_days,
        "capGb": s.cap_gb,
    })
    .to_string();
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "botracing-prune-settings-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_missing_file_gives_the_defaults() {
        let dir = temp("missing");
        assert_eq!(load(&dir.join("prune.json")), Settings::default());
    }

    #[test]
    fn saved_settings_load_back_unchanged() {
        let dir = temp("roundtrip");
        let file = dir.join("prune.json");
        let s = Settings {
            lmu: false,
            iracing: true,
            keep_days: 30,
            cap_gb: 5,
        };
        save(&file, &s).unwrap();
        assert_eq!(load(&file), s);
        assert!(!file.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_value_outside_the_menu_falls_back_to_its_default() {
        let dir = temp("outside");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("prune.json");
        fs::write(&file, r#"{"lmu":false,"keepDays":3,"capGb":999}"#).unwrap();
        let s = load(&file);
        assert!(!s.lmu);
        assert_eq!(s.keep_days, 14);
        assert_eq!(s.cap_gb, 10);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unreadable_json_gives_the_defaults() {
        let dir = temp("junk");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("prune.json");
        fs::write(&file, "not json").unwrap();
        assert_eq!(load(&file), Settings::default());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_policy_maps_sims_days_and_gigabytes() {
        let s = Settings {
            lmu: true,
            iracing: false,
            keep_days: 7,
            cap_gb: 20,
        };
        let p = s.policy();
        assert_eq!(p.sims, vec!["lmu".to_string()]);
        assert_eq!(p.keep, Duration::from_secs(7 * 86_400));
        assert_eq!(p.cap_bytes, 20_000_000_000);
    }

    #[test]
    fn the_menu_cycles_through_its_choices_and_wraps() {
        let mut s = Settings::default();
        assert_eq!(s.next_keep_days(), 30);
        s.keep_days = 30;
        assert_eq!(s.next_keep_days(), 7);
        assert_eq!(s.next_cap_gb(), 20);
    }
}
