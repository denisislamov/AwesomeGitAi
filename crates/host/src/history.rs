//! Private sibling Git history. No shell, network, hooks, filters, checkout or code-Git writes.
use crate::HostService;
use agai_protocol::*;
use agai_storage::HistoryImage;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use uuid::Uuid;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    version: u32,
    repo_id: Uuid,
    worktree_id: Uuid,
}
#[derive(Clone)]
pub(crate) struct Cache {
    root: PathBuf,
    revision: (u64, i64),
    head: Option<String>,
}
fn error(code: &str) -> AppError {
    AppError::new(code)
}
fn io(_: std::io::Error) -> AppError {
    error("HISTORY_IO_ERROR")
}
pub fn location(root: &Path) -> Result<PathBuf> {
    let mut name = root
        .file_name()
        .ok_or_else(|| error("HISTORY_INVALID_PATH"))?
        .to_os_string();
    name.push(".history");
    Ok(root
        .parent()
        .ok_or_else(|| error("HISTORY_INVALID_PATH"))?
        .join(name))
}
fn command(path: &Path) -> Command {
    let mut c = Command::new("/usr/bin/git");
    c.env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", "/var/empty")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "AwesomeGitAi")
        .env("GIT_AUTHOR_EMAIL", "history@localhost")
        .env("GIT_COMMITTER_NAME", "AwesomeGitAi")
        .env("GIT_COMMITTER_EMAIL", "history@localhost")
        .arg("--no-pager")
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-c")
        .arg("gc.auto=0")
        .arg("-c")
        .arg("core.fsync=committed")
        .arg("-c")
        .arg("commit.gpgSign=false")
        .arg("-c")
        .arg("core.logAllRefUpdates=false")
        .arg("--git-dir")
        .arg(path);
    c
}
fn git(path: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>> {
    let mut c = command(path);
    c.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        c.stdin(Stdio::piped());
    } else {
        c.stdin(Stdio::null());
    }
    let mut child = c.spawn().map_err(io)?;
    if let Some(bytes) = input {
        child.stdin.take().unwrap().write_all(bytes).map_err(io)?;
    }
    let out = child.wait_with_output().map_err(io)?;
    if !out.status.success() {
        return Err(error("HISTORY_GIT_ERROR"));
    }
    Ok(out.stdout)
}
fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes)
        .map(|s| s.trim().into())
        .map_err(|_| error("INVALID_HISTORY"))
}
fn validate_tree(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(io)?;
    if meta.file_type().is_symlink() || meta.uid() != unsafe { libc::geteuid() } {
        return Err(error("HISTORY_UNSAFE_PATH"));
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path).map_err(io)? {
            validate_tree(&entry.map_err(io)?.path())?;
        }
    } else if !meta.is_file() || meta.nlink() != 1 {
        return Err(error("HISTORY_UNSAFE_PATH"));
    }
    Ok(())
}
fn identity(path: &Path) -> Result<Identity> {
    for entry in [
        "",
        "config",
        "HEAD",
        "agai-format.json",
        "refs",
        "refs/heads",
        "objects",
    ] {
        let meta = fs::symlink_metadata(path.join(entry)).map_err(io)?;
        if meta.file_type().is_symlink()
            || meta.uid() != unsafe { libc::geteuid() }
            || (!meta.is_dir() && (!meta.is_file() || meta.nlink() != 1))
        {
            return Err(error("HISTORY_UNSAFE_PATH"));
        }
    }
    if fs::metadata(path).map_err(io)?.permissions().mode() & 0o077 != 0 {
        return Err(error("HISTORY_UNSAFE_PATH"));
    }
    let m: Identity = serde_json::from_slice(
        &fs::read(path.join("agai-format.json")).map_err(|_| error("HISTORY_PATH_OCCUPIED"))?,
    )
    .map_err(|_| error("INVALID_HISTORY"))?;
    if m.version != 1 {
        return Err(error("INVALID_HISTORY"));
    }
    if path.join("objects/info/alternates").exists()
        || path.join("shallow").exists()
        || path.join("info/grafts").exists()
    {
        return Err(error("HISTORY_UNSAFE_REPOSITORY"));
    }
    // Only configuration produced here is accepted. No includes, remotes or executable helpers.
    let config = fs::read_to_string(path.join("config")).map_err(io)?;
    if config != CONFIG {
        return Err(error("HISTORY_UNSAFE_REPOSITORY"));
    }
    if fs::read_to_string(path.join("HEAD")).map_err(io)? != "ref: refs/heads/main\n" {
        return Err(error("HISTORY_UNSAFE_REPOSITORY"));
    }
    let refs = text(git(path, &["for-each-ref", "--format=%(refname)"], None)?)?;
    if !refs.is_empty() && refs != "refs/heads/main" {
        return Err(error("HISTORY_UNSAFE_REPOSITORY"));
    }
    Ok(m)
}
const CONFIG: &str = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n\tlogallrefupdates = false\n";
fn create(path: &Path, r: &agai_git::GitReader) -> Result<()> {
    // A sibling inside an ancestor code repository would leak history into that repository.
    let mut c = Command::new("/usr/bin/git");
    c.env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", "/var/empty")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .arg("-C")
        .arg(path.parent().unwrap())
        .args(["rev-parse", "--show-toplevel"]);
    if c.output().map_err(io)?.status.success() {
        return Err(error("HISTORY_PARENT_IS_REPOSITORY"));
    }
    let tmp = tempfile::Builder::new()
        .prefix(".agai-history-")
        .tempdir_in(path.parent().unwrap())
        .map_err(io)?;
    fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o700)).map_err(io)?;
    git(
        tmp.path(),
        &["init", "--bare", "--initial-branch=main", "--template="],
        None,
    )?;
    fs::write(tmp.path().join("config"), CONFIG).map_err(io)?;
    fs::write(
        tmp.path().join("agai-format.json"),
        serde_json::to_vec(&Identity {
            version: 1,
            repo_id: r.repo_id,
            worktree_id: r.worktree_id,
        })
        .unwrap(),
    )
    .map_err(io)?;
    for name in ["config", "HEAD", "agai-format.json"] {
        fs::File::open(tmp.path().join(name))
            .map_err(io)?
            .sync_all()
            .map_err(io)?;
    }
    fs::File::open(tmp.path())
        .map_err(io)?
        .sync_all()
        .map_err(io)?;
    publish(tmp.path(), path)?;
    fs::File::open(path.parent().unwrap())
        .map_err(io)?
        .sync_all()
        .map_err(io)?;
    Ok(())
}
fn publish(source: &Path, target: &Path) -> Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let from = std::ffi::CString::new(source.as_os_str().as_bytes())
        .map_err(|_| error("HISTORY_INVALID_PATH"))?;
    let to = std::ffi::CString::new(target.as_os_str().as_bytes())
        .map_err(|_| error("HISTORY_INVALID_PATH"))?;
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let result = -1;
    if result != 0 {
        return Err(error("HISTORY_PATH_OCCUPIED"));
    }
    Ok(())
}
fn head(path: &Path) -> Result<Option<String>> {
    if !path.join("refs/heads/main").exists() && !path.join("packed-refs").exists() {
        return Ok(None);
    }
    Ok(Some(text(git(
        path,
        &["rev-parse", "--verify", "refs/heads/main"],
        None,
    )?)?))
}
fn read_image(path: &Path, oid: &str) -> Result<HistoryImage> {
    let bytes = git(path, &["show", &format!("{oid}:state.json")], None)?;
    let image: HistoryImage =
        serde_json::from_slice(&bytes).map_err(|_| error("INVALID_HISTORY"))?;
    image.validate()?;
    Ok(image)
}
fn write_image(path: &Path, image: &HistoryImage, old: Option<&str>, purge: bool) -> Result<()> {
    if purge && !path.join("agai-erase-pending").exists() {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path.join("agai-erase-pending"))
            .map_err(io)?;
        f.write_all(old.unwrap_or("").as_bytes()).map_err(io)?;
        f.sync_all().map_err(io)?;
    }
    let bytes = serde_json::to_vec_pretty(image).map_err(|_| error("INVALID_HISTORY"))?;
    let blob = text(git(path, &["hash-object", "-w", "--stdin"], Some(&bytes))?)?;
    let tree = text(git(
        path,
        &["mktree"],
        Some(format!("100644 blob {blob}\tstate.json\n").as_bytes()),
    )?)?;
    let mut args = vec!["commit-tree", &tree];
    if !purge {
        if let Some(old) = old {
            args.extend(["-p", old]);
        }
    }
    let commit = text(git(
        path,
        &args,
        Some(if purge {
            b"Erase stored context and local history\n"
        } else {
            b"Checkpoint project context\n"
        }),
    )?)?;
    git(
        path,
        &[
            "update-ref",
            "refs/heads/main",
            &commit,
            old.unwrap_or("0000000000000000000000000000000000000000"),
        ],
        None,
    )?;
    if purge {
        finish_purge(path)?;
    }
    Ok(())
}
fn finish_purge(path: &Path) -> Result<()> {
    let pending = path.join("agai-erase-pending");
    if !pending.exists() {
        return Ok(());
    }
    let old = fs::read_to_string(&pending).map_err(io)?;
    let old = old.trim();
    if old.len() != 40 || !old.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(error("INVALID_HISTORY"));
    }
    git(path, &["reflog", "expire", "--expire=now", "--all"], None)?;
    git(path, &["gc", "--prune=now"], None)?;
    if command(path)
        .args(["cat-file", "-e", old])
        .output()
        .map_err(io)?
        .status
        .success()
    {
        return Err(error("HISTORY_ERASURE_FAILED"));
    }
    fs::remove_file(pending).map_err(io)?;
    Ok(())
}
impl HostService {
    pub(crate) fn history_reader(&self, path: &Path) -> Result<agai_git::GitReader> {
        let mut r = agai_git::GitReader::new(path)?;
        let dest = location(&r.root)?;
        if fs::symlink_metadata(&dest).is_ok() {
            let i = identity(&dest)?;
            r.repo_id = i.repo_id;
            r.worktree_id = i.worktree_id;
        }
        Ok(r)
    }
    pub(crate) fn attach_history(&self, r: &agai_git::GitReader) -> Result<()> {
        let dest = location(&r.root)?;
        if fs::symlink_metadata(&dest).is_err() {
            if self.store.history_base(r.repo_id, r.worktree_id)?.is_some() {
                return Err(error("HISTORY_MISSING_REPOSITORY"));
            }
            create(&dest, r)?;
        }
        self.reconcile_history(r, &dest)
    }
    fn reconcile_history(&self, r: &agai_git::GitReader, dest: &Path) -> Result<()> {
        let i = identity(dest)?;
        if i.repo_id != r.repo_id || i.worktree_id != r.worktree_id {
            return Err(error("HISTORY_SCOPE_MISMATCH"));
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(dest.join("agai.lock"))
            .map_err(io)?;
        lock.try_lock_exclusive()
            .map_err(|_| error("HISTORY_BUSY"))?;
        let old = head(dest)?;
        let revision = self.store.history_revision()?;
        if self
            .histories
            .borrow()
            .get(&(r.repo_id, r.worktree_id))
            .is_some_and(|c| c.root == r.root && c.revision == revision && c.head == old)
            && !dest.join("agai-erase-pending").exists()
        {
            return Ok(());
        }
        validate_tree(dest)?;
        let current = self.store.history_image(r.repo_id, r.worktree_id)?;
        let digest = current.digest()?;
        let base = self.store.history_base(r.repo_id, r.worktree_id)?;
        if let Some(ref oid) = old {
            let saved = read_image(dest, oid)?;
            if saved.repo_id != r.repo_id || saved.worktree_id != r.worktree_id {
                return Err(error("HISTORY_SCOPE_MISMATCH"));
            }
            let saved_digest = saved.digest()?;
            if digest == saved_digest {
                finish_purge(dest)?;
                self.store
                    .set_history_base(r.repo_id, r.worktree_id, &digest)?;
                self.cache_history(r, dest)?;
                return Ok(());
            }
            if base.is_none() && current.is_empty() {
                self.store.restore_history(&saved)?;
                if self.store.history_image(r.repo_id, r.worktree_id)? != saved {
                    return Err(error("HISTORY_RESTORE_MISMATCH"));
                }
                self.store
                    .set_history_base(r.repo_id, r.worktree_id, &saved_digest)?;
                self.cache_history(r, dest)?;
                return Ok(());
            }
            if base.as_deref() != Some(&saved_digest) {
                return Err(error("HISTORY_DIVERGED"));
            }
            let purge =
                current.tables["redaction_tombstones"] != saved.tables["redaction_tombstones"];
            write_image(dest, &current, Some(oid), purge)?;
        } else {
            if base.is_some() {
                return Err(error("HISTORY_MISSING_HEAD"));
            }
            write_image(dest, &current, None, false)?;
        }
        let verified = read_image(
            dest,
            &head(dest)?.ok_or_else(|| error("HISTORY_MISSING_HEAD"))?,
        )?;
        if verified != current {
            return Err(error("HISTORY_VERIFY_FAILED"));
        }
        self.store
            .set_history_base(r.repo_id, r.worktree_id, &digest)?;
        self.cache_history(r, dest)?;
        Ok(())
    }
    fn cache_history(&self, r: &agai_git::GitReader, dest: &Path) -> Result<()> {
        self.histories.borrow_mut().insert(
            (r.repo_id, r.worktree_id),
            Cache {
                root: r.root.clone(),
                revision: self.store.history_revision()?,
                head: head(dest)?,
            },
        );
        Ok(())
    }
    pub(crate) fn sync_history(&self, scope: &RepoScope) -> Result<()> {
        let r = self.reader(scope.repo_id, scope.worktree_id)?;
        self.attach_history(&r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publication_is_exclusive_and_complete_after_interruption() {
        let d = tempfile::tempdir().unwrap();
        let staged = d.path().join("staged");
        let target = d.path().join("target");
        fs::create_dir(&staged).unwrap();
        fs::write(staged.join("complete"), "yes").unwrap();
        // A crash before publication leaves no target; retry publishes the entire prepared directory.
        assert!(!target.exists());
        publish(&staged, &target).unwrap();
        assert_eq!(fs::read_to_string(target.join("complete")).unwrap(), "yes");
        let retry = d.path().join("retry");
        fs::create_dir(&retry).unwrap();
        assert!(publish(&retry, &target).is_err());
        assert!(retry.exists());
        let empty = d.path().join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(publish(&retry, &empty).is_err());
        assert!(empty.exists());
    }
}
