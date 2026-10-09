// Windows: LMU's shared memory, read-only, and the single-recorder mutex.
//
// Never creates the mapping: OpenFileMappingW only opens the game's own, so a
// game that is not running leaves nothing behind. No lock and no frame
// events: LMU's lock is shared with the game's writer, and a reader holding it
// stalls the game; its frame events may be auto-reset, in which case waiting
// on them would take frames from other tools (SimHub, CrewChief). Frames are
// copied twice and kept only when both copies match (capture/frame.rs).

use crate::capture::frame::View;
use crate::capture::recorder::Source;
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, ERROR_ALREADY_EXISTS};
use windows_sys::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, VirtualQuery, FILE_MAP_READ,
    MEMORY_BASIC_INFORMATION,
};
use windows_sys::Win32::System::Threading::{
    CreateMutexW, GetCurrentThread, OpenEventA, SetThreadPriority, SYNCHRONIZATION_SYNCHRONIZE,
    THREAD_PRIORITY_BELOW_NORMAL,
};

const MAPPING: &str = "LMU_Data";
const HOLD_EVENT: &[u8] = b"LMU_Data_HoldEvent\0";
/// The Python recorder's mutex name: the two never record at once.
const MUTEX: &str = "Local\\lap-capture-recorder";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// This thread yields to the game, the VR compositor and SimHub.
pub fn lower_priority() {
    // SAFETY: the pseudo handle of the calling thread is always valid.
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

/// Held for the life of the tray's recorder.
pub struct RecorderLock(HANDLE);

// SAFETY: a mutex handle is a plain kernel object id, usable from any thread.
unsafe impl Send for RecorderLock {}

impl RecorderLock {
    /// None when another recorder (the Python one, or a second tray) holds it.
    pub fn acquire() -> Option<RecorderLock> {
        let name = wide(MUTEX);
        // SAFETY: `name` is NUL-terminated and outlives the call.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return None;
        }
        // SAFETY: reads the thread's last error right after the call above.
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            // SAFETY: handle came from CreateMutexW.
            unsafe { CloseHandle(handle) };
            return None;
        }
        Some(RecorderLock(handle))
    }
}

impl Drop for RecorderLock {
    fn drop(&mut self) {
        // SAFETY: handle came from CreateMutexW and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// The game is up with its shared memory: it holds its frame event open, and
/// once it exits the event is gone. (The mapping is no test: our own open view
/// would keep it alive.)
fn game_event_exists() -> bool {
    // SAFETY: HOLD_EVENT is NUL-terminated.
    let handle = unsafe { OpenEventA(SYNCHRONIZATION_SYNCHRONIZE, 0, HOLD_EVENT.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    // SAFETY: handle came from OpenEventA.
    unsafe { CloseHandle(handle) };
    true
}

pub struct Mapped {
    mapping: HANDLE,
    base: *const u8,
    len: usize,
}

// SAFETY: the view is read-only memory owned by this struct; reads copy out.
unsafe impl Send for Mapped {}

impl View for Mapped {
    fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
        let end = offset.checked_add(len)?;
        if end > self.len {
            return None;
        }
        // SAFETY: [offset, end) is inside the mapped view, which stays mapped
        // while `self` lives. The game writes it concurrently; a torn copy is
        // what the double read in frame.rs catches.
        let mut out = vec![0u8; len];
        unsafe { std::ptr::copy_nonoverlapping(self.base.add(offset), out.as_mut_ptr(), len) };
        Some(out)
    }
}

impl Drop for Mapped {
    fn drop(&mut self) {
        // SAFETY: both came from the calls in `open`, and are released once.
        unsafe {
            UnmapViewOfFile(windows_sys::Win32::System::Memory::MEMORY_MAPPED_VIEW_ADDRESS {
                Value: self.base as *mut c_void,
            });
            CloseHandle(self.mapping);
        }
    }
}

/// iRacing's telemetry map and the event it signals each tick (SDK names).
const IRSDK_MAPPING: &str = "Local\\IRSDKMemMapFileName";
const IRSDK_EVENT: &[u8] = b"Local\\IRSDKDataValidEvent\0";

/// The sim is up: its data event exists while it runs (the map file can outlive
/// the sim, and is zero-filled until a car is on track).
#[allow(dead_code)] // the recorder in the next step
pub fn iracing_running() -> bool {
    // SAFETY: IRSDK_EVENT is NUL-terminated.
    let handle = unsafe { OpenEventA(SYNCHRONIZATION_SYNCHRONIZE, 0, IRSDK_EVENT.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    // SAFETY: handle came from OpenEventA.
    unsafe { CloseHandle(handle) };
    true
}

/// iRacing's map, read-only, whole. Never creates it.
#[allow(dead_code)] // the recorder in the next step
pub fn open_iracing() -> Result<Mapped, String> {
    open_whole(IRSDK_MAPPING)
}

fn open_whole(mapping_name: &str) -> Result<Mapped, String> {
    let name = wide(mapping_name);
    // SAFETY: `name` is NUL-terminated and outlives the call.
    let mapping = unsafe { OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr()) };
    if mapping.is_null() {
        return Err(format!("{mapping_name} is not there (sim not running)"));
    }
    // SAFETY: `mapping` is a valid mapping handle; length 0 maps the whole file.
    let view = unsafe { MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0) };
    if view.Value.is_null() {
        // SAFETY: handle came from OpenFileMappingW.
        unsafe { CloseHandle(mapping) };
        return Err("the sim's mapping could not be mapped".into());
    }
    // SAFETY: an all-zero MEMORY_BASIC_INFORMATION is a valid out-parameter.
    let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: `view` is the base of the view just mapped; `info` is writable.
    let got = unsafe {
        VirtualQuery(view.Value, &mut info, std::mem::size_of::<MEMORY_BASIC_INFORMATION>())
    };
    let len = if got == 0 { 0 } else { info.RegionSize };
    if len == 0 {
        // SAFETY: both came from the calls above.
        unsafe {
            UnmapViewOfFile(view);
            CloseHandle(mapping);
        }
        return Err("the sim's mapping has no size".into());
    }
    Ok(Mapped { mapping, base: view.Value as *const u8, len })
}

pub struct Shm {
    /// The layout's size: the view must cover the whole header's struct.
    pub size: usize,
}

impl Source for Shm {
    type V = Mapped;

    fn game_running(&mut self) -> bool {
        game_event_exists()
    }

    fn open(&mut self) -> Result<Mapped, String> {
        let name = wide(MAPPING);
        // SAFETY: `name` is NUL-terminated and outlives the call.
        let mapping = unsafe { OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr()) };
        if mapping.is_null() {
            return Err("LMU_Data is not there (game not running)".into());
        }
        // SAFETY: `mapping` is a valid mapping handle opened above.
        let view = unsafe { MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, self.size) };
        if view.Value.is_null() {
            // SAFETY: handle came from OpenFileMappingW.
            unsafe { CloseHandle(mapping) };
            return Err("the game's mapping is smaller than its header says".into());
        }
        Ok(Mapped { mapping, base: view.Value as *const u8, len: self.size })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Memory::{CreateFileMappingW, PAGE_READWRITE};
    use windows_sys::Win32::System::Threading::CreateEventA;

    /// Stands in for the game: a mapping and a hold event under its names. Skips
    /// (passes) when a real game is running, so it never touches the real one.
    #[test]
    fn opens_the_games_mapping_read_only_and_never_creates_it() {
        let mut shm = Shm { size: 4096 };
        if shm.game_running() {
            return;
        }
        // No game: nothing to open, and opening did not create anything.
        assert!(shm.open().is_err());
        assert!(shm.open().is_err());

        let name = wide(MAPPING);
        // SAFETY: names are NUL-terminated; handles are closed below.
        let (map, event) = unsafe {
            let map = CreateFileMappingW(
                -1isize as HANDLE,
                std::ptr::null(),
                PAGE_READWRITE,
                0,
                4096,
                name.as_ptr(),
            );
            let event = CreateEventA(std::ptr::null(), 0, 0, HOLD_EVENT.as_ptr());
            (map, event)
        };
        assert!(!map.is_null() && !event.is_null());
        assert!(shm.game_running());
        let mut view = shm.open().expect("opens the mapping");
        assert_eq!(view.read(0, 8), Some(vec![0; 8]));
        assert_eq!(view.read(4090, 16), None);
        // A mapping smaller than the header says is refused.
        let mut big = Shm { size: 1 << 20 };
        assert!(big.open().is_err());
        drop(view);
        // SAFETY: handles came from the calls above.
        unsafe {
            CloseHandle(map);
            CloseHandle(event);
        }
        assert!(!shm.game_running());
    }

    /// Stands in for the sim: a zero-filled map under its name, as it leaves it
    /// until a car is on track. Skips when a real sim is up.
    #[test]
    fn opens_iracings_map_whole_and_a_zero_map_is_not_a_sim() {
        if iracing_running() || open_iracing().is_ok() {
            return;
        }
        let name = wide(IRSDK_MAPPING);
        // SAFETY: the name is NUL-terminated; the handle is closed below.
        let map = unsafe {
            CreateFileMappingW(
                -1isize as HANDLE,
                std::ptr::null(),
                PAGE_READWRITE,
                0,
                8192,
                name.as_ptr(),
            )
        };
        assert!(!map.is_null());
        let mut view = open_iracing().expect("opens the map");
        assert!(view.read(0, 8192).is_some(), "maps the whole file");
        assert!(view.read(8190, 16).is_none());
        assert!(crate::capture::irsdk::Reader::open(&mut view).is_none());
        drop(view);
        // SAFETY: the handle came from CreateFileMappingW.
        unsafe { CloseHandle(map) };
        assert!(open_iracing().is_err());
    }

    #[test]
    fn a_second_holder_of_the_recorder_mutex_is_refused() {
        let first = RecorderLock::acquire();
        if first.is_none() {
            return; // a real recorder is running on this PC
        }
        assert!(RecorderLock::acquire().is_none());
        drop(first);
        assert!(RecorderLock::acquire().is_some());
    }
}
