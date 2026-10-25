// A shutdown or a sleep takes the process without asking the recorders: the
// open chunk (up to CHUNK_MS of rows) would be gone, and nothing would count
// it. Windows says so first: WM_QUERYENDSESSION and WM_ENDSESSION when the
// PC shuts down or the user logs off, PBT_APMSUSPEND when it goes to sleep.
// Only a top-level window receives them (a message-only window gets none), so
// a hidden one runs on a thread of its own. Its handler asks every running
// recorder to write what it holds and waits for them, at most WAIT: it never
// holds a shutdown for longer, and it always answers "yes" to the query.
//
// The recorders do the writing on their own thread, in their own loop (`drive`
// in runner.rs and ir_recorder.rs): they own the capture, so no lock is added
// to the poll. They check `Registration::due`, one atomic load.
//
// A window that cannot be made is logged and recording goes on as before.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// The longest the handler waits for the recorders. Windows gives a program a few seconds after
/// WM_ENDSESSION before it shows it as not responding; a chunk is written in 100 ms.
pub const WAIT: Duration = Duration::from_secs(2);

/// The recorders running now, and a request for them to write what they hold.
pub static FLUSHES: Flushes = Flushes::new();

pub struct Flushes {
    /// Counts requests: a recorder whose `seen` differs has one to answer. Read on every poll.
    generation: AtomicU64,
    state: Mutex<State>,
    answered: Condvar,
}

struct State {
    registered: usize,
    /// Recorders that have not answered the latest request.
    pending: usize,
}

impl Flushes {
    pub const fn new() -> Flushes {
        Flushes {
            generation: AtomicU64::new(0),
            state: Mutex::new(State { registered: 0, pending: 0 }),
            answered: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A recorder that will answer requests until the registration is dropped.
    pub fn register(&self) -> Registration<'_> {
        self.lock().registered += 1;
        Registration { flushes: self, seen: self.generation.load(Ordering::SeqCst) }
    }

    /// Asks every registered recorder to write what it holds and waits for them, at most `wait`.
    /// True when all answered (also when none is running).
    ///
    /// Requests do not overlap (one handler thread). A recorder that answers request N after N timed out
    /// counts for N+1 too, without having written the rows in between: milliseconds of rows between a
    /// shutdown query and its end, and only after a 2 s miss.
    pub fn request(&self, wait: Duration) -> bool {
        let end = Instant::now() + wait;
        let mut state = self.lock();
        state.pending = state.registered;
        self.generation.fetch_add(1, Ordering::SeqCst);
        while state.pending > 0 {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            state = self.answered.wait_timeout(state, left).unwrap_or_else(|p| p.into_inner()).0;
        }
        state.pending == 0
    }
}

pub struct Registration<'a> {
    flushes: &'a Flushes,
    seen: u64,
}

impl Registration<'_> {
    /// A request is waiting for this recorder.
    pub fn due(&self) -> bool {
        self.flushes.generation.load(Ordering::SeqCst) != self.seen
    }

    /// The recorder wrote what it held: the request is answered.
    pub fn done(&mut self) {
        if !self.due() {
            return;
        }
        self.seen = self.flushes.generation.load(Ordering::SeqCst);
        let mut state = self.flushes.lock();
        state.pending = state.pending.saturating_sub(1);
        self.flushes.answered.notify_all();
    }
}

impl Drop for Registration<'_> {
    /// A recorder that stops mid-request must not hold the request up.
    fn drop(&mut self) {
        let owes = self.due();
        let mut state = self.flushes.lock();
        state.registered = state.registered.saturating_sub(1);
        if owes {
            state.pending = state.pending.saturating_sub(1);
        }
        self.flushes.answered.notify_all();
    }
}

#[cfg(windows)]
pub use window::start;
// The test finds the window by its class.
#[cfg(all(windows, test))]
pub use window::{wide, CLASS};

#[cfg(windows)]
mod window {
    use super::{FLUSHES, WAIT};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetPriorityClass, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage,
        MSG, PBT_APMSUSPEND, WM_ENDSESSION, WM_POWERBROADCAST, WM_QUERYENDSESSION, WNDCLASSW,
    };

    pub const CLASS: &str = "BotRacingPowerWatcher";

    pub fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Asks the recorders to write what they hold, with the process above normal while they do. The
    /// recorder and its chunk writer run below the game (win.rs lower_priority), and a game or a VR
    /// compositor that keeps every core busy would starve them past the wait: a test with 32 busy
    /// threads did, every time.
    fn flush_now() {
        // SAFETY: the pseudo handle of this process is always valid.
        let (process, before) = unsafe { (GetCurrentProcess(), GetPriorityClass(GetCurrentProcess())) };
        // SAFETY: as above; a class this call cannot set leaves the process as it was.
        unsafe { SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS) };
        FLUSHES.request(WAIT);
        if before != 0 {
            // SAFETY: as above; `before` is the class the process had.
            unsafe { SetPriorityClass(process, before) };
        }
    }

    /// Windows calls this on the window's thread, and waits for the answer.
    unsafe extern "system" fn handle(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            // The PC is about to go down, if no other program objects: write what is held now, and answer
            // yes (TRUE) whatever happens, so this program never holds a shutdown.
            WM_QUERYENDSESSION => {
                flush_now();
                1
            }
            // The shutdown is going ahead (wparam TRUE) or was called off (FALSE): whatever came in since the
            // query is written too.
            WM_ENDSESSION => {
                if wparam != 0 {
                    flush_now();
                }
                0
            }
            WM_POWERBROADCAST => {
                if wparam as u32 == PBT_APMSUSPEND {
                    flush_now();
                }
                1
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    /// Makes the hidden window on a thread of its own. `log` gets the reason when it cannot be made; the
    /// recorders then run as before, bounded by the timed flush.
    pub fn start(log: impl Fn(&str) + Send + 'static) {
        // A thread that cannot start leaves recording as before; there is no one to tell.
        let _ = std::thread::Builder::new().name("power".into()).spawn(move || {
            // SAFETY: plain Win32 calls with valid arguments; the class name and title outlive the calls.
            unsafe {
                let class = wide(CLASS);
                let hinstance = GetModuleHandleW(std::ptr::null());
                let mut spec: WNDCLASSW = std::mem::zeroed();
                spec.lpfnWndProc = Some(handle);
                spec.hInstance = hinstance;
                spec.lpszClassName = class.as_ptr();
                if RegisterClassW(&spec) == 0 {
                    log(&format!("power watcher: no window class ({})", std::io::Error::last_os_error()));
                    return;
                }
                let hwnd = CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    hinstance,
                    std::ptr::null(),
                );
                if hwnd.is_null() {
                    log(&format!("power watcher: no window ({})", std::io::Error::last_os_error()));
                    return;
                }
                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    /// A recorder stand-in: answers every request after `delay`, until `stop`.
    fn answering(flushes: &'static Flushes, delay: Duration, stop: Arc<AtomicBool>) -> std::thread::JoinHandle<()> {
        let mut registration = flushes.register();
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                if registration.due() {
                    std::thread::sleep(delay);
                    registration.done();
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        })
    }

    #[test]
    fn a_request_with_no_recorder_running_is_answered_at_once() {
        let flushes = Flushes::new();
        let t = Instant::now();
        assert!(flushes.request(Duration::from_secs(5)));
        assert!(t.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn a_request_waits_for_every_recorder_and_no_longer() {
        static FLUSHES: Flushes = Flushes::new();
        let stop = Arc::new(AtomicBool::new(false));
        let fast = answering(&FLUSHES, Duration::from_millis(20), stop.clone());
        let slow = answering(&FLUSHES, Duration::from_millis(150), stop.clone());
        let t = Instant::now();
        assert!(FLUSHES.request(Duration::from_secs(5)));
        assert!(t.elapsed() >= Duration::from_millis(150), "waited for the slower one: {:?}", t.elapsed());
        // A recorder that never answers costs the wait, not the shutdown.
        let stuck = FLUSHES.register();
        let t = Instant::now();
        assert!(!FLUSHES.request(Duration::from_millis(200)));
        assert!(t.elapsed() < Duration::from_secs(2), "{:?}", t.elapsed());
        assert!(stuck.due());
        drop(stuck);
        stop.store(true, Ordering::SeqCst);
        fast.join().unwrap();
        slow.join().unwrap();
    }

    #[test]
    fn a_recorder_that_stops_mid_request_does_not_hold_it_up() {
        static FLUSHES: Flushes = Flushes::new();
        let registration = FLUSHES.register();
        let asked = std::thread::spawn(|| FLUSHES.request(Duration::from_secs(5)));
        while !registration.due() {
            std::thread::sleep(Duration::from_millis(1));
        }
        let t = Instant::now();
        drop(registration);
        assert!(asked.join().unwrap(), "answered by leaving");
        assert!(t.elapsed() < Duration::from_secs(2), "{:?}", t.elapsed());
    }

    #[test]
    fn a_recorder_registered_after_a_request_does_not_owe_it() {
        let flushes = Flushes::new();
        assert!(flushes.request(Duration::from_millis(10)));
        let registration = flushes.register();
        assert!(!registration.due());
    }
}
