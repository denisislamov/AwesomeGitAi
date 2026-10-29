#[tauri::command]
fn hello() -> serde_json::Value {
    let git = std::process::Command::new("git").arg("--version").output();
    serde_json::json!({"schemaVersion":1,"git":git.ok().filter(|r|r.status.success()).map(|r|String::from_utf8_lossy(&r.stdout).trim().to_owned())})
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![hello])
        .run(tauri::generate_context!()).expect("probe failed");
}
