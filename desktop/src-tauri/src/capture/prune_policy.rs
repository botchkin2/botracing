// What the cleanup keeps, fixed: no menu, no settings file. Both sims' finished
// and uploaded recordings go after 14 days, and the oldest go first while the
// capture folder is over 10 GB (Botkin, pit-wall thread 1 #3433).
use std::time::Duration;

use super::prune::Policy;

pub const KEEP_DAYS: u64 = 14;
/// Gigabytes of 10^9 bytes.
pub const CAP_GB: u64 = 10;

pub fn policy() -> Policy {
    Policy {
        keep: Duration::from_secs(86_400 * KEEP_DAYS),
        cap_bytes: CAP_GB * 1_000_000_000,
        sims: vec!["lmu".to_string(), "iracing".to_string()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_sims_are_cleaned_after_14_days_and_over_10_gb() {
        let p = policy();
        assert_eq!(p.keep, Duration::from_secs(14 * 86_400));
        assert_eq!(p.cap_bytes, 10_000_000_000);
        assert_eq!(p.sims, ["lmu", "iracing"]);
    }
}
