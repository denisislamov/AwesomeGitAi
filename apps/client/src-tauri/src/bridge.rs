use agai_protocol::*;
use std::{
    collections::HashSet,
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
pub struct DesktopHost {
    pub profile: PathBuf,
    pub binary: PathBuf,
    child: Mutex<Option<Child>>,
    closing: AtomicBool,
    roots: Mutex<HashSet<PathBuf>>,
}
impl DesktopHost {
    pub fn new(profile: PathBuf, binary: PathBuf) -> Self {
        Self {
            profile,
            binary,
            child: Mutex::new(None),
            closing: AtomicBool::new(false),
            roots: Mutex::new(HashSet::new()),
        }
    }
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut process) = child.take() {
                if let Ok(mut stream) = UnixStream::connect(self.profile.join("host.sock")) {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let request = serde_json::json!({"meta":{"schema_version":1,"request_id":uuid::Uuid::new_v4(),"idempotency_key":null},"desktop":{"kind":"GitShutdown"}});
                    if let Ok(bytes) = serde_json::to_vec(&request) {
                        let _ = stream.write_all(&(bytes.len() as u32).to_be_bytes()).and_then(|_|stream.write_all(&bytes));
                        let mut header=[0;4];let _=stream.read_exact(&mut header);
                    }
                }
                let _ = process.kill();
                let _ = process.wait();
            }
        }
    }
    fn connect(&self) -> Result<UnixStream> {
        if self.closing.load(Ordering::SeqCst) {
            return Err(AppError::new("HOST_OFFLINE"));
        }
        let socket = self.profile.join("host.sock");
        if let Ok(stream) = UnixStream::connect(&socket) {
            return Ok(stream);
        }
        let mut child = self
            .child
            .lock()
            .map_err(|_| AppError::new("HOST_OFFLINE"))?;
        if self.closing.load(Ordering::SeqCst) {
            return Err(AppError::new("HOST_OFFLINE"));
        }
        if child
            .as_mut()
            .is_none_or(|p| p.try_wait().ok().flatten().is_some())
        {
            *child = Some(
                Command::new(&self.binary)
                    .arg(&self.profile)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| AppError::new("HOST_START_FAILED"))?,
            );
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(stream) = UnixStream::connect(&socket) {
                return Ok(stream);
            }
            if Instant::now() >= deadline {
                return Err(AppError::new("HOST_OFFLINE"));
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    pub fn request<T: serde::Serialize>(&self, envelope: &T) -> Result<serde_json::Value> {
        let payload = serde_json::to_vec(envelope).map_err(|_| AppError::new("INVALID_REQUEST"))?;
        if payload.len() > 16 * 1024 * 1024 {
            return Err(AppError::new("FRAME_TOO_LARGE"));
        }
        let mut stream = self.connect()?;
        stream
            .set_read_timeout(Some(Duration::from_secs(30)))
            .map_err(|_| AppError::new("HOST_OFFLINE"))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|_| AppError::new("HOST_OFFLINE"))?;
        stream
            .write_all(&(payload.len() as u32).to_be_bytes())
            .and_then(|_| stream.write_all(&payload))
            .map_err(|_| AppError::new("HOST_OFFLINE"))?;
        let mut header = [0; 4];
        stream
            .read_exact(&mut header)
            .map_err(|_| AppError::new("HOST_OFFLINE"))?;
        let len = u32::from_be_bytes(header) as usize;
        if len > 16 * 1024 * 1024 {
            return Err(AppError::new("FRAME_TOO_LARGE"));
        }
        let mut data = vec![0; len];
        stream
            .read_exact(&mut data)
            .map_err(|_| AppError::new("HOST_OFFLINE"))?;
        let response: serde_json::Value =
            serde_json::from_slice(&data).map_err(|_| AppError::new("INVALID_RESPONSE"))?;
        if response["Ok"]["kind"] == "Repository" {
            if let Some(root) = response["Ok"]["root"].as_str() {
                self.roots
                    .lock()
                    .map_err(|_| AppError::new("HOST_OFFLINE"))?
                    .insert(PathBuf::from(root));
            }
        }
        Ok(response)
    }
    pub fn external_path(&self, root: &str, path: Option<&RepoPath>) -> Result<PathBuf> {
        let root = Path::new(root)
            .canonicalize()
            .map_err(|_| AppError::new("INVALID_PATH"))?;
        if !self
            .roots
            .lock()
            .map_err(|_| AppError::new("SCOPE_DENIED"))?
            .contains(&root)
        {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        safe_path(&root, path)
    }
}
fn safe_path(root: &Path, path: Option<&RepoPath>) -> Result<PathBuf> {
    let p = if let Some(p) = path {
        root.join(p.path()?)
    } else {
        root.to_owned()
    };
    let p = p
        .canonicalize()
        .map_err(|_| AppError::new("INVALID_PATH"))?;
    if !p.starts_with(root) {
        return Err(AppError::new("SCOPE_DENIED"));
    }
    Ok(p)
}
impl Drop for DesktopHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_shutdown_stops_owned_child_before_process_exit() {
        let d = tempfile::tempdir().unwrap();
        let host = DesktopHost::new(d.path().join("profile"), d.path().join("binary"));
        let child = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        let pid = child.id();
        *host.child.lock().unwrap() = Some(child);
        host.shutdown();
        let alive = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(
            !alive,
            "Explicit shutdown must terminate the owned host before Tauri exits without Drop"
        );
    }
    #[test]
    fn external_paths_reject_traversal_and_escaping_symlinks() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        std::fs::write(root.join("- code.cs"), "test").unwrap();
        assert_eq!(
            safe_path(&root, Some(&RepoPath::from_bytes(b"- code.cs").unwrap())).unwrap(),
            root.join("- code.cs")
        );
        std::os::unix::fs::symlink(d.path(), root.join("escape")).unwrap();
        assert_eq!(
            safe_path(&root, Some(&RepoPath::from_bytes(b"escape").unwrap()))
                .unwrap_err()
                .code,
            "SCOPE_DENIED"
        );
        let mut bad = RepoPath::from_bytes(b"ok").unwrap();
        bad.raw_base64 = "Li4=".into();
        assert!(safe_path(&root, Some(&bad)).is_err());
    }
    #[test]
    fn shutdown_preserves_external_process_and_rejects_restart() {
        let d = tempfile::tempdir().unwrap();
        let host = DesktopHost::new(d.path().join("profile"), d.path().join("binary"));
        let mut external = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        host.shutdown();
        let still_alive = external.try_wait().unwrap().is_none();
        let _ = external.kill();
        let _ = external.wait();
        assert!(still_alive);
        assert_eq!(host.connect().unwrap_err().code, "HOST_OFFLINE");
    }
    #[test]
    fn external_paths_require_opened_repository() {
        let d = tempfile::tempdir().unwrap();
        let host = DesktopHost::new(d.path().join("profile"), d.path().join("binary"));
        assert_eq!(
            host.external_path(d.path().to_str().unwrap(), None)
                .unwrap_err()
                .code,
            "SCOPE_DENIED"
        );
    }
}
