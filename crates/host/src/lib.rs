mod agent;
pub mod desktop;
mod git_jobs;
mod learning;
pub mod local_ipc;
mod memory;
mod relations;
pub mod watch;
use agai_protocol::*;
use agai_storage::Store;
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    os::unix::net::{UnixListener, UnixStream},
    path::{Path, PathBuf},
    time::Duration,
};
fn io(_: std::io::Error) -> AppError {
    AppError::new("IO_ERROR")
}
pub struct Profile {
    _lock: File,
    pub path: PathBuf,
}
impl Profile {
    pub fn acquire(path: &Path) -> Result<Self> {
        if !path.exists() {
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(path)
                .map_err(io)?;
        }
        let meta = fs::symlink_metadata(path).map_err(io)?;
        if !meta.is_dir()
            || meta.uid() != unsafe { libc::geteuid() }
            || meta.permissions().mode() & 0o077 != 0
        {
            return Err(AppError::new("UNSAFE_PROFILE"));
        }
        let path = path.canonicalize().map_err(io)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path.join("host.lock"))
            .map_err(io)?;
        lock.try_lock_exclusive()
            .map_err(|_| AppError::new("HOST_ALREADY_RUNNING"))?;
        for file in ["store.db", "store.db-wal", "store.db-shm", "host.sock"] {
            if fs::symlink_metadata(path.join(file)).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(AppError::new("UNSAFE_PROFILE"));
            }
        }
        Ok(Self { _lock: lock, path })
    }
}
use std::os::unix::fs::DirBuilderExt;
pub struct HostService {
    pub store: Store,
    pub operations: git_jobs::Operations,
}
impl HostService {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            operations: Default::default(),
        }
    }
    pub fn register_repository(&self, path: &Path) -> Result<RepoState> {
        use std::os::unix::ffi::OsStrExt;
        let r = agai_git::GitReader::new(path)?;
        self.store
            .register_repository(r.repo_id, r.worktree_id, r.root.as_os_str().as_bytes())?;
        r.state()
    }
    pub fn reader(&self, repo: uuid::Uuid, worktree: uuid::Uuid) -> Result<agai_git::GitReader> {
        use std::os::unix::ffi::OsStringExt;
        let path = std::ffi::OsString::from_vec(self.store.repository_path(repo, worktree)?);
        let r = agai_git::GitReader::new(Path::new(&path))?;
        if r.repo_id != repo || r.worktree_id != worktree {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        Ok(r)
    }
    pub fn prepare_capture(
        &self,
        repo: uuid::Uuid,
        worktree: uuid::Uuid,
        paths: &[RepoPath],
    ) -> Result<String> {
        self.reader(repo, worktree)?.generation_for_paths(paths)
    }
    pub fn capture(
        &mut self,
        principal: &Principal,
        repo: uuid::Uuid,
        worktree: uuid::Uuid,
        paths: &[RepoPath],
        generation: &str,
    ) -> Result<CapturedState> {
        if !matches!(principal, Principal::LocalUser) {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let r = self.reader(repo, worktree)?;
        agai_domain::capture(&r, &mut self.store, paths, generation)
    }

    pub fn read(&self, principal: &Principal, request: ReadRequest) -> Result<ReadResponse> {
        if !matches!(principal, Principal::LocalUser) {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        match request {
            ReadRequest::GetRepoState {
                repo_id,
                worktree_id,
            } => Ok(ReadResponse::RepoState {
                state: self.reader(repo_id, worktree_id)?.state()?,
            }),
            ReadRequest::ListHistory {
                repo_id,
                worktree_id,
                cursor,
                limit,
            } => Ok(ReadResponse::History {
                page: self
                    .reader(repo_id, worktree_id)?
                    .history(cursor.as_deref(), limit as usize)?,
            }),
            ReadRequest::Hello {} => Ok(ReadResponse::Hello {
                schema_version: 1,
                capabilities: vec!["snapshots.read".into(), "events.search".into()],
            }),
            ReadRequest::ReadSnapshot {
                repo_id,
                worktree_id,
                snapshot_id,
            } => {
                let s = self.store.snapshot(snapshot_id)?;
                if s.repo_id != repo_id || s.worktree_id != worktree_id {
                    return Err(AppError::new("SCOPE_DENIED"));
                }
                Ok(ReadResponse::Snapshot { snapshot: s })
            }
            ReadRequest::SearchEvents { repo_id, query } => Ok(ReadResponse::Events {
                ids: self.store.search(repo_id, &query)?,
            }),
            ReadRequest::GetComparison {
                repo_id,
                worktree_id,
                comparison_id,
            } => {
                let c = self.store.comparison(comparison_id)?;
                for id in [c.base_snapshot_id, c.target_snapshot_id] {
                    let s = self.store.snapshot(id)?;
                    if s.repo_id != repo_id || s.worktree_id != worktree_id {
                        return Err(AppError::new("SCOPE_DENIED"));
                    }
                }
                Ok(ReadResponse::Comparison { comparison: c })
            }
        }
    }
}
pub fn handle(service: &mut HostService, stream: &mut UnixStream) -> Result<()> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(io)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(io)?;
    let response = (|| {
        let bytes = local_ipc::read_frame(stream)?;
        if let Ok(envelope) = serde_json::from_slice::<DesktopEnvelope>(&bytes) {
            envelope.meta.validate(false)?;
            return serde_json::to_value(service.desktop(&Principal::LocalUser, envelope.desktop)?)
                .map_err(|_| AppError::new("INVALID_DATA"));
        }
        if let Ok(envelope) = serde_json::from_slice::<AgentEnvelope>(&bytes) {
            return service.agent(envelope.agent);
        }
        let envelope: ReadEnvelope =
            serde_json::from_slice(&bytes).map_err(|_| AppError::new("INVALID_REQUEST"))?;
        envelope.meta.validate(false)?;
        serde_json::to_value(service.read(&Principal::LocalUser, envelope.request)?)
            .map_err(|_| AppError::new("INVALID_DATA"))
    })();
    let bytes = serde_json::to_vec(&response).map_err(|_| AppError::new("INVALID_DATA"))?;
    local_ipc::write_frame(stream, &bytes)
}
pub fn serve(profile: &Profile) -> Result<()> {
    let socket = profile.path.join("host.sock");
    if socket.exists() {
        fs::remove_file(&socket).map_err(io)?;
    }
    let listener = UnixListener::bind(&socket).map_err(io)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(io)?;
    let store =
        Store::open(&profile.path.join("store.db")).map_err(|_| AppError::new("STORAGE_ERROR"))?;
    let mut service = HostService::new(store);
    for stream in listener.incoming() {
        let mut stream = stream.map_err(io)?;
        let _ = handle(&mut service, &mut stream);
    }
    Ok(())
}
impl Drop for Profile {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self._lock);
    }
}
