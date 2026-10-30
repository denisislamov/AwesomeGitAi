//! Fixed local panel windows. Only main owns workspace state; detached windows
//! receive snapshots and submit a bounded allowlisted UI action mailbox.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
const PANELS: [&str; 4] = ["files", "code", "explanation", "git"];
const ACTIONS: [&str; 30] = [
    "git_action", "git_prepare", "git_apply", "git_dismiss", "git_cancel",
    "learning_mode", "learning_refresh", "learning_open", "learning_location", "trace_move", "trace_frame",
    "select_file",
    "select_tab",
    "close_tab",
    "select_commit",
    "select_branch",
    "load_more",
    "set_selection",
    "set_view",
    "refresh",
    "redock",
    "set_explanation_layout",
    "show_explanation",
    "open_commit_file",
    "compare_commits",
    "explanation_layout",
    "explain_detail",
    "review_decision",
    "refresh_explanations",
    "open_revision",
];
#[derive(Default)]
pub struct PanelBridge(Mutex<BridgeData>);
impl PanelBridge {
    pub fn allows_commit_details(
        &self,
        caller: &str,
        scope: &agai_protocol::RepoScope,
        oid: &str,
        base: Option<&str>,
    ) -> bool {
        if caller != "panel-git" {
            return false;
        }
        let Ok(data) = self.0.lock() else {
            return false;
        };
        let Some(state) = &data.state else {
            return false;
        };
        let workspace = &state["workspace"];
        if workspace["openingRepository"].as_bool() != Some(false) {
            return false;
        }
        let Ok(scope) = serde_json::to_value(scope) else {
            return false;
        };
        let repo = &workspace["repo"];
        if repo["repo_id"] != scope["repo_id"]
            || repo["worktree_id"] != scope["worktree_id"]
            || workspace["selectedCommit"].as_str() != Some(oid)
        {
            return false;
        }
        base.is_none_or(|base| {
            workspace["commits"]
                .as_array()
                .is_some_and(|commits| commits.iter().any(|c| c["oid"].as_str() == Some(base)))
        })
    }
}
#[derive(Default)]
struct BridgeData {
    revision: u64,
    state: Option<Value>,
    actions: Vec<PanelAction>,
    error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PanelAction {
    panel: String,
    action: String,
    payload: Value,
}
#[derive(Serialize)]
pub struct PanelSnapshot {
    revision: u64,
    state: Option<Value>,
}
fn label(panel: &str) -> Result<String, String> {
    if PANELS.contains(&panel) {
        Ok(format!("panel-{panel}"))
    } else {
        Err("INVALID_PANEL".into())
    }
}
fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("MAIN_WINDOW_REQUIRED".into())
    }
}
fn panel_caller(window: &WebviewWindow) -> Result<String, String> {
    let p = window
        .label()
        .strip_prefix("panel-")
        .ok_or("PANEL_WINDOW_REQUIRED")?;
    label(p)?;
    Ok(p.into())
}
fn validate_action(action: &str, payload: &Value) -> Result<(), String> {
    if !ACTIONS.contains(&action)
        || serde_json::to_vec(payload)
            .map_err(|_| "INVALID_PAYLOAD")?
            .len()
            > 65536
    {
        return Err("INVALID_PANEL_ACTION".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn open_panel(
    window: WebviewWindow,
    app: AppHandle,
    panel: String,
) -> Result<(), String> {
    main_only(&window)?;
    let name = label(&panel)?;
    if let Some(existing) = app.get_webview_window(&name) {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let opened = WebviewWindowBuilder::new(
        &app,
        &name,
        WebviewUrl::App(format!("index.html?panel={panel}").into()),
    )
    .title(format!("AwesomeGitAi — {panel}"))
    .inner_size(900., 700.)
    .min_inner_size(360., 300.)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    let geometry_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join(format!("{name}-geometry-v1.json")));
    restore_geometry(&opened, geometry_path.as_deref());
    if let Some(path) = geometry_path {
        remember_geometry(&opened, path);
    }
    Ok(())
}
#[tauri::command]
pub fn close_panel(window: WebviewWindow, app: AppHandle, panel: String) -> Result<(), String> {
    let name = label(&panel)?;
    if window.label() != "main" && window.label() != name {
        return Err("WINDOW_SCOPE_MISMATCH".into());
    }
    if let Some(target) = app.get_webview_window(&name) {
        target.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn list_panels(window: WebviewWindow, app: AppHandle) -> Result<Vec<String>, String> {
    main_only(&window)?;
    Ok(PANELS
        .iter()
        .filter(|p| app.get_webview_window(&format!("panel-{p}")).is_some())
        .map(|p| p.to_string())
        .collect())
}
#[tauri::command]
pub fn publish_panel_state(
    window: WebviewWindow,
    bridge: State<'_, PanelBridge>,
    state: Value,
) -> Result<(), String> {
    main_only(&window)?;
    if serde_json::to_vec(&state)
        .map_err(|_| "INVALID_STATE")?
        .len()
        > 16 * 1024 * 1024
    {
        let mut data = bridge.0.lock().map_err(|_| "PANEL_BRIDGE_UNAVAILABLE")?;
        data.state = None;
        data.error = Some("PANEL_STATE_TOO_LARGE".into());
        return Err("PANEL_STATE_TOO_LARGE".into());
    }
    let mut data = bridge.0.lock().map_err(|_| "PANEL_BRIDGE_UNAVAILABLE")?;
    data.revision = data.revision.wrapping_add(1);
    data.state = Some(state);
    data.error = None;
    Ok(())
}
#[tauri::command]
pub fn read_panel_state(
    app: AppHandle,
    window: WebviewWindow,
    bridge: State<'_, PanelBridge>,
    since_revision: Option<u64>,
) -> Result<PanelSnapshot, String> {
    panel_caller(&window)?;
    if app.get_webview_window("main").is_none() {
        return Err("MAIN_WINDOW_CLOSED".into());
    }
    let data = bridge.0.lock().map_err(|_| "PANEL_BRIDGE_UNAVAILABLE")?;
    if let Some(error) = &data.error {
        return Err(error.clone());
    }
    Ok(PanelSnapshot {
        revision: data.revision,
        state: if since_revision == Some(data.revision) {
            None
        } else {
            data.state.clone()
        },
    })
}
#[tauri::command]
pub fn send_panel_action(
    window: WebviewWindow,
    bridge: State<'_, PanelBridge>,
    action: String,
    payload: Value,
) -> Result<(), String> {
    let panel = panel_caller(&window)?;
    validate_action(&action, &payload)?;
    let mut data = bridge.0.lock().map_err(|_| "PANEL_BRIDGE_UNAVAILABLE")?;
    if data.actions.len() >= 128 {
        return Err("PANEL_ACTION_QUEUE_FULL".into());
    }
    data.actions.push(PanelAction {
        panel,
        action,
        payload,
    });
    Ok(())
}
#[tauri::command]
pub fn drain_panel_actions(
    window: WebviewWindow,
    bridge: State<'_, PanelBridge>,
) -> Result<Vec<PanelAction>, String> {
    main_only(&window)?;
    let mut data = bridge.0.lock().map_err(|_| "PANEL_BRIDGE_UNAVAILABLE")?;
    Ok(std::mem::take(&mut data.actions))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detached_git_reads_require_the_published_scope_and_selected_commit() {
        let bridge = PanelBridge::default();
        let scope:agai_protocol::RepoScope=serde_json::from_value(serde_json::json!({"repo_id":"00000000-0000-4000-8000-000000000001","worktree_id":"00000000-0000-4000-8000-000000000002"})).unwrap();
        bridge.0.lock().unwrap().state = Some(
            serde_json::json!({"workspace":{"repo":scope,"openingRepository":false,"selectedCommit":"selected","commits":[{"oid":"base"}]}}),
        );
        assert!(bridge.allows_commit_details("panel-git", &scope, "selected", Some("base")));
        assert!(!bridge.allows_commit_details("panel-code", &scope, "selected", None));
        assert!(!bridge.allows_commit_details("panel-git", &scope, "other", None));
        assert!(!bridge.allows_commit_details("panel-git", &scope, "selected", Some("unknown")));
        bridge.0.lock().unwrap().state.as_mut().unwrap()["workspace"]["openingRepository"] =
            Value::Bool(true);
        assert!(!bridge.allows_commit_details("panel-git", &scope, "selected", None));
    }
    #[test]
    fn remembered_window_requires_visible_valid_bounds() {
        let g = Geometry {
            x: -900,
            y: 100,
            width: 800,
            height: 600,
        };
        assert!(g.visible_in(-1920, 0, 1920, 1080));
        assert!(!g.visible_in(0, 0, 1920, 1080));
        assert!(
            !Geometry {
                x: 0,
                y: 0,
                width: 0,
                height: 600
            }
            .visible_in(0, 0, 1920, 1080)
        );
    }
    #[test]
    fn panel_names_cannot_supply_urls_or_arbitrary_labels() {
        for p in ["main", "../../x", "https://example.com", "code?x=1", ""] {
            assert!(label(p).is_err());
        }
        for p in PANELS {
            assert_eq!(label(p).unwrap(), format!("panel-{p}"));
        }
    }
    #[test]
    fn action_limits_reject_commands_and_excessive_payloads() {
        assert!(validate_action("select_file", &serde_json::json!({"id":"a"})).is_ok());
        assert!(validate_action("exec", &Value::Null).is_err());
        assert!(validate_action("select_file", &Value::String("x".repeat(65537))).is_err());
    }
}

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Geometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}
impl Geometry {
    fn visible_in(&self, x: i32, y: i32, width: u32, height: u32) -> bool {
        if self.width < 360 || self.height < 300 || self.width > 16000 || self.height > 16000 {
            return false;
        }
        let left = i64::from(self.x).max(i64::from(x));
        let right =
            (i64::from(self.x) + i64::from(self.width)).min(i64::from(x) + i64::from(width));
        let top = i64::from(self.y).max(i64::from(y));
        let bottom =
            (i64::from(self.y) + i64::from(self.height)).min(i64::from(y) + i64::from(height));
        right - left >= 160
            && bottom - top >= 100
            && i64::from(self.y) >= i64::from(y)
            && i64::from(self.y) < i64::from(y) + i64::from(height) - 50
    }
}
fn restore_geometry(window: &WebviewWindow, path: Option<&std::path::Path>) {
    let saved = path
        .and_then(|p| std::fs::read(p).ok())
        .filter(|b| b.len() < 4096)
        .and_then(|b| serde_json::from_slice::<Geometry>(&b).ok());
    if let Some(g) = saved {
        if window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .any(|m| {
                g.visible_in(
                    m.position().x,
                    m.position().y,
                    m.size().width,
                    m.size().height,
                )
            })
        {
            let _ = window.set_position(tauri::PhysicalPosition::new(g.x, g.y));
            let _ = window.set_size(tauri::PhysicalSize::new(g.width, g.height));
        }
    }
}
fn remember_geometry(window: &WebviewWindow, path: std::path::PathBuf) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let geometry = Mutex::new(Geometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    });
    window.on_window_event(move |event| {
        let Ok(mut g) = geometry.lock() else { return };
        match event {
            tauri::WindowEvent::Moved(p) => {
                g.x = p.x;
                g.y = p.y;
            }
            tauri::WindowEvent::Resized(s) => {
                if s.width >= 360 && s.height >= 300 {
                    g.width = s.width;
                    g.height = s.height;
                }
            }
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                if let Ok(bytes) = serde_json::to_vec(&*g) {
                    let _ = std::fs::write(&path, bytes);
                }
            }
            _ => {}
        }
    });
}
