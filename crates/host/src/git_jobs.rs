use crate::HostService;
use agai_git::{
    GitReader,
    operations::{self, Mutation},
};
use agai_protocol::*;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use uuid::Uuid;
fn err(code: &str) -> AppError {
    AppError::new(code)
}
struct Task {
    value: Arc<Mutex<GitJob>>,
    cancel: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
struct Prepared {
    scope: RepoScope,
    generation: String,
    path: RepoPath,
    bytes: Option<Vec<u8>>,
}
#[derive(Default)]
pub struct Operations {
    tasks: HashMap<Uuid, Task>,
    prepared: HashMap<Uuid, Prepared>,
}
impl Operations {
    fn spawn(
        &mut self,
        root: PathBuf,
        run: impl FnOnce(&AtomicBool) -> Result<()> + Send + 'static,
        network: bool,
    ) -> Result<DesktopResponse> {
        // Keep active tasks; bound completed receipts and memory.
        if self.tasks.len() >= 64 {
            self.tasks
                .retain(|_, t| t.thread.as_ref().is_some_and(|h| !h.is_finished()));
        }
        if self.tasks.len() >= 16 {
            return Err(err("TOO_MANY_OPERATIONS"));
        }
        let id = Uuid::new_v4();
        let cancel = Arc::new(AtomicBool::new(false));
        let job = GitJob {
            id,
            root: root.to_string_lossy().into(),
            status: "Running".into(),
            error: None,
            cancel_requested: false,
            state_changed: false,
            outcome_uncertain: false,
        };
        let value = Arc::new(Mutex::new(job.clone()));
        let c = cancel.clone();
        let v = value.clone();
        let thread = thread::spawn(move || {
            let before = GitReader::new(&root).ok().and_then(|r| r.state().ok());
            let result = run(&c);
            let after = GitReader::new(&root).ok().and_then(|r| r.state().ok());
            let changed =
                before.as_ref().map(|s| &s.generation) != after.as_ref().map(|s| &s.generation);
            let mut j = v.lock().unwrap();
            j.cancel_requested = c.load(Ordering::Relaxed);
            j.state_changed = changed;
            j.status = if result.is_ok() {
                "Succeeded"
            } else if result.as_ref().is_err_and(|e| e.code == "CANCELLED") {
                "Cancelled"
            } else {
                "Failed"
            }
            .into();
            // Cancellation can follow a ref update or remote write: expose observed state, never promise rollback.
            j.outcome_uncertain = result.is_err() && (network || changed);
            j.error = result.err().map(|e| e.code);
        });
        self.tasks.insert(
            id,
            Task {
                value,
                cancel,
                thread: Some(thread),
            },
        );
        Ok(DesktopResponse::GitJob { job })
    }
    pub fn poll(&self, id: Uuid) -> Result<DesktopResponse> {
        let t = self
            .tasks
            .get(&id)
            .ok_or_else(|| err("UNKNOWN_OPERATION"))?;
        Ok(DesktopResponse::GitJob {
            job: t.value.lock().map_err(|_| err("OPERATION_FAILED"))?.clone(),
        })
    }
    pub fn cancel(&self, id: Uuid) -> Result<DesktopResponse> {
        let t = self
            .tasks
            .get(&id)
            .ok_or_else(|| err("UNKNOWN_OPERATION"))?;
        t.cancel.store(true, Ordering::Relaxed);
        self.poll(id)
    }
    pub fn stop(&mut self) {
        for t in self.tasks.values() {
            t.cancel.store(true, Ordering::Relaxed);
        }
        for t in self.tasks.values_mut() {
            if let Some(h) = t.thread.take() {
                let _ = h.join();
            }
        }
    }
    pub fn create(&mut self, path: String, source: Option<String>) -> Result<DesktopResponse> {
        let root = PathBuf::from(path);
        let p = root.clone();
        self.spawn(
            root,
            move |c| operations::create_repository(&p, source.as_deref(), c),
            true,
        )
    }
}
impl Drop for Operations {
    fn drop(&mut self) {
        self.stop();
    }
}
impl HostService {
    pub fn start_git(
        &mut self,
        scope: RepoScope,
        generation: String,
        action: GitAction,
    ) -> Result<DesktopResponse> {
        let r = self.reader(scope.repo_id, scope.worktree_id)?;
        let network = matches!(
            action,
            GitAction::Push { .. } | GitAction::Pull { .. } | GitAction::Fetch { .. }
        );
        let m = match action {
            GitAction::Stage { path } => Mutation::Stage { path },
            GitAction::Unstage { path } => Mutation::Unstage { path },
            GitAction::Commit { message } => Mutation::Commit { message },
            GitAction::CreateBranch { name } => Mutation::CreateBranch { name },
            GitAction::SwitchBranch { name } => Mutation::SwitchBranch { name },
            GitAction::Fetch { remote } => Mutation::Fetch { remote },
            GitAction::Pull { remote, branch } => Mutation::Pull { remote, branch },
            GitAction::Push { remote, branch } => Mutation::Push { remote, branch },
            GitAction::ApplyPrepared { id } => {
                let p = self
                    .operations
                    .prepared
                    .remove(&id)
                    .ok_or_else(|| err("UNKNOWN_PREVIEW"))?;
                if p.scope.repo_id != scope.repo_id
                    || p.scope.worktree_id != scope.worktree_id
                    || p.generation != generation
                {
                    return Err(err("STALE_STATE"));
                }
                Mutation::IndexBytes {
                    path: p.path,
                    bytes: p.bytes,
                }
            }
        };
        self.operations.spawn(
            r.root.clone(),
            move |c| operations::execute(&r, m, &generation, c),
            network,
        )
    }
    pub fn prepare_selection(
        &mut self,
        scope: RepoScope,
        id: Uuid,
        path: RepoPath,
        generation: String,
        old: Vec<u32>,
        new: Vec<u32>,
        unstage: bool,
    ) -> Result<DesktopResponse> {
        if old.len() + new.len() > 100_000 {
            return Err(err("INVALID_SELECTION"));
        }
        let r = self.reader(scope.repo_id, scope.worktree_id)?;
        if r.state()?.generation != generation {
            return Err(err("STALE_STATE"));
        }
        let c = self.store.comparison(id)?;
        let a = self.store.snapshot(c.base_snapshot_id)?;
        let b = self.store.snapshot(c.target_snapshot_id)?;
        for s in [&a, &b] {
            if s.repo_id != scope.repo_id || s.worktree_id != scope.worktree_id {
                return Err(err("SCOPE_DENIED"));
            }
        }
        if if unstage {
            a.layer != Layer::Head || b.layer != Layer::Index
        } else {
            a.layer != Layer::Index || b.layer != Layer::Worktree
        } {
            return Err(err("INVALID_STAGING_COMPARISON"));
        }
        let a = a
            .files
            .iter()
            .find(|f| f.path.raw_base64 == path.raw_base64)
            .ok_or_else(|| err("INVALID_PATH"))?;
        let b = b
            .files
            .iter()
            .find(|f| f.path.raw_base64 == path.raw_base64)
            .ok_or_else(|| err("INVALID_PATH"))?;
        if a.state == FileState::Conflicted || b.state == FileState::Conflicted {
            return Err(err("UNRESOLVED_CONFLICT"));
        }
        // Re-capture current layers and compare bytes, not merely the caller's current generation.
        let captured = agai_domain::capture(
            &r,
            &mut self.store,
            &[path.clone()],
            &r.generation_for_paths(&[path.clone()])?,
        )?;
        let current_a = self.store.snapshot(if unstage {
            captured.head_snapshot_id
        } else {
            captured.index_snapshot_id
        })?;
        let current_b = self.store.snapshot(if unstage {
            captured.index_snapshot_id
        } else {
            captured.worktree_snapshot_id
        })?;
        for (snapshot, file) in [(&current_a, a), (&current_b, b)] {
            if !snapshot.files.iter().any(|f| {
                f.path.raw_base64 == path.raw_base64
                    && f.bytes == file.bytes
                    && f.state == file.state
            }) {
                return Err(err("STALE_STATE"));
            }
        }
        let (from, to, old, new) = if unstage {
            (b, a, new, old)
        } else {
            (a, b, old, new)
        };
        let bytes = operations::select_lines(&from.bytes, &to.bytes, &old, &new)?;
        let before =
            String::from_utf8(from.bytes.clone()).map_err(|_| err("PARTIAL_BINARY_UNSUPPORTED"))?;
        let after =
            String::from_utf8(bytes.clone()).map_err(|_| err("PARTIAL_BINARY_UNSUPPORTED"))?;
        let id = Uuid::new_v4();
        if self.operations.prepared.len() >= 32 {
            self.operations.prepared.clear();
        }
        self.operations.prepared.insert(
            id,
            Prepared {
                scope,
                generation,
                path,
                bytes: if bytes.is_empty() && to.state == FileState::Absent {
                    None
                } else {
                    Some(bytes)
                },
            },
        );
        Ok(DesktopResponse::PreparedSelection { id, before, after })
    }
}
