#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the Node.js backend server as a sidecar process
            let sidecar = app.shell().sidecar("server")
                .expect("failed to create sidecar command")
                .args(&["--parent-pid", &std::process::id().to_string()]);
            let (mut rx, _child) = sidecar.spawn()
                .expect("failed to spawn server sidecar");

            // Log sidecar stdout/stderr in background
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let s = String::from_utf8_lossy(&line);
                            println!("[server] {}", s);
                        }
                        CommandEvent::Stderr(line) => {
                            let s = String::from_utf8_lossy(&line);
                            eprintln!("[server] {}", s);
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[server] process terminated: {:?}", status);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
