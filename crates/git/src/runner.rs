use agai_protocol::*;
use std::{
    ffi::OsString,
    io::Read,
    os::unix::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
const MAX: usize = 32 * 1024 * 1024;
pub fn run(root: &Path, args: &[OsString], cancel: &AtomicBool) -> Result<Vec<u8>> {
    let mut command = Command::new("git");
    command
        .process_group(0)
        .arg("--no-pager")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
        ])
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(key);
    }
    let mut child = command
        .spawn()
        .map_err(|_| AppError::new("GIT_UNAVAILABLE"))?;
    let overflow = Arc::new(AtomicBool::new(false));
    fn drain(
        mut r: impl Read + Send + 'static,
        overflow: Arc<AtomicBool>,
    ) -> thread::JoinHandle<Vec<u8>> {
        thread::spawn(move || {
            let mut out = Vec::new();
            let mut buf = [0; 8192];
            loop {
                match r.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if out.len() + n > MAX {
                            overflow.store(true, Ordering::Relaxed);
                            break;
                        }
                        out.extend_from_slice(&buf[..n]);
                    }
                }
            }
            out
        })
    }
    let stdout = drain(child.stdout.take().unwrap(), overflow.clone());
    let stderr = drain(child.stderr.take().unwrap(), overflow.clone());
    let start = Instant::now();
    let mut status = None;
    loop {
        let failure = if cancel.load(Ordering::Relaxed) {
            Some("CANCELLED")
        } else if overflow.load(Ordering::Relaxed) || start.elapsed() > Duration::from_secs(15) {
            Some("GIT_LIMIT_EXCEEDED")
        } else {
            None
        };
        if let Some(code) = failure {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            };
            let _ = child.kill();
            let _ = child.wait();
            // Never join a pipe reader that may still be held by an escaped descendant.
            if stdout.is_finished() {
                let _ = stdout.join();
            }
            if stderr.is_finished() {
                let _ = stderr.join();
            }
            return Err(AppError::new(code));
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(Some(s)) => status = Some(s),
                Ok(None) => {}
                Err(_) => {
                    unsafe {
                        libc::kill(-(child.id() as i32), libc::SIGKILL);
                    };
                    let _ = child.wait();
                    return Err(AppError::new("GIT_ERROR"));
                }
            }
        }
        if status.is_some() && stdout.is_finished() && stderr.is_finished() {
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let out = stdout.join().map_err(|_| AppError::new("GIT_ERROR"))?;
    let _ = stderr.join();
    if !status.is_some_and(|s| s.success()) {
        return Err(AppError::new("GIT_ERROR"));
    }
    Ok(out)
}
