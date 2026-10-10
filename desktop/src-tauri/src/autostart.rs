// Start with Windows: one value under HKCU\Software\Microsoft\Windows\
// CurrentVersion\Run, the way a per-user app does it (no admin, no task).
//
// Always on, with no menu item: every launch makes sure the Run value points
// at this exe (it moves on an update). The installer's uninstall removes the
// value too (windows/hooks.nsh).
//
// Task Manager's Startup tab does not delete the Run value: it writes
// HKCU\...\Explorer\StartupApproved\Run\BotRacing (first byte odd =
// disabled). That is the person's own opt-out and now the only one, so
// nothing here reads or clears it: `RunStore` has no method for it.
//
// `RunStore` is the registry; the tests use a fake, so every rule is tested
// without touching a real Run key.
use std::path::Path;

pub const VALUE_NAME: &str = "BotRacing";

pub trait RunStore {
    fn get(&self) -> Option<String>;
    fn set(&self, command: &str) -> Result<(), String>;
}

/// The argument a logon start carries: the tray starts without opening its
/// window (a start from the Start menu or a shortcut opens it).
pub const BACKGROUND_ARG: &str = "--background";

/// The exe's path without the verbatim `\\?\` form Windows can hand back for a
/// long or canonicalized path: Explorer reads the Run value at logon and does
/// not take that prefix (the 0.1.2 bug class). A UNC path keeps its prefix.
fn plain_path(exe: &Path) -> String {
    let text = exe.display().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => rest.to_string(),
        _ => text,
    }
}

/// What the Run value holds: the exe, quoted (a path with spaces would
/// otherwise start the wrong program), and the background flag.
pub fn command_for(exe: &Path) -> String {
    format!("\"{}\" {BACKGROUND_ARG}", plain_path(exe))
}

/// Makes sure the Run value is this exe's command. An error is the registry
/// refusing, shown in the problems line.
pub fn ensure_on(store: &dyn RunStore, exe: &Path) -> Result<(), String> {
    let wanted = command_for(exe);
    if store.get().as_deref() != Some(&wanted) {
        store.set(&wanted)?;
    }
    Ok(())
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
}

#[cfg(windows)]
mod registry {
    use super::{Registry, RunStore, VALUE_NAME};
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
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

    impl RunStore for Registry {
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
    }

    fn exe() -> PathBuf {
        PathBuf::from(r"C:\Users\A B\AppData\Local\BotRacing\botracing.exe")
    }

    #[test]
    fn the_command_is_the_exe_in_quotes() {
        assert_eq!(
            command_for(&exe()),
            r#""C:\Users\A B\AppData\Local\BotRacing\botracing.exe" --background"#
        );
    }

    #[test]
    fn a_start_with_no_value_turns_it_on() {
        let store = Fake::default();
        assert_eq!(ensure_on(&store, &exe()), Ok(()));
        assert_eq!(store.get(), Some(command_for(&exe())));
    }

    #[test]
    fn the_verbatim_path_form_never_reaches_the_run_value() {
        let verbatim =
            PathBuf::from(r"\\?\C:\Users\Test Ünïcode\AppData\Local\BotRacing\botracing.exe");
        assert_eq!(
            command_for(&verbatim),
            r#""C:\Users\Test Ünïcode\AppData\Local\BotRacing\botracing.exe" --background"#
        );
        let unc = PathBuf::from(r"\\?\UNC\host\share\botracing.exe");
        assert_eq!(command_for(&unc), r#""\\?\UNC\host\share\botracing.exe" --background"#);
    }

    #[test]
    fn a_moved_exe_is_rewritten() {
        let store = Fake::default();
        *store.value.borrow_mut() = Some(r#""C:\old\botracing.exe""#.into());
        assert_eq!(ensure_on(&store, &exe()), Ok(()));
        assert_eq!(store.get(), Some(command_for(&exe())));
    }

    // The Task Manager switch (StartupApproved) is the person's own opt-out.
    // `RunStore` has no method that reads or clears it, so a start cannot turn
    // a disabled entry back on: only the Run value is ever written.
    #[test]
    fn a_start_writes_only_the_run_value_and_only_when_it_differs() {
        let store = Fake::default();
        ensure_on(&store, &exe()).unwrap();
        let after_first = store.get();
        ensure_on(&store, &exe()).unwrap();
        assert_eq!(store.get(), after_first);
    }

    #[test]
    fn a_refusing_registry_is_an_error_not_a_panic() {
        let store = Fake {
            refuse: true,
            ..Default::default()
        };
        assert_eq!(ensure_on(&store, &exe()), Err("refused".into()));
    }
}
