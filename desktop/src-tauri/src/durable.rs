//! Writes a file whole and flushed, for the small state files the tray keeps
//! that change rarely: the settings and the token the watcher reads, and a
//! capture's meta.json (written at the start, on a first layout doubt and at
//! the end). A temp file beside it is written, `sync_all`ed and renamed over, so after a
//! power cut the file is the old one or the new one and not an empty one (NTFS
//! can persist a rename before the data it names; ticket 86, pit-wall thread
//! 136 #8613, inferred). What the recorder writes while he races is not written
//! this way: the parquet chunks and the status files (rewritten every few
//! seconds, and regenerated). An fsync there is a frame-time cost nobody has
//! measured (thread 142 #8700).
use std::io::Write;
use std::path::Path;

/// `path` replaced by `bytes`: temp file, flushed, renamed over.
pub fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("botracing-durable-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn replaces_the_file_whole_and_leaves_no_temp_file() {
        let d = dir("whole");
        let f = d.join("settings.json");
        write_whole(&f, b"{\"paused\":false}").unwrap();
        write_whole(&f, b"{\"paused\":true}").unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "{\"paused\":true}");
        assert!(!d.join("settings.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_error_is_returned_not_swallowed() {
        let d = dir("err");
        // The folder does not exist: the temp file cannot be made.
        assert!(write_whole(&d.join("missing").join("a.json"), b"x").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
