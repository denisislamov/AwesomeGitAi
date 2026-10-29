pub mod runner;
use agai_protocol::*;
use std::{
    ffi::{CString, OsString},
    io::Read,
    os::fd::{AsRawFd, FromRawFd},
    os::unix::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
use uuid::Uuid;
pub struct GitReader {
    pub root: PathBuf,
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
}
fn trim(mut b: Vec<u8>) -> Vec<u8> {
    if b.last() == Some(&b'\n') {
        b.pop();
    }
    b
}
impl GitReader {
    pub fn new(p: &Path) -> Result<Self> {
        let root = p
            .canonicalize()
            .map_err(|_| AppError::new("INVALID_REPOSITORY"))?;
        let top = trim(runner::run(
            &root,
            &["rev-parse".into(), "--show-toplevel".into()],
            &AtomicBool::new(false),
        )?);
        let root = PathBuf::from(OsString::from_vec(top))
            .canonicalize()
            .map_err(|_| AppError::new("INVALID_REPOSITORY"))?;
        let common = trim(runner::run(
            &root,
            &[
                "rev-parse".into(),
                "--path-format=absolute".into(),
                "--git-common-dir".into(),
            ],
            &AtomicBool::new(false),
        )?);
        let common = PathBuf::from(OsString::from_vec(common))
            .canonicalize()
            .map_err(|_| AppError::new("INVALID_REPOSITORY"))?;
        Ok(Self {
            repo_id: Uuid::new_v5(&Uuid::NAMESPACE_OID, common.as_os_str().as_bytes()),
            worktree_id: Uuid::new_v5(&Uuid::NAMESPACE_OID, root.as_os_str().as_bytes()),
            root,
        })
    }
    pub fn run(&self, args: &[&str]) -> Result<Vec<u8>> {
        self.raw(&args.iter().map(OsString::from).collect::<Vec<_>>())
    }
    pub fn raw(&self, args: &[OsString]) -> Result<Vec<u8>> {
        runner::run(&self.root, args, &AtomicBool::new(false))
    }
    pub fn head(&self) -> Option<String> {
        self.run(&["rev-parse", "--verify", "HEAD"])
            .ok()
            .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
    }
    pub fn refs_fingerprint(&self) -> Result<String> {
        let refs = self.run(&["for-each-ref", "--format=%(refname) %(objectname)"])?;
        Ok(hash(&refs))
    }
    pub fn observe_paths(
        &self,
        paths: &[RepoPath],
    ) -> Result<Vec<(RepoPath, Result<Option<Vec<u8>>>)>> {
        paths
            .iter()
            .map(|p| {
                p.bytes()?;
                Ok((p.clone(), self.read_worktree(p)))
            })
            .collect()
    }
    pub fn scoped_generation(
        base: &str,
        observed: &[(RepoPath, Result<Option<Vec<u8>>>)],
    ) -> Result<String> {
        let mut records = vec![];
        for (p, outcome) in observed {
            let value = match outcome {
                Ok(Some(b)) => format!("present:{}", hash(b)),
                Ok(None) => "absent".into(),
                Err(e) => format!("excluded:{}", e.code),
            };
            records.push((p.bytes()?, value));
        }
        records.sort();
        Ok(hash(&serde_json::to_vec(&(base, records)).unwrap()))
    }
    pub fn generation_for_paths(&self, paths: &[RepoPath]) -> Result<String> {
        let before = self.state()?;
        let observed = self.observe_paths(paths)?;
        if self.state()?.generation != before.generation {
            return Err(AppError::new("STALE_STATE"));
        }
        Self::scoped_generation(&before.generation, &observed)
    }
    pub fn state(&self) -> Result<RepoState> {
        let raw = self.run(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
        let entries = parse_status(&raw)?;
        let head = self.head();
        let branch = self
            .run(&["symbolic-ref", "--quiet", "--short", "HEAD"])
            .ok()
            .map(|b| String::from_utf8_lossy(&b).trim().into());
        let index = self.run(&["ls-files", "--stage", "-z"])?;
        let mut fingerprint =
            serde_json::to_vec(&(&head, &branch, &raw, &index, self.refs_fingerprint()?)).unwrap();
        for e in &entries {
            match self.read_worktree(&e.path) {
                Ok(Some(b)) => fingerprint.extend_from_slice(hash(&b).as_bytes()),
                Ok(None) => fingerprint.extend_from_slice(b"absent"),
                Err(err) => {
                    fingerprint.extend_from_slice(err.code.as_bytes());
                    if let Ok(p) = e.path.path() {
                        if let Ok(meta) = std::fs::symlink_metadata(self.root.join(p)) {
                            use std::os::unix::fs::MetadataExt;
                            fingerprint.extend_from_slice(
                                format!("{}:{}:{}", meta.len(), meta.mtime(), meta.mtime_nsec())
                                    .as_bytes(),
                            );
                        }
                    }
                }
            }
        }
        Ok(RepoState {
            repo_id: self.repo_id,
            worktree_id: self.worktree_id,
            generation: hash(&fingerprint),
            head_oid: head,
            branch,
            status_entries: entries,
            capabilities: vec!["git.read".into()],
        })
    }
    pub fn history(&self, cursor: Option<&str>, limit: usize) -> Result<HistoryPage> {
        if limit == 0 || limit > 500 {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        let Some(head) = self.head() else {
            return Ok(HistoryPage {
                commits: vec![],
                cursor: None,
            });
        };
        let refs = hash(format!("{head}:{}", self.refs_fingerprint()?).as_bytes());
        let offset = if let Some(c) = cursor {
            let (h, n) = c
                .split_once(':')
                .ok_or_else(|| AppError::new("INVALID_CURSOR"))?;
            if h != refs {
                return Err(AppError::new("STALE_STATE"));
            }
            n.parse::<usize>()
                .map_err(|_| AppError::new("INVALID_CURSOR"))?
        } else {
            0
        };
        if offset > 1000000 {
            return Err(AppError::new("INVALID_CURSOR"));
        }
        let raw = self.run(&[
            "log",
            "--topo-order",
            &format!("--skip={offset}"),
            &format!("-{}", limit + 1),
            "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00",
            "--all",
            &head,
            "--",
        ])?;
        let mut chunks = raw.split(|b| *b == 0);
        let mut commits = vec![];
        loop {
            let Some(oid) = chunks.next() else { break };
            let oid = String::from_utf8_lossy(oid).trim().to_owned();
            if oid.is_empty() {
                break;
            }
            let parents = String::from_utf8_lossy(
                chunks
                    .next()
                    .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?,
            )
            .split_whitespace()
            .map(str::to_owned)
            .collect();
            let subject = String::from_utf8_lossy(
                chunks
                    .next()
                    .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?,
            )
            .into_owned();
            let author = String::from_utf8_lossy(
                chunks
                    .next()
                    .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?,
            )
            .into_owned();
            let date = String::from_utf8_lossy(
                chunks
                    .next()
                    .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?,
            )
            .into_owned();
            commits.push(Commit {
                author,
                date,
                oid,
                parents,
                subject,
            });
        }
        let after_head = self.head().ok_or_else(|| AppError::new("STALE_STATE"))?;
        if hash(format!("{after_head}:{}", self.refs_fingerprint()?).as_bytes()) != refs {
            return Err(AppError::new("STALE_STATE"));
        }
        let more = commits.len() > limit;
        commits.truncate(limit);
        Ok(HistoryPage {
            commits,
            cursor: more.then(|| format!("{refs}:{}", offset + limit)),
        })
    }
    /// Walk each component relative to an already-open directory; no symlink follows.
    pub fn read_worktree(&self, path: &RepoPath) -> Result<Option<Vec<u8>>> {
        let bytes = path.bytes()?;
        let mut dir = std::fs::File::open(&self.root).map_err(|_| AppError::new("IO_ERROR"))?;
        let components: Vec<_> = bytes.split(|b| *b == b'/').collect();
        for (i, component) in components.iter().enumerate() {
            let name = CString::new(*component).unwrap();
            let last = i + 1 == components.len();
            let flags = libc::O_RDONLY
                | libc::O_NOFOLLOW
                | libc::O_CLOEXEC
                | libc::O_NONBLOCK
                | if last { 0 } else { libc::O_DIRECTORY };
            let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
            if fd < 0 {
                let e = std::io::Error::last_os_error();
                if e.raw_os_error() == Some(libc::ENOENT) {
                    return Ok(None);
                }
                return Err(AppError::new("PATH_EXCLUDED"));
            }
            dir = unsafe { std::fs::File::from_raw_fd(fd) };
        }
        let meta = dir.metadata().map_err(|_| AppError::new("IO_ERROR"))?;
        if !meta.is_file() {
            return Err(AppError::new("PATH_EXCLUDED"));
        }
        if meta.len() > 2 * 1024 * 1024 {
            return Err(AppError::new("FILE_TOO_LARGE"));
        }
        let mut data = vec![];
        dir.take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| AppError::new("IO_ERROR"))?;
        if data.len() > 2 * 1024 * 1024 {
            return Err(AppError::new("FILE_TOO_LARGE"));
        }
        Ok(Some(data))
    }
}

pub fn parse_status(raw: &[u8]) -> Result<Vec<StatusEntry>> {
    let mut entries = vec![];
    let mut parts = raw.split(|b| *b == 0).filter(|s| !s.is_empty());
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            return Err(AppError::new("INVALID_GIT_OUTPUT"));
        }
        let path = RepoPath::from_bytes(&entry[3..])?;
        let rename = entry[..2].iter().any(|b| *b == b'R' || *b == b'C');
        let original_path = if rename {
            Some(RepoPath::from_bytes(
                parts
                    .next()
                    .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?,
            )?)
        } else {
            None
        };
        entries.push(StatusEntry {
            path,
            original_path,
            status: String::from_utf8_lossy(&entry[..2]).into_owned(),
        });
    }
    Ok(entries)
}
