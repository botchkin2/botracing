// The Node sidecar: tools/uploader/watch.mjs, run with --remote so sync.mjs
// uploads through the user's token and never needs Admin credentials.
//
// The watcher starts sync.mjs as a child, and that starts workers. All of it
// runs in one Windows Job Object that is killed when its handle closes: Pause
// and Quit close it, and so does the tray dying for any reason, so no upload
// outlives the tray (parentGuard.mjs in the watcher is only a fallback).
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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

fn command(p: &Paths) -> Command {
    let mut cmd = Command::new(&p.node);
    cmd.arg(p.root.join("tools/uploader/watch.mjs"))
        .arg("--")
        .arg("--remote")
        .current_dir(&p.root)
        .env("LAP_TOKEN_FILE", p.token_file())
        .env("LAP_HEARTBEAT_FILE", p.status_file())
        .env("LAP_UPLOADER_HOME", p.data.join("uploader"))
        .env("LAP_PARENT_PID", std::process::id().to_string())
        .env("LAP_LOCK_PIPE", r"\\.\pipe\botracing-watch");
    cmd
}

/// A running process tree. Dropping it, or the tray dying, kills the tree.
pub struct Running {
    child: Child,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for Running {}

impl Running {
    /// Starts `cmd` quietly and puts it in a kill-on-close job. A process
    /// that starts its own children before the assignment below is the one
    /// gap; node takes far longer than that to get to its first child.
    pub fn spawn(mut cmd: Command) -> std::io::Result<Running> {
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::*;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            let mut child = cmd.spawn()?;
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    let _ = child.kill();
                    return Err(std::io::Error::last_os_error());
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 || AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 {
                    let error = std::io::Error::last_os_error();
                    CloseHandle(job);
                    let _ = child.kill();
                    return Err(error);
                }
                Ok(Running { child, job })
            }
        }
        #[cfg(not(windows))]
        {
            Ok(Running {
                child: cmd.spawn()?,
            })
        }
    }

    /// The exit status once the process has ended, None while it runs.
    pub fn exited(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().ok().flatten()
    }

    /// Kills the whole tree and waits for the top process.
    pub fn stop(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        // Dropping closes the job, which ends anything the child started.
    }
}

#[cfg(windows)]
impl Drop for Running {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

/// Seconds to wait before the n-th restart in a row: 5, 10, 20, ... up to 60.
pub fn backoff(failures: u32) -> Duration {
    Duration::from_secs((5u64 << failures.min(4)).min(60))
}

/// Keeps one watcher running unless paused, and says what is wrong when it
/// is not.
pub struct Supervisor {
    running: Option<Running>,
    paused: bool,
    failures: u32,
    retry_at: Option<Instant>,
    /// Why there is no watcher right now, for the tray.
    pub problem: Option<String>,
}

impl Supervisor {
    pub fn new() -> Supervisor {
        Supervisor {
            running: None,
            paused: false,
            failures: 0,
            retry_at: Some(Instant::now()),
            problem: None,
        }
    }

    pub fn paused(&self) -> bool {
        self.paused
    }

    pub fn pause(&mut self) {
        self.paused = true;
        self.problem = None;
        self.stop();
    }

    pub fn resume(&mut self) {
        self.paused = false;
        self.failures = 0;
        self.retry_at = Some(Instant::now());
    }

    pub fn stop(&mut self) {
        if let Some(running) = self.running.take() {
            running.stop();
        }
    }

    /// Called every few seconds: notices a watcher that ended and starts
    /// another (after a wait that grows), or reports why it cannot.
    pub fn tick(&mut self, p: &Paths) {
        if self.paused {
            return;
        }
        if let Some(running) = self.running.as_mut() {
            let Some(status) = running.exited() else {
                return;
            };
            self.running = None;
            self.failures += 1;
            self.problem = Some(format!("Uploader stopped ({status}), restarting"));
            self.retry_at = Some(Instant::now() + backoff(self.failures));
            return;
        }
        if self.retry_at.is_some_and(|at| Instant::now() < at) {
            return;
        }
        if let Err(error) = std::fs::create_dir_all(&p.data) {
            self.failed(format!("Can't start the uploader: {error}"));
            return;
        }
        trim_status(&p.status_file());
        match Running::spawn(command(p)) {
            Ok(running) => {
                self.running = Some(running);
                self.problem = None;
                self.retry_at = None;
            }
            Err(error) => self.failed(format!("Can't start the uploader: {error}")),
        }
    }

    fn failed(&mut self, message: String) {
        self.failures += 1;
        self.problem = Some(message);
        self.retry_at = Some(Instant::now() + backoff(self.failures));
    }
}

/// The status file only grows while a watcher runs; start each run from a
/// small one.
fn trim_status(file: &Path) {
    const MAX_BYTES: u64 = 1_000_000;
    if std::fs::metadata(file).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::remove_file(file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn restarts_wait_longer_each_time_up_to_a_minute() {
        let secs: Vec<u64> = (0..7).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(secs, [5, 10, 20, 40, 60, 60, 60]);
    }

    // Pause and Quit must end what the watcher started too, not only the
    // watcher: a stand-in parent starts a grandchild that appends to a file
    // every 50 ms; after stop() the file must stop growing.
    #[cfg(windows)]
    #[test]
    fn stop_ends_the_whole_tree() {
        let dir = std::env::temp_dir().join(format!("botracing-job-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let beat = dir.join("beat.txt");
        let _ = std::fs::remove_file(&beat);
        let grandchild = format!(
            "setInterval(()=>require('fs').appendFileSync({:?},'x'),50)",
            beat.to_string_lossy()
        );
        let parent = format!(
            "require('child_process').spawn(process.execPath,['-e',{:?}],{{stdio:'ignore'}});setInterval(()=>{{}},1000)",
            grandchild
        );
        let mut cmd = Command::new("node");
        cmd.args(["-e", &parent]);
        let running = Running::spawn(cmd).expect("node on PATH");

        std::thread::sleep(Duration::from_millis(1500));
        let before = std::fs::metadata(&beat).map(|m| m.len()).unwrap_or(0);
        assert!(before > 0, "the grandchild never ran");

        running.stop();
        std::thread::sleep(Duration::from_millis(500));
        let after_stop = std::fs::metadata(&beat).unwrap().len();
        std::thread::sleep(Duration::from_millis(800));
        let later = std::fs::metadata(&beat).unwrap().len();
        assert_eq!(after_stop, later, "the grandchild is still writing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_node_is_reported_not_swallowed() {
        let mut p = paths(Path::new("."));
        p.node = PathBuf::from("definitely-not-a-real-node-binary");
        p.data = std::env::temp_dir().join(format!("botracing-miss-{}", std::process::id()));
        let mut s = Supervisor::new();
        s.tick(&p);
        assert!(s
            .problem
            .as_deref()
            .unwrap_or("")
            .starts_with("Can't start the uploader"));
        let _ = std::fs::remove_dir_all(&p.data);
    }
}
