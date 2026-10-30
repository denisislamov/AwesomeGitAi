//! Local-user Git mutations. Index writes are prepared off-index, then installed under index.lock.
use crate::GitReader;
use agai_protocol::*;
use fs2::FileExt;
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::{
        ffi::OsStringExt,
        fs::{OpenOptionsExt, PermissionsExt},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
#[derive(Clone, Debug)]
pub enum Mutation {
    Stage {
        path: RepoPath,
    },
    Unstage {
        path: RepoPath,
    },
    IndexBytes {
        path: RepoPath,
        bytes: Option<Vec<u8>>,
    },
    Commit {
        message: String,
    },
    CreateBranch {
        name: String,
    },
    SwitchBranch {
        name: String,
    },
    Fetch {
        remote: String,
    },
    Pull {
        remote: String,
        branch: String,
    },
    Push {
        remote: String,
        branch: String,
    },
}
fn err(s: &str) -> AppError {
    AppError::new(s)
}
fn io(_: std::io::Error) -> AppError {
    err("GIT_IO_ERROR")
}
fn args(a: &[&str]) -> Vec<OsString> {
    a.iter().map(OsString::from).collect()
}
fn git_path(r: &GitReader, name: &str) -> Result<PathBuf> {
    let mut bytes = r.run(&["rev-parse", "--path-format=absolute", name])?;
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    Ok(PathBuf::from(OsString::from_vec(bytes)))
}
fn index_path(r: &GitReader) -> Result<PathBuf> {
    let mut bytes = r.run(&["rev-parse", "--path-format=absolute", "--git-path", "index"])?;
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    Ok(PathBuf::from(OsString::from_vec(bytes)))
}
fn lock_repo(r: &GitReader) -> Result<File> {
    let p = git_path(r, "--git-common-dir")?.join("agai-operation.lock");
    let f = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(p)
        .map_err(io)?;
    f.try_lock_exclusive().map_err(|_| err("REPOSITORY_BUSY"))?;
    Ok(f)
}
fn validate_branch(r: &GitReader, name: &str) -> Result<()> {
    if name.starts_with('-') || name.len() > 255 || name == "HEAD" {
        return Err(err("INVALID_BRANCH"));
    }
    r.run(&["check-ref-format", "--branch", name])
        .map_err(|_| err("INVALID_BRANCH"))?;
    Ok(())
}
fn remote(r: &GitReader, name: &str) -> Result<()> {
    if name.starts_with('-') || name.is_empty() {
        return Err(err("INVALID_REMOTE"));
    }
    if !String::from_utf8_lossy(&r.run(&["remote"])?)
        .lines()
        .any(|s| s == name)
    {
        return Err(err("INVALID_REMOTE"));
    }
    Ok(())
}
fn generation(r: &GitReader, expected: &str) -> Result<()> {
    if r.state()?.generation != expected {
        return Err(err("STALE_STATE"));
    }
    Ok(())
}
/// Bounded process-group cancellation. Diagnostics never include raw credentials or hook output.
fn command(
    root: &Path,
    a: &[OsString],
    index: Option<&Path>,
    input: Option<Vec<u8>>,
    cancel: &AtomicBool,
) -> Result<Vec<u8>> {
    if cancel.load(Ordering::Relaxed) {
        return Err(err("CANCELLED"));
    }
    let mut c = Command::new("git");
    c.process_group(0)
        .args([
            "--no-pager",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "protocol.ext.allow=never",
            "-c",
            "merge.autoStash=false",
            "-c",
            "rebase.autoStash=false",
            "-C",
        ])
        .arg(root)
        .args(a)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        c.env_remove(key);
    }
    if let Some(p) = index {
        c.env("GIT_INDEX_FILE", p);
    }
    let mut child = c.spawn().map_err(|_| err("GIT_UNAVAILABLE"))?;
    let writer = input.map(|bytes| {
        let mut stdin = child.stdin.take().unwrap();
        thread::spawn(move || stdin.write_all(&bytes))
    });
    fn drain(mut s: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
        thread::spawn(move || {
            let mut out = vec![];
            let mut buf = [0; 8192];
            while let Ok(n) = s.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let keep = n.min((128 * 1024usize).saturating_sub(out.len()));
                out.extend_from_slice(&buf[..keep]);
            }
            out
        })
    }
    let out = drain(child.stdout.take().unwrap());
    let stderr = drain(child.stderr.take().unwrap());
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(io)? {
            if out.is_finished() && stderr.is_finished() {
                break status;
            }
        }
        if cancel.load(Ordering::Relaxed) || start.elapsed() > Duration::from_secs(120) {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(err(if cancel.load(Ordering::Relaxed) {
                "CANCELLED"
            } else {
                "GIT_TIMEOUT"
            }));
        }
        thread::sleep(Duration::from_millis(10));
    };
    if let Some(w) = writer {
        if w.is_finished() {
            let _ = w.join();
        }
    }
    let out = out.join().map_err(|_| err("GIT_IO_ERROR"))?;
    let diagnostic = stderr.join().map_err(|_| err("GIT_IO_ERROR"))?;
    if !status.success() {
        let d = String::from_utf8_lossy(&diagnostic).to_lowercase();
        return Err(err(
            if d.contains("terminal prompts disabled")
                || d.contains("permission denied (publickey)")
                || d.contains("could not read username")
            {
                "AUTH_INTERACTION_REQUIRED"
            } else if d.contains("not possible to fast-forward") || d.contains("divergent branches")
            {
                "NON_FAST_FORWARD"
            } else if d.contains("index.lock") {
                "INDEX_LOCKED"
            } else {
                "GIT_COMMAND_FAILED"
            },
        ));
    }
    Ok(out)
}
fn read_index(path: &Path) -> Result<Option<Vec<u8>>> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(err("UNSAFE_INDEX"));
    }
    match fs::read(path) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(e)),
    }
}
struct TempLock(PathBuf);
impl Drop for TempLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
pub struct IndexTransaction {
    root: PathBuf,
    index: PathBuf,
    before: Option<Vec<u8>>,
    head: Option<String>,
    generation: String,
    temp: tempfile::NamedTempFile,
    _temp_lock: TempLock,
    _lock: File,
}
impl IndexTransaction {
    pub fn prepare(
        r: &GitReader,
        m: Mutation,
        expected: &str,
        cancel: &AtomicBool,
    ) -> Result<Self> {
        let lock = lock_repo(r)?;
        generation(r, expected)?;
        let index = index_path(r)?;
        let before = read_index(&index)?;
        let head = r.head();
        let temp = tempfile::Builder::new()
            .prefix("agai-index-")
            .tempfile_in(index.parent().ok_or_else(|| err("UNSAFE_INDEX"))?)
            .map_err(io)?;
        let mut temp_lock_path = temp.path().as_os_str().to_owned();
        temp_lock_path.push(".lock");
        let temp_lock = TempLock(PathBuf::from(temp_lock_path));
        if let Some(bytes) = &before {
            fs::write(temp.path(), bytes).map_err(io)?;
        } else {
            fs::remove_file(temp.path()).map_err(io)?;
            command(
                &r.root,
                &args(&["read-tree", "--empty"]),
                Some(temp.path()),
                None,
                cancel,
            )?;
        }
        match m {
            Mutation::Stage { path } => {
                let mut a = args(&["add", "--"]);
                a.push(path.path()?.into_os_string());
                command(&r.root, &a, Some(temp.path()), None, cancel)?;
            }
            Mutation::Unstage { path } => {
                let mut a = if head.is_some() {
                    args(&["restore", "--source=HEAD", "--staged", "--"])
                } else {
                    args(&["update-index", "--force-remove", "--"])
                };
                a.push(path.path()?.into_os_string());
                command(&r.root, &a, Some(temp.path()), None, cancel)?;
            }
            Mutation::IndexBytes { path, bytes } => {
                let p = path.path()?;
                // Arbitrary filters/encodings can change line identities. Whole-file staging remains available.
                let mut check =
                    args(&["check-attr", "-z", "filter", "working-tree-encoding", "--"]);
                check.push(p.clone().into_os_string());
                let attrs = r.raw(&check)?;
                let fields: Vec<_> = attrs.split(|b| *b == 0).collect();
                if fields
                    .chunks(3)
                    .any(|c| c.len() == 3 && c[2] != b"unspecified" && c[2] != b"unset")
                {
                    return Err(err("PARTIAL_FILTER_UNSUPPORTED"));
                }
                if let Some(bytes) = bytes {
                    if bytes.len() > 2 * 1024 * 1024 || bytes.contains(&0) {
                        return Err(err("PARTIAL_BINARY_UNSUPPORTED"));
                    }
                    let mut staged = args(&["ls-files", "--stage", "-z", "--"]);
                    staged.push(p.clone().into_os_string());
                    let existing = r.raw(&staged)?;
                    if existing
                        .split(|b| *b == 0)
                        .filter(|s| !s.is_empty())
                        .any(|e| {
                            !e.split(|b| *b == b'\t')
                                .next()
                                .unwrap_or_default()
                                .ends_with(b" 0")
                        })
                    {
                        return Err(err("UNRESOLVED_CONFLICT"));
                    }
                    let mode = if existing.starts_with(b"100755 ") {
                        "100755"
                    } else if existing.is_empty() {
                        if fs::symlink_metadata(r.root.join(&p))
                            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
                        {
                            "100755"
                        } else {
                            "100644"
                        }
                    } else if existing.starts_with(b"100644 ") {
                        "100644"
                    } else {
                        return Err(err("PARTIAL_MODE_UNSUPPORTED"));
                    };
                    let mut hash_args = args(&["hash-object", "-w", "--stdin"]);
                    let mut attr_path = OsString::from("--path=");
                    attr_path.push(&p);
                    hash_args.push(attr_path);
                    let oid = command(&r.root, &hash_args, None, Some(bytes.clone()), cancel)?;
                    let oid = String::from_utf8_lossy(&oid).trim().to_string();
                    if r.run(&["cat-file", "blob", &oid])? != bytes {
                        return Err(err("PARTIAL_FILTER_UNSUPPORTED"));
                    }
                    let mut a = args(&["update-index", "--add", "--cacheinfo", mode, &oid]);
                    a.push(p.into_os_string());
                    command(&r.root, &a, Some(temp.path()), None, cancel)?;
                } else {
                    let mut a = args(&["update-index", "--force-remove", "--"]);
                    a.push(p.into_os_string());
                    command(&r.root, &a, Some(temp.path()), None, cancel)?;
                }
            }
            _ => return Err(err("INVALID_REQUEST")),
        }
        Ok(Self {
            root: r.root.clone(),
            index,
            before,
            head,
            generation: expected.into(),
            temp,
            _temp_lock: temp_lock,
            _lock: lock,
        })
    }
    pub fn commit(self, cancel: &AtomicBool) -> Result<()> {
        let r = GitReader::new(&self.root)?;
        let lockpath = self.index.with_extension("lock");
        let mut lock = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&lockpath)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    err("INDEX_LOCKED")
                } else {
                    io(e)
                }
            })?;
        struct Cleanup(Option<PathBuf>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                if let Some(p) = &self.0 {
                    let _ = fs::remove_file(p);
                }
            }
        }
        let mut cleanup = Cleanup(Some(lockpath.clone()));
        if cancel.load(Ordering::Relaxed) {
            return Err(err("CANCELLED"));
        }
        if read_index(&self.index)? != self.before || r.head() != self.head {
            return Err(err("STALE_STATE"));
        }
        generation(&r, &self.generation)?;
        let bytes = fs::read(self.temp.path()).map_err(io)?;
        lock.write_all(&bytes).map_err(io)?;
        lock.sync_all().map_err(io)?;
        if cancel.load(Ordering::Relaxed) {
            return Err(err("CANCELLED"));
        }
        if read_index(&self.index)? != self.before || r.head() != self.head {
            return Err(err("STALE_STATE"));
        }
        fs::rename(&lockpath, &self.index).map_err(io)?;
        cleanup.0 = None;
        File::open(self.index.parent().unwrap())
            .map_err(io)?
            .sync_all()
            .map_err(io)?;
        Ok(())
    }
}
pub fn execute(r: &GitReader, m: Mutation, expected: &str, cancel: &AtomicBool) -> Result<()> {
    if matches!(
        m,
        Mutation::Stage { .. } | Mutation::Unstage { .. } | Mutation::IndexBytes { .. }
    ) {
        return IndexTransaction::prepare(r, m, expected, cancel)?.commit(cancel);
    }
    let _lock = lock_repo(r)?;
    generation(r, expected)?;
    match m {
        Mutation::Commit { message } => {
            if message.trim().is_empty() || message.len() > 64 * 1024 {
                return Err(err("INVALID_COMMIT_MESSAGE"));
            }
            command(
                &r.root,
                &args(&["commit", "-F", "-"]),
                None,
                Some(message.into_bytes()),
                cancel,
            )?;
        }
        Mutation::CreateBranch { name } => {
            validate_branch(r, &name)?;
            command(&r.root, &args(&["branch", "--", &name]), None, None, cancel)?;
        }
        Mutation::SwitchBranch { name } => {
            validate_branch(r, &name)?;
            command(&r.root, &args(&["switch", "--", &name]), None, None, cancel)?;
        }
        Mutation::Fetch { remote: name } => {
            remote(r, &name)?;
            command(
                &r.root,
                &args(&["fetch", "--progress", &name]),
                None,
                None,
                cancel,
            )?;
        }
        Mutation::Pull {
            remote: name,
            branch,
        } => {
            remote(r, &name)?;
            validate_branch(r, &branch)?;
            command(
                &r.root,
                &args(&["pull", "--ff-only", "--no-rebase", &name, &branch]),
                None,
                None,
                cancel,
            )?;
        }
        Mutation::Push {
            remote: name,
            branch,
        } => {
            remote(r, &name)?;
            validate_branch(r, &branch)?;
            command(
                &r.root,
                &args(&[
                    "push",
                    "--porcelain",
                    "--no-follow-tags",
                    &name,
                    &format!("HEAD:refs/heads/{branch}"),
                ]),
                None,
                None,
                cancel,
            )?;
        }
        _ => return Err(err("INVALID_REQUEST")),
    };
    Ok(())
}
/// Deterministic line diff, bounded after stripping common prefix/suffix. Selection is inclusive and 1-based.
pub fn select_lines(
    old: &[u8],
    new: &[u8],
    old_selected: &[u32],
    new_selected: &[u32],
) -> Result<Vec<u8>> {
    if old.contains(&0)
        || new.contains(&0)
        || std::str::from_utf8(old).is_err()
        || std::str::from_utf8(new).is_err()
    {
        return Err(err("PARTIAL_BINARY_UNSUPPORTED"));
    }
    let a: Vec<_> = old.split_inclusive(|b| *b == b'\n').collect();
    let b: Vec<_> = new.split_inclusive(|b| *b == b'\n').collect();
    if old_selected
        .iter()
        .any(|n| *n == 0 || *n as usize > a.len())
        || new_selected
            .iter()
            .any(|n| *n == 0 || *n as usize > b.len())
    {
        return Err(err("INVALID_SELECTION"));
    }
    let mut prefix = 0;
    while prefix < a.len().min(b.len()) && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < a.len().min(b.len()) - prefix
        && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let aa = &a[prefix..a.len() - suffix];
    let bb = &b[prefix..b.len() - suffix];
    let cols = bb.len() + 1;
    if (aa.len() + 1).saturating_mul(cols) > 4_000_000 {
        return Err(err("PARTIAL_DIFF_TOO_LARGE"));
    }
    let mut dp = vec![0u32; (aa.len() + 1) * cols];
    for i in (0..aa.len()).rev() {
        for j in (0..bb.len()).rev() {
            dp[i * cols + j] = if aa[i] == bb[j] {
                1 + dp[(i + 1) * cols + j + 1]
            } else {
                dp[(i + 1) * cols + j].max(dp[i * cols + j + 1])
            };
        }
    }
    let mut out = a[..prefix].concat();
    let (mut i, mut j) = (0, 0);
    while i < aa.len() || j < bb.len() {
        if i < aa.len() && j < bb.len() && aa[i] == bb[j] {
            out.extend_from_slice(aa[i]);
            i += 1;
            j += 1;
        } else if i < aa.len() && (j == bb.len() || dp[(i + 1) * cols + j] >= dp[i * cols + j + 1])
        {
            if !old_selected.contains(&((prefix + i + 1) as u32)) {
                out.extend_from_slice(aa[i]);
            }
            i += 1;
        } else {
            if new_selected.contains(&((prefix + j + 1) as u32)) {
                out.extend_from_slice(bb[j]);
            }
            j += 1;
        }
    }
    out.extend_from_slice(&a[a.len() - suffix..].concat());
    if out == old {
        return Err(err("NO_SELECTED_CHANGES"));
    }
    Ok(out)
}

/// Creates only a new or empty destination; a cancelled clone is retained for inspection.
pub fn create_repository(
    destination: &Path,
    source: Option<&str>,
    cancel: &AtomicBool,
) -> Result<()> {
    if !destination.is_absolute() || destination.file_name().is_none() {
        return Err(err("INVALID_DESTINATION"));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| err("INVALID_DESTINATION"))?;
    if !parent.is_dir() {
        return Err(err("INVALID_DESTINATION"));
    }
    if destination.exists()
        && (source.is_some()
            || !destination.is_dir()
            || fs::read_dir(destination).map_err(io)?.next().is_some())
    {
        return Err(err("DESTINATION_NOT_EMPTY"));
    }
    let mut a = if let Some(source) = source {
        if source.is_empty()
            || source.starts_with('-')
            || source.starts_with("ext::")
            || source.len() > 4096
        {
            return Err(err("INVALID_REMOTE"));
        }
        args(&["clone", "--progress", "--", source])
    } else {
        args(&["init", "--initial-branch=main", "--"])
    };
    a.push(destination.as_os_str().to_owned());
    command(parent, &a, None, None, cancel)?;
    Ok(())
}
