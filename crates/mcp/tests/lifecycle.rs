//! Real executable lifecycle: no GUI, no mocked host, private disposable profile.
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::{fs::PermissionsExt, net::UnixStream},
    path::Path,
    process::{Child, ChildStdout, Command, Stdio},
};
struct Client {
    child: Child,
    output: BufReader<ChildStdout>,
}
impl Client {
    fn start(bin: &Path, profile: &Path, repo: &Path) -> Self {
        let mut child = Command::new(bin)
            .arg("--profile")
            .arg(profile)
            .arg("--repo")
            .arg(repo)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut c = Self { child, output };
        c.rpc(1,"initialize",json!({"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"lifecycle-test","version":"1"}}));
        writeln!(
            c.child.stdin.as_mut().unwrap(),
            "{}",
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .unwrap();
        c
    }
    fn rpc(&mut self, id: u32, method: &str, params: Value) -> Value {
        writeln!(
            self.child.stdin.as_mut().unwrap(),
            "{}",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        )
        .unwrap();
        loop {
            let mut line = String::new();
            assert!(self.output.read_line(&mut line).unwrap() > 0, "MCP exited");
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["id"] == id {
                assert!(v.get("error").is_none(), "{v}");
                return v["result"].clone();
            }
        }
    }
    fn guide(&mut self) -> Value {
        let r = self.rpc(
            2,
            "tools/call",
            json!({"name":"integration_guide","arguments":{"schema_version":1}}),
        );
        assert_ne!(r["isError"], true, "{r}");
        serde_json::from_str(r["content"][0]["text"].as_str().unwrap()).unwrap()
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
struct HostCleanup(std::path::PathBuf);
impl Drop for HostCleanup {
    fn drop(&mut self) {
        if let Ok(s) = fs::read_to_string(&self.0) {
            for pid in s.lines() {
                let _ = Command::new("/bin/kill")
                    .arg(pid)
                    .stderr(Stdio::null())
                    .status();
            }
        }
    }
}
fn quote(p: &Path) -> String {
    format!("'{}'", p.display().to_string().replace('\'', "'\\''"))
}
#[test]
fn mcp_starts_shared_host_survives_exit_and_restarts_with_same_grant() {
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let profile = root.path().join("profile");
    fs::create_dir(&profile).unwrap();
    fs::set_permissions(&profile, fs::Permissions::from_mode(0o700)).unwrap();
    let repo = root.path().join("repo");
    fs::create_dir(&repo).unwrap();
    assert!(
        Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    let mcp = bin.join("agai-mcp");
    fs::copy(env!("CARGO_BIN_EXE_agai-mcp"), &mcp).unwrap();
    let host = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug/agai-host")
        .canonicalize()
        .unwrap();
    let pidfile = root.path().join("host-pids");
    let _cleanup = HostCleanup(pidfile.clone());
    let wrapper = bin.join("agai-host");
    fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho $$ >> {}\nexec {} \"$@\"\n",
            quote(&pidfile),
            quote(&host)
        ),
    )
    .unwrap();
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
    let mut first = Client::start(&mcp, &profile, &repo);
    let guide = first.guide();
    assert!(
        guide["explanation_policy"]
            .as_str()
            .unwrap()
            .contains("Junior / Middle / Senior")
    );
    let grant = fs::read(profile.join("mcp-grant.json")).unwrap();
    drop(first);
    assert!(
        UnixStream::connect(profile.join("host.sock")).is_ok(),
        "host survives MCP exit"
    );
    let mut clients: Vec<_> = (0..4)
        .map(|_| Client::start(&mcp, &profile, &repo))
        .collect();
    for c in &mut clients {
        assert_eq!(c.guide()["repo_id"], guide["repo_id"]);
    }
    assert_eq!(
        fs::read_to_string(&pidfile).unwrap().lines().count(),
        1,
        "reuse one host"
    );
    let old_pid = fs::read_to_string(&pidfile)
        .unwrap()
        .lines()
        .next()
        .unwrap()
        .to_string();
    Command::new("/bin/kill").arg(&old_pid).status().unwrap();
    for _ in 0..100 {
        if UnixStream::connect(profile.join("host.sock")).is_err() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // Concurrent existing clients race to recover the same offline profile.
    let workers: Vec<_> = clients
        .into_iter()
        .map(|mut c| std::thread::spawn(move || c.guide()))
        .collect();
    for w in workers {
        assert_eq!(w.join().unwrap()["repo_id"], guide["repo_id"]);
    }
    assert_eq!(
        fs::read_to_string(&pidfile).unwrap().lines().count(),
        2,
        "one replacement process"
    );
    assert_eq!(
        fs::read(profile.join("mcp-grant.json")).unwrap(),
        grant,
        "owner/token preserved"
    );
}
