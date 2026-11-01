//! Fixed local panel windows. Only main owns workspace state; detached windows
//! receive snapshots and submit a bounded allowlisted UI action mailbox.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
const PANELS: [&str; 4] = ["files", "code", "explanation", "git"];
const ACTIONS: [&str; 34] = [
    "git_action", "git_prepare", "git_apply", "git_dismiss", "git_cancel",
    "learning_mode", "learning_refresh", "learning_open", "learning_location", "trace_move", "trace_frame",
    "relations_load", "relations_show", "relation_location", "relations_back",
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
        if !matches!(caller, "panel-git" | "panel-files") {
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
        {
            return false;
        }
        if caller == "panel-files" {
            let selected = &workspace["filesCommit"];
            if selected.is_object() {
                return selected["oid"].as_str() == Some(oid)
                    && selected["base"].as_str() == base;
            }
            // An opened historical tab may have a parent outside the loaded log.
            // Authorize only its exact published pair, never an arbitrary base.
            return workspace["tabs"].as_array().is_some_and(|tabs| {
                tabs.iter().any(|tab| {
                    tab["id"].is_string()
                        && tab["id"] == workspace["activeTab"]
                        && tab["target"]["Commit"]["oid"].as_str() == Some(oid)
                        && match base {
                            Some(base) => tab["base"]["Commit"]["oid"].as_str() == Some(base),
                            None => tab["base"].as_str() == Some("Empty"),
                        }
                })
            });
        }
        if workspace["selectedCommit"].as_str() != Some(oid) {
            return false;
        }
        base.is_none_or(|base| {
            workspace["selectedCommitBase"].as_str() == Some(base) || workspace["commits"]
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
    if let Some(path) = geometry_path {
        restore_and_track_geometry(&opened, path);
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
    fn detached_git_accepts_only_published_restored_base_outside_history_page() {
        let bridge = PanelBridge::default();
        let scope: agai_protocol::RepoScope = serde_json::from_value(serde_json::json!({"repo_id":"00000000-0000-4000-8000-000000000001","worktree_id":"00000000-0000-4000-8000-000000000002"})).unwrap();
        bridge.0.lock().unwrap().state = Some(serde_json::json!({"workspace":{
            "repo":scope,"openingRepository":false,"selectedCommit":"selected",
            "selectedCommitBase":"outside-page","commits":[{"oid":"selected"}]
        }}));
        assert!(bridge.allows_commit_details("panel-git", &scope, "selected", Some("outside-page")));
        assert!(!bridge.allows_commit_details("panel-git", &scope, "selected", Some("arbitrary")));
        assert!(!bridge.allows_commit_details("panel-git", &scope, "other", Some("outside-page")));
    }
    #[test]
    fn detached_files_reads_only_the_published_file_comparison() {
        let bridge = PanelBridge::default();
        let scope: agai_protocol::RepoScope = serde_json::from_value(serde_json::json!({"repo_id":"00000000-0000-4000-8000-000000000001","worktree_id":"00000000-0000-4000-8000-000000000002"})).unwrap();
        bridge.0.lock().unwrap().state = Some(serde_json::json!({"workspace":{
            "repo":scope,"openingRepository":false,
            "filesCommit":{"oid":"selected","base":null},
            "activeTab":"t","tabs":[{"id":"t","base":{"Commit":{"oid":"old"}},"target":{"Commit":{"oid":"open"}}}]
        }}));
        assert!(bridge.allows_commit_details("panel-files", &scope, "selected", None));
        assert!(!bridge.allows_commit_details("panel-files", &scope, "selected", Some("other")));
        assert!(!bridge.allows_commit_details("panel-files", &scope, "open", Some("old")));
        bridge.0.lock().unwrap().state.as_mut().unwrap()["workspace"]["filesCommit"] = Value::Null;
        assert!(bridge.allows_commit_details("panel-files", &scope, "open", Some("old")));
        assert!(!bridge.allows_commit_details("panel-files", &scope, "open", None));
        assert!(!bridge.allows_commit_details("panel-files", &scope, "other", Some("old")));
        let other = agai_protocol::RepoScope { repo_id: uuid::Uuid::new_v4(), worktree_id: scope.worktree_id };
        assert!(!bridge.allows_commit_details("panel-files", &other, "open", Some("old")));
    }
    #[test]
    fn remembered_window_requires_visible_valid_bounds() {
        let g = Geometry {
            x: -900,
            y: 100,
            width: 800,
            height: 600,
            maximized: false,
            fullscreen: false,
            scale_factor: 1.0,
        };
        assert!(g.visible_in(-1920, 0, 1920, 1080));
        assert!(!g.visible_in(0, 0, 1920, 1080));
        assert!(
            !Geometry {
                x: 0,
                y: 0,
                width: 0,
                height: 600,
                ..g
            }
            .visible_in(0, 0, 1920, 1080)
        );
    }
    #[test]
    fn legacy_geometry_defaults_to_normal_window_and_round_trips_modes() {
        let mut g: Geometry = serde_json::from_str(r#"{"x":20,"y":40,"width":900,"height":700}"#).unwrap();
        assert!(!g.maximized && !g.fullscreen);
        g.fullscreen = true;
        let saved = serde_json::to_vec(&g).unwrap();
        let restored: Geometry = serde_json::from_slice(&saved).unwrap();
        assert!(restored.fullscreen);
        assert_eq!((restored.x, restored.y, restored.width, restored.height), (20,40,900,700));
    }
    #[test]
    fn retina_bounds_restore_the_same_logical_size_on_another_monitor() {
        let g: Geometry = serde_json::from_str(r#"{"x":20,"y":40,"width":2880,"height":1920,"scale_factor":2}"#).unwrap();
        let size = g.logical_size();
        assert_eq!((size.width, size.height), (1440.0, 960.0));
        let legacy: Geometry = serde_json::from_str(r#"{"x":20,"y":40,"width":900,"height":700}"#).unwrap();
        assert_eq!(legacy.logical_size().width, 900.0);
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
        for action in ["relations_load", "relations_show", "relation_location", "relations_back"] {
            assert!(validate_action(action, &Value::Null).is_ok());
        }
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
    #[serde(default = "default_scale")]
    scale_factor: f64,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}
fn default_scale() -> f64 { 1.0 }
impl Geometry {
    fn logical_size(&self) -> tauri::LogicalSize<f64> {
        let scale = if self.scale_factor.is_finite() && (0.5..=8.0).contains(&self.scale_factor) { self.scale_factor } else { 1.0 };
        tauri::LogicalSize::new(f64::from(self.width) / scale, f64::from(self.height) / scale)
    }
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
// Save normal bounds separately from display modes, so leaving fullscreen is
// useful after restoration. Old geometry files intentionally remain readable.
pub fn restore_and_track_geometry(window: &WebviewWindow, path: std::path::PathBuf) {
    let Ok(position) = window.outer_position() else { return };
    let Ok(size) = window.inner_size() else { return };
    let mut initial = Geometry {
        x: position.x, y: position.y, width: size.width, height: size.height,
        maximized: false, fullscreen: false, scale_factor: window.scale_factor().unwrap_or(1.0),
    };
    let saved = std::fs::read(&path).ok()
        .filter(|b| b.len() < 4096)
        .and_then(|b| serde_json::from_slice::<Geometry>(&b).ok());
    if let Some(g) = saved {
        if window.available_monitors().unwrap_or_default().iter().any(|m| {
            g.visible_in(m.position().x, m.position().y, m.size().width, m.size().height)
        }) {
            initial = g;
            let _ = window.set_position(tauri::PhysicalPosition::new(g.x, g.y));
            let _ = window.set_size(g.logical_size());
            if g.maximized { let _ = window.maximize(); }
            if g.fullscreen { let _ = window.set_fullscreen(true); }
        }
    }
    let geometry = Mutex::new(initial);
    let tracked = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Focused(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }) { return; }
        let Ok(mut g) = geometry.lock() else { return };
        let maximized = tracked.is_maximized().unwrap_or(g.maximized);
        let fullscreen = tracked.is_fullscreen().unwrap_or(g.fullscreen);
        g.maximized = maximized;
        g.fullscreen = fullscreen;
        if !maximized && !fullscreen {
            // Query current bounds together: scale/monitor transitions may not
            // emit both Moved and Resized before the first focus or Quit.
            if let (Ok(p), Ok(s), Ok(scale)) =
                (tracked.outer_position(), tracked.inner_size(), tracked.scale_factor()) {
                if s.width >= 360 && s.height >= 300 {
                    g.x = p.x; g.y = p.y; g.width = s.width; g.height = s.height;
                    g.scale_factor = scale;
                }
            }
        }
        // Persist as the user arranges windows, not just on CloseRequested:
        // macOS Quit may destroy all WebViews without that event.
        if let Ok(bytes) = serde_json::to_vec(&*g) {
            let temp = path.with_extension("tmp");
            if std::fs::write(&temp, bytes).is_ok() { let _ = std::fs::rename(temp, &path); }
        }
    });
}
