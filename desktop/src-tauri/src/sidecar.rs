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

use crate::paths::{current_exe, plain};

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
    /// The sync's own work folder and state, apart from the old uploader's
    /// (%LOCALAPPDATA%/lap-sessions): its record of what was uploaded is keyed
    /// by owner and lives only here.
    pub fn sessions_dir(&self) -> PathBuf {
        self.data.join("sessions")
    }
    /// Asks the next sync to include sessions older than the first-run window.
    pub fn older_request_file(&self) -> PathBuf {
        self.sessions_dir().join(OLDER_REQUEST)
    }
}

/// The file name tools/sessions/syncState.mjs reads (OLDER_REQUEST).
const OLDER_REQUEST: &str = "include-older";
/// A first run uploads only recordings from this many days back.
const FIRST_RUN_DAYS: &str = "14";

const SCRIPT: &str = "tools/uploader/watch.mjs";

/// Where the uploader's files are, whatever folder the app was started from:
/// BOTRACING_ROOT if set, else the installed resources (<resources>/app), else
/// the repo this binary was built in (a build folder is
/// <repo>/desktop/src-tauri/target/<profile>/). The first that holds the
/// script wins; with none, the installed path, so the error names it.
pub fn find_root(env: Option<PathBuf>, resources: &Path, exe: &Path) -> PathBuf {
    let installed = resources.join("app");
    let mut candidates: Vec<PathBuf> = env.into_iter().collect();
    candidates.push(installed.clone());
    candidates.extend(exe.ancestors().skip(1).take(6).map(Path::to_path_buf));
    candidates
        .into_iter()
        .find(|dir| dir.join(SCRIPT).is_file())
        .unwrap_or(installed)
}

/// What `paths` reads from the process: taken as input so a test passes its
/// own and never depends on (or races over) the runner's BOTRACING_ROOT.
pub struct PathEnv {
    /// %LOCALAPPDATA% (else the temp dir).
    pub local: PathBuf,
    pub exe: PathBuf,
    /// BOTRACING_ROOT, when set.
    pub root: Option<PathBuf>,
    /// BOTRACING_NODE, when set.
    pub node: Option<PathBuf>,
}

impl PathEnv {
    pub fn from_process() -> PathEnv {
        PathEnv {
            local: std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir),
            exe: current_exe().unwrap_or_default(),
            root: std::env::var_os("BOTRACING_ROOT").map(PathBuf::from),
            node: std::env::var_os("BOTRACING_NODE").map(PathBuf::from),
        }
    }
}

pub fn paths(resources: &Path) -> Paths {
    paths_from(resources, PathEnv::from_process())
}

pub fn paths_from(resources: &Path, env: PathEnv) -> Paths {
    let resources = plain(resources);
    let local = env.local;
    let exe = env.exe;
    let root = find_root(env.root, &resources, &exe);
    let node = env.node.unwrap_or_else(|| {
        let bundled = resources.join("node").join("node.exe");
        if bundled.exists() {
            bundled
        } else {
            PathBuf::from("node")
        }
    });
    Paths {
        data: plain(&local.join(crate::profile::data_dir_name())),
        root: plain(&root),
        node: plain(&node),
    }
}

/// The uploader's folder under the tray's data folder: its state.json and the
/// cleanup's prune.json live here. The watcher is started with it
/// (LAP_UPLOADER_HOME) and the cleanup reads it, through this one function.
pub fn uploader_home(data: &Path) -> PathBuf {
    data.join("uploader")
}

fn command(p: &Paths) -> Command {
    let mut cmd = Command::new(&p.node);
    cmd.arg(p.root.join(SCRIPT))
        .arg("--")
        .arg("--remote")
        .arg("--work")
        .arg(p.sessions_dir())
        .arg("--first-window-days")
        .arg(FIRST_RUN_DAYS)
        .current_dir(&p.root)
        .env("LAP_TOKEN_FILE", p.token_file())
        .env("LAP_HEARTBEAT_FILE", p.status_file())
        .env("LAP_UPLOADER_HOME", uploader_home(&p.data))
        .env("LAP_VERSION", env!("CARGO_PKG_VERSION"))
        .env("LAP_PARENT_PID", std::process::id().to_string())
        .env("LAP_LOCK_PIPE", crate::profile::lock_pipe());
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
    pub fn spawn(cmd: Command, stderr: Stdio) -> std::io::Result<Running> {
        Running::spawn_inner(cmd, true, stderr)
    }

    // `job` false exists for the test that shows the job is what ends the
    // tree.
    fn spawn_inner(mut cmd: Command, job: bool, stderr: Stdio) -> std::io::Result<Running> {
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr);
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::*;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            let mut child = cmd.spawn()?;
            if !job {
                return Ok(Running {
                    child,
                    job: std::ptr::null_mut(),
                });
            }
            // Between spawn() above and the assignment below the child is in
            // no job, and anything it starts in that window is outside it.
            // Starting suspended would close the window; node takes far
            // longer than the few microseconds here to start its first child.
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
            let _ = job;
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
        if !self.job.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job);
            }
        }
    }
}

/// How long a watcher must stay up before an earlier failure streak is forgotten.
const HEALTHY_AFTER: Duration = Duration::from_secs(60);

/// Seconds to wait before the n-th restart in a row: 5, 10, 20, ... up to 60.
pub fn backoff(failures: u32) -> Duration {
    Duration::from_secs((5u64 << failures.min(4)).min(60))
}

/// Keeps one watcher running unless paused, and says what is wrong when it
/// is not.
pub struct Supervisor {
    running: Option<Running>,
    started_at: Option<Instant>,
    /// Uploads are allowed: signed in and not paused (account.rs decides).
    allowed: bool,
    failures: u32,
    retry_at: Option<Instant>,
    /// Why there is no watcher right now, for the tray.
    pub problem: Option<String>,
}

impl Supervisor {
    pub fn new() -> Supervisor {
        Supervisor {
            running: None,
            started_at: None,
            allowed: false,
            failures: 0,
            retry_at: Some(Instant::now()),
            problem: None,
        }
    }

    /// Starts or stops the watcher to match what the account allows. Not
    /// allowed: the watcher and everything it started end now.
    pub fn set_allowed(&mut self, allowed: bool) {
        if allowed == self.allowed {
            return;
        }
        self.allowed = allowed;
        self.problem = None;
        if allowed {
            self.failures = 0;
            self.retry_at = Some(Instant::now());
        } else {
            self.stop();
        }
    }

    pub fn stop(&mut self) {
        if let Some(running) = self.running.take() {
            running.stop();
        }
    }

    /// Called every few seconds: notices a watcher that ended and starts
    /// another (after a wait that grows), or reports why it cannot.
    pub fn tick(&mut self, p: &Paths) {
        if !self.allowed {
            return;
        }
        if let Some(running) = self.running.as_mut() {
            let Some(status) = running.exited() else {
                // A watcher that has run for a while is healthy: the next
                // stop starts the backoff over rather than continuing it.
                if self
                    .started_at
                    .is_some_and(|at| at.elapsed() > HEALTHY_AFTER)
                {
                    self.failures = 0;
                }
                return;
            };
            self.running = None;
            self.failures += 1;
            self.problem = Some(format!(
                "Uploader stopped ({status}), restarting. Log: {}",
                log_path(&p.data).display()
            ));
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
        let script = p.root.join(SCRIPT);
        if !script.is_file() {
            // Nothing to wait for: a retry finds the same thing.
            self.problem = Some(format!(
                "Can't find the uploader files ({} is missing)",
                script.display()
            ));
            self.retry_at = Some(Instant::now() + backoff(4));
            return;
        }
        trim_status(&p.status_file());
        let log = log_path(&p.data);
        let stderr = open_log(&log).map_or_else(Stdio::null, Stdio::from);
        match Running::spawn(command(p), stderr) {
            Ok(running) => {
                self.running = Some(running);
                self.started_at = Some(Instant::now());
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

/// Where the uploader's stderr goes, so a crash leaves its cause behind.
pub fn log_path(data: &Path) -> PathBuf {
    uploader_home(data).join("sidecar.log")
}

/// About 1 MB at most: past that, the newest half is kept.
const LOG_MAX_BYTES: u64 = 1_000_000;
const LOG_KEEP_BYTES: u64 = 500_000;

/// The log opened for appending, with a line marking this start. None if it
/// cannot be opened: the uploader then runs without a log rather than not at
/// all.
fn open_log(file: &Path) -> Option<std::fs::File> {
    use std::io::Write;
    std::fs::create_dir_all(file.parent()?).ok()?;
    trim_log(file);
    let mut log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .ok()?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let _ = writeln!(log, "--- uploader start (unix {secs}) ---");
    Some(log)
}

fn trim_log(file: &Path) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(file) else {
        return;
    };
    let len = f.metadata().map_or(0, |m| m.len());
    if len <= LOG_MAX_BYTES {
        return;
    }
    let mut newest = Vec::new();
    if f.seek(SeekFrom::Start(len - LOG_KEEP_BYTES)).is_err() || f.read_to_end(&mut newest).is_err()
    {
        return;
    }
    drop(f);
    // The cut can land mid-line: drop the partial first line.
    let from = newest.iter().position(|b| *b == b'\n').map_or(0, |i| i + 1);
    let _ = std::fs::write(file, &newest[from..]);
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

    // paths() with a fixed environment: the runner's BOTRACING_ROOT or
    // BOTRACING_NODE never changes what a test sees.
    fn test_paths(resources: &Path) -> Paths {
        paths_from(
            resources,
            PathEnv {
                local: std::env::temp_dir(),
                exe: current_exe().unwrap_or_default(),
                root: None,
                node: None,
            },
        )
    }
    use std::time::Duration;

    #[test]
    fn restarts_wait_longer_each_time_up_to_a_minute() {
        let secs: Vec<u64> = (0..7).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(secs, [5, 10, 20, 40, 60, 60, 60]);
    }

    // A stand-in parent (cmd.exe) starts a grandchild (node) that appends to a
    // file every 50 ms, and exits by itself after 5 s so a test that leaves it
    // running cleans up. The parent is cmd, not node, on purpose: node ties the
    // children it starts to its own death on Windows, which would end the
    // grandchild whatever our job does. Returns the file's size right after
    // the tree was stopped and again a moment later.
    #[cfg(windows)]
    fn sizes_after_stop(job: bool) -> (u64, u64) {
        use std::os::windows::process::CommandExt;
        let dir = std::env::temp_dir().join(format!("botracing-job-{}-{job}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let beat = dir.join("beat.txt");
        let _ = std::fs::remove_file(&beat);
        let script = dir.join("grandchild.js");
        std::fs::write(
            &script,
            format!(
                "setTimeout(()=>process.exit(),5000);setInterval(()=>require('fs').appendFileSync({:?},'x'),50)",
                beat.to_string_lossy()
            ),
        )
        .unwrap();
        let mut cmd = Command::new("cmd");
        cmd.raw_arg(format!(
            "/c start /b node \"{}\" & ping -n 30 127.0.0.1 >nul",
            script.display()
        ));
        let running = Running::spawn_inner(cmd, job, Stdio::null()).expect("cmd starts");

        std::thread::sleep(Duration::from_millis(1500));
        assert!(
            std::fs::metadata(&beat).map(|m| m.len()).unwrap_or(0) > 0,
            "the grandchild never ran"
        );
        running.stop();
        std::thread::sleep(Duration::from_millis(500));
        let after_stop = std::fs::metadata(&beat).unwrap().len();
        std::thread::sleep(Duration::from_millis(800));
        let later = std::fs::metadata(&beat).unwrap().len();
        (after_stop, later)
    }

    // Pause and Quit must end what the watcher started too, not only the
    // watcher.
    #[cfg(windows)]
    #[test]
    fn stop_ends_the_whole_tree() {
        let (after_stop, later) = sizes_after_stop(true);
        assert_eq!(after_stop, later, "the grandchild is still writing");
    }

    // The control: without the job, stopping the parent leaves the grandchild
    // running, so the test above proves something.
    #[cfg(windows)]
    #[test]
    fn without_the_job_the_grandchild_outlives_the_parent() {
        let (after_stop, later) = sizes_after_stop(false);
        assert!(later > after_stop, "the grandchild stopped by itself");
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "").unwrap();
    }

    #[test]
    fn the_uploader_files_are_found_from_any_start_folder() {
        let base = std::env::temp_dir().join(format!("botracing-root-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        // A repo with a build folder, and an unrelated resources folder.
        let repo = base.join("repo");
        touch(&repo.join(SCRIPT));
        let exe = repo.join("desktop/src-tauri/target/release/botracing.exe");
        let resources = base.join("resources");
        let env_root = base.join("elsewhere");
        touch(&env_root.join(SCRIPT));

        // The environment wins.
        assert_eq!(
            find_root(Some(env_root.clone()), &resources, &exe),
            env_root
        );
        // Then the installed resources.
        touch(&resources.join("app").join(SCRIPT));
        assert_eq!(find_root(None, &resources, &exe), resources.join("app"));
        // Then the repo the binary was built in.
        std::fs::remove_dir_all(&resources).unwrap();
        assert_eq!(find_root(None, &resources, &exe), repo);
        // None: the installed path, so the message names where it looked.
        let lost = base.join("nowhere/botracing.exe");
        assert_eq!(find_root(None, &resources, &lost), resources.join("app"));
        let _ = std::fs::remove_dir_all(&base);
    }

    // The installed tray's case: Tauri's resource_dir() is canonicalized, so it
    // is `\\?\C:\...`. Every path the watcher gets must be plain (the asserts
    // fail without `plain`, on any node), and node must start from them. Whether
    // node itself refuses a verbatim main script depends on its version: the
    // bundled 24.19.0 does, 24.21.0 (CI) does not, so no test leans on that.
    #[cfg(windows)]
    #[test]
    fn a_verbatim_resources_dir_still_starts_the_watcher() {
        let base = std::env::temp_dir().join(format!("botracing-verbatim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let resources = base.join("install");
        touch(&resources.join("app").join(SCRIPT));
        let started = base.join("started.txt");
        std::fs::write(
            resources.join("app").join(SCRIPT),
            format!(
                "import {{writeFileSync}} from 'node:fs'; writeFileSync({:?}, process.argv[1]);",
                started.to_string_lossy()
            ),
        )
        .unwrap();
        let verbatim = resources.canonicalize().unwrap();
        assert!(
            verbatim.to_string_lossy().starts_with(r"\\?\"),
            "{verbatim:?}"
        );

        let mut p = test_paths(&verbatim);
        p.data = base.join("data");
        for path in [&p.root, &p.node] {
            assert!(!path.to_string_lossy().starts_with(r"\\?\"), "{path:?}");
        }
        // The same folder, whatever 8.3 short name the temp dir was given as.
        assert_eq!(p.root, plain(&verbatim.join("app")));

        let mut s = Supervisor::new();
        s.set_allowed(true);
        s.tick(&p);
        assert!(
            s.problem.is_none(),
            "it should have started: {:?}",
            s.problem
        );
        let deadline = Instant::now() + Duration::from_secs(10);
        while !started.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let script = std::fs::read_to_string(&started).expect("node never ran the script");
        assert!(!script.starts_with(r"\\?\"), "{script}");
        s.stop();
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_sync_gets_its_own_state_folder_and_a_first_run_window() {
        let mut p = test_paths(Path::new("."));
        p.data = std::env::temp_dir().join("botracing-args");
        let args: Vec<String> = command(&p)
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let at = args.iter().position(|a| a == "--work").expect("--work");
        assert_eq!(
            PathBuf::from(&args[at + 1]),
            p.data.join("sessions"),
            "{args:?}"
        );
        let at = args
            .iter()
            .position(|a| a == "--first-window-days")
            .expect("--first-window-days");
        assert_eq!(args[at + 1], "14");
        assert_eq!(
            p.older_request_file(),
            p.data.join("sessions").join("include-older")
        );
    }

    #[test]
    fn missing_uploader_files_are_named_not_swallowed() {
        let mut p = test_paths(Path::new("."));
        p.root = std::env::temp_dir().join(format!("botracing-noroot-{}", std::process::id()));
        let mut s = Supervisor::new();
        s.set_allowed(true);
        s.tick(&p);
        let problem = s.problem.unwrap_or_default();
        assert!(
            problem.starts_with("Can't find the uploader files"),
            "{problem}"
        );
    }

    // A watcher that starts and dies at once (the way a missing dependency or
    // a bad root does): the next tick must say so and schedule a restart, not
    // leave the last status on screen.
    #[test]
    fn a_watcher_that_dies_is_reported_and_restarts_later() {
        let base = std::env::temp_dir().join(format!("botracing-die-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        touch(&base.join("root").join(SCRIPT));
        std::fs::write(base.join("root").join(SCRIPT), "process.exit(3)").unwrap();
        let mut p = test_paths(Path::new("."));
        p.root = base.join("root");
        p.data = base.join("data");
        let mut s = Supervisor::new();
        s.set_allowed(true);
        s.tick(&p);
        assert!(
            s.problem.is_none(),
            "it should have started: {:?}",
            s.problem
        );
        std::thread::sleep(Duration::from_millis(1500));
        s.tick(&p);
        let problem = s.problem.clone().unwrap_or_default();
        assert!(problem.starts_with("Uploader stopped"), "{problem}");
        assert!(problem.contains("restarting"), "{problem}");
        // The wait before the restart has not passed yet, so no second start.
        s.tick(&p);
        assert!(s.problem.is_some());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_log_keeps_the_newest_part_and_the_crash_reaches_it() {
        let base = std::env::temp_dir().join(format!("botracing-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let file = log_path(&base);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        let old = "old line\n".repeat(150_000);
        std::fs::write(&file, format!("{old}newest line\n")).unwrap();
        drop(open_log(&file));
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.len() < 600_000, "{}", text.len());
        assert!(text.starts_with("old line\n"), "no partial first line");
        assert!(text.contains("newest line\n--- uploader start"));

        touch(&base.join("root").join(SCRIPT));
        std::fs::write(
            base.join("root").join(SCRIPT),
            "console.error('boom: cannot find thing'); process.exit(1)",
        )
        .unwrap();
        let mut p = test_paths(Path::new("."));
        p.root = base.join("root");
        p.data = base.clone();
        let mut s = Supervisor::new();
        s.set_allowed(true);
        s.tick(&p);
        std::thread::sleep(Duration::from_millis(1500));
        s.tick(&p);
        let problem = s.problem.clone().unwrap_or_default();
        assert!(problem.contains("sidecar.log"), "{problem}");
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("boom: cannot find thing"), "{text}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_missing_node_is_reported_not_swallowed() {
        let mut p = test_paths(Path::new("."));
        p.node = PathBuf::from("definitely-not-a-real-node-binary");
        p.data = std::env::temp_dir().join(format!("botracing-miss-{}", std::process::id()));
        let mut s = Supervisor::new();
        s.set_allowed(true);
        s.tick(&p);
        assert!(s
            .problem
            .as_deref()
            .unwrap_or("")
            .starts_with("Can't start the uploader"));
        let _ = std::fs::remove_dir_all(&p.data);
    }
}
