use agai_protocol::*;
use std::{
    collections::HashSet,
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
fn transport_error(error: std::io::Error) -> AppError {
    AppError::new(match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => "HOST_TIMEOUT",
        _ => "HOST_OFFLINE",
    })
}
pub struct DesktopHost {
    pub profile: PathBuf,
    pub binary: PathBuf,
    closing: AtomicBool,
    roots: Mutex<HashSet<PathBuf>>,
}
impl DesktopHost {
    pub fn new(profile: PathBuf, binary: PathBuf) -> Self {
        Self {
            profile,
            binary,
            closing: AtomicBool::new(false),
            roots: Mutex::new(HashSet::new()),
        }
    }
    pub fn shutdown(&self) {
        if self.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        // Stop GUI Git jobs, but leave the shared MCP service and history alive.
        if let Ok(mut stream) = UnixStream::connect(self.profile.join("host.sock")) {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
            let request = serde_json::json!({"meta":{"schema_version":1,"request_id":uuid::Uuid::new_v4(),"idempotency_key":null},"desktop":{"kind":"GitShutdown"}});
            if let Ok(bytes) = serde_json::to_vec(&request) {
                let _ = stream
                    .write_all(&(bytes.len() as u32).to_be_bytes())
                    .and_then(|_| stream.write_all(&bytes));
                let mut header = [0; 4];
                let _ = stream.read_exact(&mut header);
            }
        }
    }
    fn connect(&self) -> Result<UnixStream> {
        if self.closing.load(Ordering::SeqCst) {
            return Err(AppError::new("HOST_OFFLINE"));
        }
        agai_host_launch::connect(&self.profile, &self.binary).map_err(AppError::new)
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
        stream.read_exact(&mut header).map_err(transport_error)?;
        let len = u32::from_be_bytes(header) as usize;
        if len > 16 * 1024 * 1024 {
            return Err(AppError::new("FRAME_TOO_LARGE"));
        }
        let mut data = vec![0; len];
        stream.read_exact(&mut data).map_err(transport_error)?;
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
    use std::process::{Command, Stdio};
    #[test]
    fn gui_shutdown_stops_jobs_but_keeps_shared_listener_alive() {
        let d = tempfile::tempdir().unwrap();
        let listener = std::os::unix::net::UnixListener::bind(d.path().join("host.sock")).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut header = [0; 4];
            stream.read_exact(&mut header).unwrap();
            let mut bytes = vec![0; u32::from_be_bytes(header) as usize];
            stream.read_exact(&mut bytes).unwrap();
            let request: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(request["desktop"]["kind"], "GitShutdown");
            let response = br#"{"Ok":{"kind":"GitStopped"}}"#;
            stream
                .write_all(&(response.len() as u32).to_be_bytes())
                .unwrap();
            stream.write_all(response).unwrap();
            listener
        });
        let host = DesktopHost::new(d.path().to_owned(), d.path().join("unused"));
        host.shutdown();
        let _listener = server.join().unwrap();
        assert!(UnixStream::connect(d.path().join("host.sock")).is_ok());
        assert_eq!(host.connect().unwrap_err().code, "HOST_OFFLINE");
        host.shutdown(); // Idempotent; never sends another request or starts a host.
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

#[cfg(test)]
mod timeout_tests {
    use super::*;
    #[test]
    fn local_timeout_is_not_an_offline_host() {
        for kind in [std::io::ErrorKind::TimedOut, std::io::ErrorKind::WouldBlock] {
            assert_eq!(
                transport_error(std::io::Error::from(kind)).code,
                "HOST_TIMEOUT"
            );
        }
        assert_eq!(
            transport_error(std::io::Error::from(std::io::ErrorKind::BrokenPipe)).code,
            "HOST_OFFLINE"
        );
    }
}
