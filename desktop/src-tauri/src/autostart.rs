// Start with Windows: one value under HKCU\Software\Microsoft\Windows\
// CurrentVersion\Run, the way a per-user app does it (no admin, no task).
//
// On by default: the first launch with no recorded choice turns it on and
// records that; a person who unchecks the menu item stays off, including
// after an update. The value is rewritten on launch when the exe moved.
// The uninstaller removes the value too (windows/hooks.nsh).
//
// Task Manager's Startup tab does not delete the Run value: it writes
// HKCU\...\Explorer\StartupApproved\Run\BotRacing (first byte odd = disabled).
// "On" therefore means the Run value is there AND not disabled there.
// Turning it on from the menu clears that entry; the launch-time check never
// does, so a person who switched it off in Task Manager stays off.
//
// `RunStore` is the registry; the tests use a fake, so every rule is tested
// without touching a real Run key.
use std::path::Path;

pub const VALUE_NAME: &str = "BotRacing";

pub trait RunStore {
    fn get(&self) -> Option<String>;
    fn set(&self, command: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
    /// False when Task Manager (StartupApproved) has switched the entry off.
    fn approved(&self) -> bool;
    /// Removes the StartupApproved entry (Windows reads "no entry" as enabled).
    fn approve(&self) -> Result<(), String>;
}

/// StartupApproved\Run data: first byte 02/06 = enabled, 03/07 = disabled.
pub fn disabled_by_windows(data: &[u8]) -> bool {
    data.first().is_some_and(|b| b & 1 == 1)
}

/// What the Run value holds: the exe, plain (crate::paths) and quoted (a path
/// with spaces would otherwise start the wrong program).
pub fn command_for(exe: &Path) -> String {
    format!("\"{}\"", crate::paths::plain(exe).display())
}

/// Brings the Run value in line with the recorded choice (`None` = never
/// chosen, which means on). Returns the choice now in force, for the caller
/// to record; an error is the registry refusing, shown in the status line.
pub fn reconcile(choice: Option<bool>, store: &dyn RunStore, exe: &Path) -> Result<bool, String> {
    let want = choice.unwrap_or(true);
    let wanted = command_for(exe);
    let now = store.get();
    if want {
        if now.as_deref() != Some(&wanted) {
            store.set(&wanted)?;
        }
    } else if now.is_some() {
        store.delete()?;
    }
    Ok(want)
}

/// The menu toggle: sets the choice and the registry together; turning it on
/// also clears a Task Manager "disabled".
pub fn set(enabled: bool, store: &dyn RunStore, exe: &Path) -> Result<(), String> {
    reconcile(Some(enabled), store, exe)?;
    if enabled {
        store.approve()?;
    }
    Ok(())
}

/// Whether Windows will start it at logon now (the menu check mark).
pub fn is_on(store: &dyn RunStore) -> bool {
    store.get().is_some() && store.approved()
}

#[cfg(windows)]
pub struct Registry;

/// Off Windows there is no Run key; the tray is Windows-only, this only lets
/// the crate build for the tests elsewhere.
#[cfg(not(windows))]
pub struct Registry;

#[cfg(not(windows))]
impl RunStore for Registry {
    fn get(&self) -> Option<String> {
        None
    }
    fn set(&self, _: &str) -> Result<(), String> {
        Err("Start with Windows needs Windows".into())
    }
    fn delete(&self) -> Result<(), String> {
        Ok(())
    }
    fn approved(&self) -> bool {
        true
    }
    fn approve(&self) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(windows)]
mod registry {
    use super::{Registry, RunStore, VALUE_NAME};
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY, REG_OPTION_NON_VOLATILE,
        REG_SZ,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    fn open() -> Result<HKEY, String> {
        let mut key: HKEY = null_mut();
        let path = wide(RUN);
        // SAFETY: valid NUL-terminated path, a valid out pointer.
        let code = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                path.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                KEY_QUERY_VALUE | KEY_SET_VALUE,
                null(),
                &mut key,
                null_mut(),
            )
        };
        if code == ERROR_SUCCESS {
            Ok(key)
        } else {
            Err(format!("Windows refused the Run key (error {code})"))
        }
    }

    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    fn open_approved(access: u32) -> Option<HKEY> {
        let mut key: HKEY = null_mut();
        let path = wide(APPROVED);
        // SAFETY: valid NUL-terminated path, a valid out pointer.
        let code = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                path.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                access,
                null(),
                &mut key,
                null_mut(),
            )
        };
        (code == ERROR_SUCCESS).then_some(key)
    }

    impl RunStore for Registry {
        fn approved(&self) -> bool {
            let Some(key) = open_approved(KEY_QUERY_VALUE) else {
                return true;
            };
            let name = wide(VALUE_NAME);
            let mut kind = 0u32;
            let mut buf = [0u8; 16];
            let mut len = buf.len() as u32;
            // SAFETY: buf is `len` bytes.
            let code = unsafe {
                RegQueryValueExW(
                    key,
                    name.as_ptr(),
                    null(),
                    &mut kind,
                    buf.as_mut_ptr(),
                    &mut len,
                )
            };
            // SAFETY: key came from RegCreateKeyExW.
            unsafe { RegCloseKey(key) };
            // No entry (or an unreadable one) is enabled.
            !(code == ERROR_SUCCESS && kind == REG_BINARY && super::disabled_by_windows(&buf[..len as usize]))
        }

        fn approve(&self) -> Result<(), String> {
            let Some(key) = open_approved(KEY_SET_VALUE) else {
                return Ok(());
            };
            let name = wide(VALUE_NAME);
            // SAFETY: valid key and NUL-terminated name.
            let code = unsafe { RegDeleteValueW(key, name.as_ptr()) };
            // SAFETY: key came from RegCreateKeyExW.
            unsafe { RegCloseKey(key) };
            if code == ERROR_SUCCESS || code == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                Err(format!("Can't clear the Task Manager switch (error {code})"))
            }
        }

        fn get(&self) -> Option<String> {
            let key = open().ok()?;
            let name = wide(VALUE_NAME);
            let mut kind = 0u32;
            let mut len = 0u32;
            // SAFETY: first call only asks for the size.
            let code = unsafe {
                RegQueryValueExW(key, name.as_ptr(), null(), &mut kind, null_mut(), &mut len)
            };
            let value = if code == ERROR_SUCCESS && kind == REG_SZ && len > 0 {
                let mut buf = vec![0u16; (len as usize).div_ceil(2)];
                // SAFETY: buf holds at least `len` bytes.
                let code = unsafe {
                    RegQueryValueExW(
                        key,
                        name.as_ptr(),
                        null(),
                        &mut kind,
                        buf.as_mut_ptr() as *mut u8,
                        &mut len,
                    )
                };
                (code == ERROR_SUCCESS)
                    .then(|| String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string())
            } else {
                None
            };
            // SAFETY: key came from RegCreateKeyExW.
            unsafe { RegCloseKey(key) };
            value
        }

        fn set(&self, command: &str) -> Result<(), String> {
            let key = open()?;
            let name = wide(VALUE_NAME);
            let data = wide(command);
            // SAFETY: data is a NUL-terminated UTF-16 buffer of the given byte length.
            let code = unsafe {
                RegSetValueExW(
                    key,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    data.as_ptr() as *const u8,
                    (data.len() * 2) as u32,
                )
            };
            // SAFETY: key came from RegCreateKeyExW.
            unsafe { RegCloseKey(key) };
            if code == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(format!("Can't set Start with Windows (error {code})"))
            }
        }

        fn delete(&self) -> Result<(), String> {
            let key = open()?;
            let name = wide(VALUE_NAME);
            // SAFETY: valid key and NUL-terminated name.
            let code = unsafe { RegDeleteValueW(key, name.as_ptr()) };
            // SAFETY: key came from RegCreateKeyExW.
            unsafe { RegCloseKey(key) };
            if code == ERROR_SUCCESS || code == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                Err(format!("Can't turn off Start with Windows (error {code})"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    #[derive(Default)]
    struct Fake {
        value: RefCell<Option<String>>,
        disabled: RefCell<bool>,
        refuse: bool,
    }
    impl RunStore for Fake {
        fn get(&self) -> Option<String> {
            self.value.borrow().clone()
        }
        fn set(&self, command: &str) -> Result<(), String> {
            if self.refuse {
                return Err("refused".into());
            }
            *self.value.borrow_mut() = Some(command.to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            if self.refuse {
                return Err("refused".into());
            }
            *self.value.borrow_mut() = None;
            Ok(())
        }
        fn approved(&self) -> bool {
            !*self.disabled.borrow()
        }
        fn approve(&self) -> Result<(), String> {
            *self.disabled.borrow_mut() = false;
            Ok(())
        }
    }

    fn exe() -> PathBuf {
        PathBuf::from(r"C:\Users\A B\AppData\Local\BotRacing\botracing.exe")
    }

    #[test]
    fn the_command_is_the_exe_in_quotes() {
        assert_eq!(
            command_for(&exe()),
            r#""C:\Users\A B\AppData\Local\BotRacing\botracing.exe""#
        );
        // A verbatim exe (Tauri's canonical form) is written plain, the same value.
        #[cfg(windows)]
        assert_eq!(
            command_for(Path::new(r"\\?\C:\Users\A B\AppData\Local\BotRacing\botracing.exe")),
            command_for(&exe())
        );
    }

    #[test]
    fn never_chosen_means_on() {
        let store = Fake::default();
        assert_eq!(reconcile(None, &store, &exe()), Ok(true));
        assert_eq!(store.get(), Some(command_for(&exe())));
    }

    #[test]
    fn an_unchecked_choice_stays_off_and_removes_the_value() {
        let store = Fake::default();
        *store.value.borrow_mut() = Some("old".into());
        assert_eq!(reconcile(Some(false), &store, &exe()), Ok(false));
        assert_eq!(store.get(), None);
        // Run again (an update's first launch): still off, nothing written.
        assert_eq!(reconcile(Some(false), &store, &exe()), Ok(false));
        assert_eq!(store.get(), None);
    }

    #[test]
    fn a_moved_exe_is_rewritten_when_on() {
        let store = Fake::default();
        *store.value.borrow_mut() = Some(r#""C:\old\botracing.exe""#.into());
        assert_eq!(reconcile(Some(true), &store, &exe()), Ok(true));
        assert_eq!(store.get(), Some(command_for(&exe())));
    }

    #[test]
    fn the_toggle_sets_and_clears() {
        let store = Fake::default();
        set(true, &store, &exe()).unwrap();
        assert!(is_on(&store));
        set(false, &store, &exe()).unwrap();
        assert!(!is_on(&store));
    }

    #[test]
    fn disabled_in_task_manager_reads_as_off_and_the_launch_check_leaves_it() {
        assert!(disabled_by_windows(&[3, 0, 0, 0]));
        assert!(disabled_by_windows(&[7, 0]));
        assert!(!disabled_by_windows(&[2, 0, 0, 0]));
        assert!(!disabled_by_windows(&[6]));
        assert!(!disabled_by_windows(&[]));
        let store = Fake::default();
        reconcile(Some(true), &store, &exe()).unwrap();
        *store.disabled.borrow_mut() = true;
        assert!(!is_on(&store), "the Run value is there but Windows has it off");
        // A launch (or an update) keeps the person's choice made in Task Manager.
        reconcile(Some(true), &store, &exe()).unwrap();
        assert!(!is_on(&store));
        // The menu turns it on again and clears the switch.
        set(true, &store, &exe()).unwrap();
        assert!(is_on(&store));
    }

    #[test]
    fn a_refusing_registry_is_an_error_not_a_panic() {
        let store = Fake {
            refuse: true,
            ..Default::default()
        };
        assert_eq!(reconcile(None, &store, &exe()), Err("refused".into()));
        assert_eq!(set(false, &store, &exe()), Ok(()), "nothing to remove");
    }
}
