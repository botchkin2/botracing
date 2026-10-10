// Every path the tray hands to another program, or writes where another
// program reads it (node's script, the Run value), goes through here.
//
// Tauri canonicalizes the exe it reports, so `resource_dir()` arrives as
// `\\?\C:\Users\...`. The bundled node 24.19.0 exits 1 on a `\\?\` main script
// ("EISDIR ... lstat 'C:'"), which was the 0.1.2 "Uploader stopped (exit code:
// 1)" loop (thread 1 #3473); Windows' Run key and older tools are no better.
use std::path::{Path, PathBuf};

/// `path` without a `\\?\` prefix when it has a plain form (dunce); a path
/// that only works verbatim (too long, a reserved name) is kept as it is.
pub fn plain(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

/// The running exe, plain. Use this, never `std::env::current_exe()` directly.
pub fn current_exe() -> std::io::Result<PathBuf> {
    std::env::current_exe().map(|exe| plain(&exe))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn a_verbatim_path_becomes_plain_and_a_plain_one_stays() {
        assert_eq!(
            plain(Path::new(r"\\?\C:\Users\x\AppData\Local\BotRacing\app")),
            PathBuf::from(r"C:\Users\x\AppData\Local\BotRacing\app")
        );
        assert_eq!(
            plain(Path::new(r"C:\Users\x\BotRacing")),
            PathBuf::from(r"C:\Users\x\BotRacing")
        );
        // A name Windows reserves only works verbatim: kept as it is.
        let reserved = Path::new(r"\\?\C:\x\con");
        assert_eq!(plain(reserved), reserved.to_path_buf());
    }

    #[test]
    fn the_exe_is_never_verbatim() {
        let exe = current_exe().unwrap();
        assert!(!exe.to_string_lossy().starts_with(r"\\?\"), "{exe:?}");
    }
}
