mod bridge;
mod integration;
mod menus;
mod windows;
use agai_protocol::*;
use std::{process::Command, sync::Arc};
use tauri::Manager;
#[tauri::command]
async fn host_read(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Arc<bridge::DesktopHost>>,
    envelope: ReadEnvelope,
) -> Result<serde_json::Value> {
    if window.label() != "main" {
        return Err(AppError::new("MAIN_WINDOW_REQUIRED"));
    }
    envelope.meta.validate(false)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.request(&envelope))
        .await
        .map_err(|_| AppError::new("HOST_OFFLINE"))?
}
#[tauri::command]
async fn host_desktop(
    window: tauri::WebviewWindow,
    panels: tauri::State<'_, windows::PanelBridge>,
    host: tauri::State<'_, Arc<bridge::DesktopHost>>,
    envelope: DesktopEnvelope,
) -> Result<serde_json::Value> {
    if window.label() != "main" {
        match &envelope.desktop {
            DesktopRequest::CommitDetails { scope, oid, base }
                if panels.allows_commit_details(window.label(), scope, oid, base.as_deref()) => {}
            _ => return Err(AppError::new("PANEL_SCOPE_DENIED")),
        }
    }
    envelope.meta.validate(false)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.request(&envelope))
        .await
        .map_err(|_| AppError::new("HOST_OFFLINE"))?
}
#[tauri::command]
async fn open_external(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Arc<bridge::DesktopHost>>,
    root: String,
    path: Option<RepoPath>,
    target: String,
) -> Result<()> {
    if window.label() != "main" {
        return Err(AppError::new("MAIN_WINDOW_REQUIRED"));
    }
    let app = match target.as_str() {
        "ide" => "Rider",
        "terminal" => "Terminal",
        _ => return Err(AppError::new("INVALID_REQUEST")),
    };
    if target == "terminal" && path.is_some() {
        return Err(AppError::new("INVALID_REQUEST"));
    }
    let resolved = host.external_path(&root, path.as_ref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let status = Command::new("/usr/bin/open")
            .args(["-a", app, "--"])
            .arg(resolved)
            .status()
            .map_err(|_| AppError::new("EXTERNAL_APP_UNAVAILABLE"))?;
        if status.success() {
            Ok(())
        } else {
            Err(AppError::new("EXTERNAL_APP_UNAVAILABLE"))
        }
    })
    .await
    .map_err(|_| AppError::new("EXTERNAL_APP_UNAVAILABLE"))?
}
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            menus::install(app.handle())?;
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let packaged = app.path().resource_dir()?.join("bin/agai-host");
            let binary = if packaged.exists() {
                packaged
            } else {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/agai-host")
            };
            app.manage(windows::PanelBridge::default());
            app.manage(Arc::new(bridge::DesktopHost::new(
                data.join("host-profile"),
                binary,
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_read,
            host_desktop,
            open_external,
            integration::integration_config,
            windows::open_panel,
            windows::close_panel,
            windows::list_panels,
            windows::publish_panel_state,
            windows::read_panel_state,
            windows::send_panel_action,
            windows::drain_panel_actions
        ])
        .build(tauri::generate_context!())
        .expect("Desktop startup failed")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
            {
                if label == "main" {
                    for (label, window) in app.webview_windows() {
                        if label.starts_with("panel-") {
                            let _ = window.destroy();
                        }
                    }
                    app.exit(0);
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(host) = app.try_state::<Arc<bridge::DesktopHost>>() {
                    host.shutdown();
                }
            }
        });
}
