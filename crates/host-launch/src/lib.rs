//! On-demand shared local host. No PATH lookup, request replay or UI ownership.
use fs2::FileExt;
use std::{
    fs, io,
    os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        net::UnixStream,
        process::CommandExt,
    },
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub fn connect(profile: &Path, binary: &Path) -> Result<UnixStream, &'static str> {
    if !profile.exists() {
        match fs::DirBuilder::new().mode(0o700).create(profile) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("UNSAFE_PROFILE"),
        }
    }
    let meta = fs::symlink_metadata(profile).map_err(|_| "UNSAFE_PROFILE")?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
        return Err("UNSAFE_PROFILE");
    }
    let socket = profile.join("host.sock");
    if fs::symlink_metadata(&socket).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("UNSAFE_PROFILE");
    }
    if let Ok(stream) = UnixStream::connect(&socket) {
        return Ok(stream);
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(profile.join("host-start.lock"))
        .map_err(|_| "UNSAFE_PROFILE")?;
    let meta = lock.metadata().map_err(|_| "UNSAFE_PROFILE")?;
    if !meta.is_file() || meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
        return Err("UNSAFE_PROFILE");
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match lock.try_lock_exclusive() {
            Ok(()) => break,
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => return Err("HOST_START_FAILED"),
        }
        if let Ok(stream) = UnixStream::connect(&socket) {
            return Ok(stream);
        }
        if Instant::now() >= deadline {
            return Err("HOST_START_TIMEOUT");
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    if let Ok(stream) = UnixStream::connect(&socket) {
        return Ok(stream);
    }
    let mut command = Command::new(binary);
    command
        .arg(profile)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // The host must survive the terminal, MCP process and GUI that started it.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(|_| "HOST_START_FAILED")?;
    loop {
        if let Ok(stream) = UnixStream::connect(&socket) {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(stream);
        }
        if child.try_wait().map_err(|_| "HOST_START_FAILED")?.is_some() {
            return Err("HOST_START_FAILED");
        }
        if Instant::now() >= deadline {
            // Only the unready process we just launched belongs to this attempt.
            let _ = child.kill();
            let _ = child.wait();
            return Err("HOST_START_TIMEOUT");
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::{fs::PermissionsExt, net::UnixListener};
    #[test]
    fn reuses_existing_host_even_if_binary_is_unavailable() {
        let p = tempfile::tempdir().unwrap();
        fs::set_permissions(p.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let _listener = UnixListener::bind(p.path().join("host.sock")).unwrap();
        assert!(connect(p.path(), Path::new("/missing-host")).is_ok());
    }
    #[test]
    fn stale_socket_attempts_start_and_errors_do_not_leak_paths() {
        let p = tempfile::tempdir().unwrap();
        fs::set_permissions(p.path(), fs::Permissions::from_mode(0o700)).unwrap();
        drop(UnixListener::bind(p.path().join("host.sock")).unwrap());
        assert_eq!(
            connect(p.path(), Path::new("/missing-host")).unwrap_err(),
            "HOST_START_FAILED"
        );
    }
    #[test]
    fn unsafe_profile_and_symlink_lock_are_rejected() {
        let p = tempfile::tempdir().unwrap();
        fs::set_permissions(p.path(), fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(p.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            connect(p.path(), Path::new("/missing")).unwrap_err(),
            "UNSAFE_PROFILE"
        );
        fs::set_permissions(p.path(), fs::Permissions::from_mode(0o700)).unwrap();
        std::os::unix::fs::symlink(p.path().join("secret"), p.path().join("host-start.lock"))
            .unwrap();
        assert_eq!(
            connect(p.path(), Path::new("/missing")).unwrap_err(),
            "UNSAFE_PROFILE"
        );
    }
}
