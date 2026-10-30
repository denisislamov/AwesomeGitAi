use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem, Submenu},
};
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    for (title, commands) in [
        (
            "File",
            vec![
                ("repo-open", "Open Repository…", Some("CmdOrCtrl+O")),
                ("repo-create", "Init / Clone…", None),
            ],
        ),
        (
            "Git",
            vec![
                ("git-commit", "Commit…", None),
                ("git-branches", "Branches…", None),
                ("git-remotes", "Remotes…", None),
            ],
        ),
        ("Agent", vec![("agent-connect", "Connect MCP…", None)]),
        (
            "View",
            vec![
                ("editor-options", "Editor Options…", None),
                ("memory", "Project Memory…", None),
                ("panels", "Panels…", None),
                ("appearance", "Appearance…", None),
            ],
        ),
    ] {
        let existing = menu
            .items()?
            .into_iter()
            .filter_map(|i| i.as_submenu().cloned())
            .find(|s| s.text().ok().as_deref() == Some(title));
        let submenu = match existing {
            Some(s) => s,
            None => {
                let s = Submenu::new(app, title, true)?;
                let position = menu.items()?.len().saturating_sub(2);
                menu.insert(&s, position)?;
                s
            }
        };
        for (index, (id, label, accelerator)) in commands.into_iter().enumerate() {
            submenu.insert(
                &MenuItem::with_id(app, id, label, true, accelerator)?,
                index,
            )?;
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if [
            "repo-open",
            "repo-create",
            "git-commit",
            "git-branches",
            "git-remotes",
            "agent-connect",
            "editor-options",
            "memory",
            "panels",
            "appearance",
        ]
        .contains(&id)
        {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("workspace-command", id);
            }
        }
    });
    Ok(())
}
