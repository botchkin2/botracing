// The Node sidecar: tools/uploader/watch.mjs, run with --remote so sync.mjs
// uploads through the user's token and never needs Admin credentials.
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub struct Paths {
    /// %LOCALAPPDATA%\BotRacing: everything the tray keeps.
    pub data: PathBuf,
    /// Where tools/ and node_modules/ live: BOTRACING_ROOT, else the installed
    /// resources (<resources>/app).
    pub root: PathBuf,
    pub node: PathBuf,
}

impl Paths {
    pub fn status_file(&self) -> PathBuf {
        self.data.join("status.jsonl")
    }
    pub fn token_file(&self) -> PathBuf {
        self.data.join("token")
    }
}

pub fn paths(resources: &Path) -> Paths {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let root = std::env::var_os("BOTRACING_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| resources.join("app"));
    let node = std::env::var_os("BOTRACING_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let bundled = resources.join("node").join("node.exe");
            if bundled.exists() {
                bundled
            } else {
                PathBuf::from("node")
            }
        });
    Paths {
        data: local.join("BotRacing"),
        root,
        node,
    }
}

pub fn start(p: &Paths) -> std::io::Result<Child> {
    std::fs::create_dir_all(&p.data)?;
    let mut cmd = Command::new(&p.node);
    cmd.arg(p.root.join("tools/uploader/watch.mjs"))
        .arg("--")
        .arg("--remote")
        .current_dir(&p.root)
        .env("LAP_TOKEN_FILE", p.token_file())
        .env("LAP_HEARTBEAT_FILE", p.status_file())
        .env("LAP_UPLOADER_HOME", p.data.join("uploader"))
        .env("LAP_PARENT_PID", std::process::id().to_string())
        .env("LAP_LOCK_PIPE", r"\\.\pipe\botracing-watch")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}
