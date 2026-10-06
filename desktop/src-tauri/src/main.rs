// BotRacing tray app: a tray icon, a status line, and the Node sidecar that
// watches the telemetry folder and uploads. No windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;
mod status;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

const WEB_APP: &str = "https://botracing-61.web.app";

fn stop(slot: &mut Option<std::process::Child>) {
    if let Some(mut c) = slot.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = Arc::new(sidecar::paths(&app.path().resource_dir()?));
            let child = Arc::new(Mutex::new(sidecar::start(&paths).ok()));

            let status_item = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open BotRacing", true, None::<&str>)?;
            let pause =
                CheckMenuItem::with_id(app, "pause", "Pause uploads", true, false, None::<&str>)?;
            let folder = MenuItem::with_id(app, "folder", "Open data folder", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status_item,
                    &PredefinedMenuItem::separator(app)?,
                    &open,
                    &pause,
                    &folder,
                    &quit,
                ],
            )?;

            let (paths_menu, child_menu, pause_menu) =
                (paths.clone(), child.clone(), pause.clone());
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("BotRacing")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = tauri_plugin_opener::open_url(WEB_APP, None::<&str>);
                    }
                    "folder" => {
                        let _ = tauri_plugin_opener::open_path(&paths_menu.data, None::<&str>);
                    }
                    "pause" => {
                        let mut slot = child_menu.lock().unwrap();
                        if pause_menu.is_checked().unwrap_or(false) {
                            stop(&mut slot);
                        } else if slot.is_none() {
                            *slot = sidecar::start(&paths_menu).ok();
                        }
                    }
                    "quit" => {
                        stop(&mut child_menu.lock().unwrap());
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            std::thread::spawn(move || loop {
                let text = if pause.is_checked().unwrap_or(false) {
                    "Paused".to_string()
                } else {
                    let file = std::fs::read_to_string(paths.status_file()).unwrap_or_default();
                    status::line(status::last_beat(&file).as_ref())
                };
                let _ = status_item.set_text(text);
                std::thread::sleep(Duration::from_secs(5));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("BotRacing failed to start");
}
