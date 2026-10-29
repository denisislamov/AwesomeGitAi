mod bridge;
use agai_protocol::*;
use std::{process::Command, sync::Arc};
use tauri::Manager;
#[tauri::command]
async fn host_read(
    host: tauri::State<'_, Arc<bridge::DesktopHost>>,
    envelope: ReadEnvelope,
) -> Result<serde_json::Value> {
    envelope.meta.validate(false)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.request(&envelope))
        .await
        .map_err(|_| AppError::new("HOST_OFFLINE"))?
}
#[tauri::command]
async fn host_desktop(
    host: tauri::State<'_, Arc<bridge::DesktopHost>>,
    envelope: DesktopEnvelope,
) -> Result<serde_json::Value> {
    envelope.meta.validate(false)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.request(&envelope))
        .await
        .map_err(|_| AppError::new("HOST_OFFLINE"))?
}
#[tauri::command]
async fn open_external(
    host: tauri::State<'_, Arc<bridge::DesktopHost>>,
    root: String,
    path: Option<RepoPath>,
    target: String,
) -> Result<()> {
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
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let packaged = app.path().resource_dir()?.join("bin/agai-host");
            let binary = if packaged.exists() {
                packaged
            } else {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/agai-host")
            };
            app.manage(Arc::new(bridge::DesktopHost::new(
                data.join("host-profile"),
                binary,
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_read,
            host_desktop,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("Desktop startup failed");
}
