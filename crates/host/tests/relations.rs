use agai_protocol::*;
#[test]
fn relations_wire_contract_is_typed() {
    let request = serde_json::json!({"kind":"CodeRelations","scope":{"repo_id":uuid::Uuid::nil(),"worktree_id":uuid::Uuid::nil()},"snapshot_id":uuid::Uuid::nil(),"path":RepoPath::from_bytes(b"code.ts").unwrap()});
    assert!(serde_json::from_value::<DesktopRequest>(request).is_ok());
}
fn git(root: &std::path::Path, args: &[&str]) {
    assert!(
        std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .unwrap()
            .status
            .success()
    );
}
#[test]
fn scoped_capture_expands_only_while_original_generation_matches() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    std::fs::create_dir(&root).unwrap();
    git(&root, &["init", "-q"]);
    std::fs::write(root.join("a.ts"), "export const value = 1;\n").unwrap();
    std::fs::write(
        root.join("b.ts"),
        "import {value} from './a';\nconsole.log(value);\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("outside.ts"), "SECRET").unwrap();
    std::os::unix::fs::symlink(dir.path().join("outside.ts"), root.join("link.ts")).unwrap();
    let mut host =
        agai_host::HostService::new(agai_storage::Store::open(&dir.path().join("db")).unwrap());
    let state = host.register_repository(&root).unwrap();
    let scope = RepoScope {
        repo_id: state.repo_id,
        worktree_id: state.worktree_id,
    };
    let path = RepoPath::from_bytes(b"a.ts").unwrap();
    let generation = host
        .prepare_capture(scope.repo_id, scope.worktree_id, &[path.clone()])
        .unwrap();
    let snapshot = host
        .capture(
            &Principal::LocalUser,
            scope.repo_id,
            scope.worktree_id,
            &[path.clone()],
            &generation,
        )
        .unwrap();
    let request = |id| DesktopRequest::CodeRelations {
        scope: scope.clone(),
        snapshot_id: id,
        path: path.clone(),
    };
    let DesktopResponse::CodeRelations { report } = host
        .desktop(
            &Principal::LocalUser,
            request(snapshot.worktree_snapshot_id),
        )
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(report.files.len(), 2);
    assert_ne!(report.snapshot_id, snapshot.worktree_snapshot_id);
    let snapshot2 = host
        .capture(
            &Principal::LocalUser,
            scope.repo_id,
            scope.worktree_id,
            &[path.clone()],
            &generation,
        )
        .unwrap();
    std::fs::write(root.join("b.ts"), "export const changed = 2;\n").unwrap();
    let DesktopResponse::CodeRelations { report } = host
        .desktop(
            &Principal::LocalUser,
            request(snapshot2.worktree_snapshot_id),
        )
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(report.files.len(), 1);
    assert_eq!(report.snapshot_id, snapshot2.worktree_snapshot_id);
    assert_ne!(report.status, "Ready");
    let denied = host.desktop(
        &Principal::LocalUser,
        DesktopRequest::CodeRelations {
            scope: RepoScope {
                repo_id: uuid::Uuid::new_v4(),
                worktree_id: scope.worktree_id,
            },
            snapshot_id: snapshot2.worktree_snapshot_id,
            path,
        },
    );
    assert_eq!(denied.unwrap_err().code, "SCOPE_DENIED");
}
#[test]
fn built_typescript_adapter_has_cross_file_semantic_references() {
    let launcher = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src-tauri/binaries/relations/typescript");
    if !launcher.exists() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    std::fs::create_dir(&root).unwrap();
    git(&root, &["init", "-q"]);
    std::fs::write(root.join("a.ts"), "export const value = 1;\n").unwrap();
    std::fs::write(
        root.join("b.ts"),
        "import {value} from './a';\nconsole.log(value);\n",
    )
    .unwrap();
    let mut host =
        agai_host::HostService::new(agai_storage::Store::open(&dir.path().join("db")).unwrap());
    let state = host.register_repository(&root).unwrap();
    let p = RepoPath::from_bytes(b"a.ts").unwrap();
    let g = host
        .prepare_capture(state.repo_id, state.worktree_id, &[p.clone()])
        .unwrap();
    let s = host
        .capture(
            &Principal::LocalUser,
            state.repo_id,
            state.worktree_id,
            &[p.clone()],
            &g,
        )
        .unwrap();
    let DesktopResponse::CodeRelations { report } = host
        .desktop(
            &Principal::LocalUser,
            DesktopRequest::CodeRelations {
                scope: RepoScope {
                    repo_id: state.repo_id,
                    worktree_id: state.worktree_id,
                },
                snapshot_id: s.worktree_snapshot_id,
                path: p,
            },
        )
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(report.status, "Partial", "{}", report.message);
    assert!(
        report.symbols.iter().any(|s| s.name == "value"
            && s.path.display == "a.ts"
            && s.references.iter().any(|r| r.path.display == "b.ts")),
        "{report:?}"
    );
    let nav = host.store.snapshot(report.snapshot_id).unwrap();
    assert_eq!(nav.files.len(), report.files.len());
}
#[test]
fn hidden_worktree_changes_never_expand_old_snapshot_with_new_bytes() {
    for mode in ["assume-unchanged", "skip-worktree", "normalization"] {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        git(&root, &["init", "-q"]);
        std::fs::write(root.join("a.ts"), "export const value = 1;\n").unwrap();
        std::fs::write(root.join("b.ts"), "export const other = 1;\n").unwrap();
        if mode == "normalization" {
            std::fs::write(root.join(".gitattributes"), "*.ts text eol=lf\n").unwrap();
        }
        git(&root, &["add", "."]);
        git(
            &root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-qm",
                "initial",
            ],
        );
        if mode != "normalization" {
            git(&root, &["update-index", &format!("--{mode}"), "b.ts"]);
        }
        let mut host =
            agai_host::HostService::new(agai_storage::Store::open(&dir.path().join("db")).unwrap());
        let state = host.register_repository(&root).unwrap();
        let p = RepoPath::from_bytes(b"a.ts").unwrap();
        let g = host
            .prepare_capture(state.repo_id, state.worktree_id, &[p.clone()])
            .unwrap();
        let s = host
            .capture(
                &Principal::LocalUser,
                state.repo_id,
                state.worktree_id,
                &[p.clone()],
                &g,
            )
            .unwrap();
        let newer = if mode == "normalization" {
            "export const other = 1;\r\n"
        } else {
            "export const hidden = 2;\n"
        };
        std::fs::write(root.join("b.ts"), newer).unwrap();
        if mode == "normalization" {
            git(&root, &["add", "b.ts"]);
        }
        assert_eq!(
            host.prepare_capture(state.repo_id, state.worktree_id, &[p.clone()])
                .unwrap(),
            g,
            "fixture must hide bytes from generation: {mode}"
        );
        let DesktopResponse::CodeRelations { report } = host
            .desktop(
                &Principal::LocalUser,
                DesktopRequest::CodeRelations {
                    scope: RepoScope {
                        repo_id: state.repo_id,
                        worktree_id: state.worktree_id,
                    },
                    snapshot_id: s.worktree_snapshot_id,
                    path: p,
                },
            )
            .unwrap()
        else {
            panic!()
        };
        let nav = host.store.snapshot(report.snapshot_id).unwrap();
        if mode == "normalization" {
            assert_eq!(
                nav.files
                    .iter()
                    .find(|f| f.path.display == "b.ts")
                    .unwrap()
                    .bytes,
                b"export const other = 1;\n"
            );
            assert!(
                report
                    .message
                    .contains("index baseline pinned by the original generation")
            );
        } else {
            assert!(!nav.files.iter().any(|f| f.path.display == "b.ts"));
        }
        assert!(
            !nav.files
                .iter()
                .any(|f| f.path.display == "b.ts" && f.bytes == newer.as_bytes()),
            "newer hidden bytes leaked for {mode}"
        );
    }
}
