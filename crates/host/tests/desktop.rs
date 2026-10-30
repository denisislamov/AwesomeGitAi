use agai_protocol::*;
use serde_json::{Value, json};
use std::{os::unix::net::UnixStream, path::Path, process::Command};
fn git(p: &Path, args: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(p)
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "{:?}", o);
    String::from_utf8_lossy(&o.stdout).trim().into()
}
fn rpc(db: &Path, action: Value) -> Value {
    let (mut c, mut s) = UnixStream::pair().unwrap();
    let db = db.to_owned();
    let task = std::thread::spawn(move || {
        let mut host = agai_host::HostService::new(agai_storage::Store::open(&db).unwrap());
        agai_host::handle(&mut host, &mut s).unwrap();
    });
    let wire = json!({"meta":{"schema_version":1,"request_id":uuid::Uuid::new_v4(),"idempotency_key":null},"desktop":action});
    agai_host::local_ipc::write_frame(&mut c, &serde_json::to_vec(&wire).unwrap()).unwrap();
    let answer =
        serde_json::from_slice(&agai_host::local_ipc::read_frame(&mut c).unwrap()).unwrap();
    task.join().unwrap();
    answer
}
#[test]
fn desktop_reads_real_files_and_comparisons_without_changing_git() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q"]);
    git(&repo, &["config", "user.name", "Test"]);
    git(&repo, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(repo.join("code.cs"), "class Before {}\n").unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-qm", "Initial"]);
    let oid = git(&repo, &["rev-parse", "HEAD"]);
    std::fs::write(repo.join("code.cs"), "class After {}\n").unwrap();
    let db = d.path().join("db");
    let opened = rpc(&db, json!({"kind":"OpenRepository","path":repo}));
    assert_eq!(opened["Ok"]["kind"], "Repository", "{opened}");
    let state = &opened["Ok"]["state"];
    let scope = json!({"repo_id":state["repo_id"],"worktree_id":state["worktree_id"]});
    let files = rpc(
        &db,
        json!({"kind":"ListFiles","scope":scope,"revision":null}),
    );
    assert_eq!(files["Ok"]["paths"][0]["display"], "code.cs");
    let details = rpc(&db, json!({"kind":"CommitDetails","scope":scope,"oid":oid}));
    assert_eq!(details["Ok"]["author"], "Test");
    assert_eq!(details["Ok"]["paths"][0]["display"], "code.cs");
    let empty = rpc(
        &db,
        json!({"kind":"CompareFile","scope":scope,"path":RepoPath::from_bytes(b"code.cs").unwrap(),"base":"Empty","target":{"Commit":{"oid":oid}}}),
    );
    assert_eq!(empty["Ok"]["base"]["files"][0]["state"], "Absent");
    let path = RepoPath::from_bytes(b"code.cs").unwrap();
    let compared = rpc(
        &db,
        json!({"kind":"CompareFile","scope":scope,"path":path,"base":"Index","target":"Worktree"}),
    );
    assert_eq!(compared["Ok"]["kind"], "FileComparison", "{compared}");
    let data = &compared["Ok"];
    assert_eq!(
        data["base"]["files"][0]["bytes"],
        json!(b"class Before {}\n")
    );
    assert_eq!(
        data["target"]["files"][0]["bytes"],
        json!(b"class After {}\n")
    );
    let c = rpc(
        &db,
        json!({"kind":"CompareFile","scope":scope,"path":path,"base":{"Commit":{"oid":oid}},"target":{"Snapshot":{"id":data["target"]["id"]}}}),
    );
    assert_eq!(c["Ok"]["kind"], "FileComparison", "{c}");
    assert_eq!(git(&repo, &["rev-parse", "HEAD"]), oid);
    assert_eq!(git(&repo, &["show", ":code.cs"]), "class Before {}");
    assert_eq!(
        std::fs::read_to_string(repo.join("code.cs")).unwrap(),
        "class After {}\n"
    );
    let invalid = rpc(
        &db,
        json!({"kind":"CompareFile","scope":scope,"path":path,"base":{"Commit":{"oid":"--help"}},"target":"Worktree"}),
    );
    assert!(invalid.get("Err").is_some());
}
#[test]
fn desktop_does_not_allow_principal_forgery_or_arbitrary_commands() {
    let d = tempfile::tempdir().unwrap();
    let db = d.path().join("db");
    assert_eq!(
        rpc(&db, json!({"kind":"Run","argv":["reset","--hard"]}))["Err"]["code"],
        "INVALID_REQUEST"
    );
    assert_eq!(
        rpc(
            &db,
            json!({"kind":"OpenRepository","path":"/tmp","principal":"LocalUser"})
        )["Err"]["code"],
        "INVALID_REQUEST"
    );
}

#[test]
fn arbitrary_base_lists_deletions_before_target_parent() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q"]);
    git(&repo, &["config", "user.name", "Test"]);
    git(&repo, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(repo.join("X.cs"), "class X {}\n").unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-qm", "A"]);
    let a = git(&repo, &["rev-parse", "HEAD"]);
    git(&repo, &["rm", "X.cs"]);
    git(&repo, &["commit", "-qm", "B"]);
    std::fs::write(repo.join("Y.cs"), "class Y {}\n").unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-qm", "C"]);
    let c = git(&repo, &["rev-parse", "HEAD"]);
    let db = d.path().join("db");
    let opened = rpc(&db, json!({"kind":"OpenRepository","path":repo}));
    let state = &opened["Ok"]["state"];
    let scope = json!({"repo_id":state["repo_id"],"worktree_id":state["worktree_id"]});
    let details = rpc(
        &db,
        json!({"kind":"CommitDetails","scope":scope,"oid":c,"base":a}),
    );
    assert_eq!(details["Ok"]["base_oid"], a);
    let paths = details["Ok"]["paths"].as_array().unwrap();
    assert_eq!(
        paths
            .iter()
            .map(|p| p["display"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["X.cs", "Y.cs"]
    );
}
