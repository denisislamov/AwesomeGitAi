use agai_host::{HostService, Profile, local_ipc::*};
use agai_protocol::*;
#[test]
fn frames_are_length_bounded() {
    let mut out = vec![];
    write_frame(&mut out, b"hello").unwrap();
    assert_eq!(&out[..4], &5u32.to_be_bytes());
    assert_eq!(read_frame(&mut &out[..]).unwrap(), b"hello");
    assert!(read_frame(&mut &u32::MAX.to_be_bytes()[..]).is_err());
    assert!(read_frame(&mut &[0, 0, 0, 3, b'a'][..]).is_err());
}
#[test]
fn one_host_per_profile() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("profile");
    let a = Profile::acquire(&p).unwrap();
    assert!(Profile::acquire(&p).is_err());
    drop(a);
    assert!(Profile::acquire(&p).is_ok());
}
#[test]
fn profile_rejects_symlink() {
    let d = tempfile::tempdir().unwrap();
    let link = d.path().join("link");
    std::os::unix::fs::symlink(d.path(), &link).unwrap();
    assert!(Profile::acquire(&link).is_err());
}
#[test]
fn remote_principal_cannot_use_local_read() {
    let d = tempfile::tempdir().unwrap();
    let service = HostService {
        store: agai_storage::Store::open(&d.path().join("db")).unwrap(),
    };
    assert_eq!(
        service
            .read(
                &Principal::RemoteDevice {
                    device_id: uuid::Uuid::new_v4()
                },
                ReadRequest::Hello {}
            )
            .unwrap_err()
            .code,
        "SCOPE_DENIED"
    );
    assert!(matches!(
        service
            .read(&Principal::LocalUser, ReadRequest::Hello {})
            .unwrap(),
        ReadResponse::Hello {
            schema_version: 1,
            ..
        }
    ));
}
#[test]
fn real_socket_enforces_version_and_response_framing() {
    use std::os::unix::net::UnixStream;
    let d = tempfile::tempdir().unwrap();
    let db = d.path().join("db");
    let (mut client, mut server) = UnixStream::pair().unwrap();
    let worker = std::thread::spawn(move || {
        let service = HostService {
            store: agai_storage::Store::open(&db).unwrap(),
        };
        agai_host::handle(&service, &mut server).unwrap();
    });
    let request = ReadEnvelope {
        meta: RequestMeta {
            schema_version: 99,
            request_id: uuid::Uuid::new_v4(),
            idempotency_key: None,
        },
        request: ReadRequest::Hello {},
    };
    write_frame(&mut client, &serde_json::to_vec(&request).unwrap()).unwrap();
    let response: Result<ReadResponse> =
        serde_json::from_slice(&read_frame(&mut client).unwrap()).unwrap();
    assert_eq!(response.unwrap_err().code, "UNSUPPORTED_VERSION");
    worker.join().unwrap();
}
#[test]
fn rescan_coalesces_bursts_without_losing_latest_state() {
    use std::{
        process::Command,
        time::{Duration, Instant},
    };
    let d = tempfile::tempdir().unwrap();
    assert!(
        Command::new("git")
            .args(["init", "-q"])
            .arg(d.path())
            .status()
            .unwrap()
            .success()
    );
    let (_watch, rx) = agai_host::watch::Watch::start(d.path().to_owned()).unwrap();
    let first = rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
    let start = Instant::now();
    std::fs::write(d.path().join("file"), "one").unwrap();
    let changed = rx.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
    assert_ne!(first.generation, changed.generation);
    assert!(start.elapsed() < Duration::from_secs(1));
    std::fs::write(d.path().join("file"), "two").unwrap();
    std::thread::sleep(Duration::from_millis(250));
    std::fs::write(d.path().join("file"), "three").unwrap();
    std::thread::sleep(Duration::from_millis(250));
    let expected = agai_git::GitReader::new(d.path())
        .unwrap()
        .state()
        .unwrap()
        .generation;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let latest = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap()
            .unwrap();
        if latest.generation == expected {
            break;
        }
    }
}
#[test]
fn registered_repo_scope_and_capture_work_end_to_end() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    assert!(
        std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(repo.join("code.cs"), "class C {}\n").unwrap();
    let mut service = HostService {
        store: agai_storage::Store::open(&d.path().join("db")).unwrap(),
    };
    let state = service.register_repository(&repo).unwrap();
    let captured = service
        .capture(
            &Principal::LocalUser,
            state.repo_id,
            state.worktree_id,
            &[RepoPath::from_bytes(b"code.cs").unwrap()],
            &service
                .prepare_capture(
                    state.repo_id,
                    state.worktree_id,
                    &[RepoPath::from_bytes(b"code.cs").unwrap()],
                )
                .unwrap(),
        )
        .unwrap();
    assert!(matches!(
        service
            .read(
                &Principal::LocalUser,
                ReadRequest::ReadSnapshot {
                    repo_id: state.repo_id,
                    worktree_id: state.worktree_id,
                    snapshot_id: captured.worktree_snapshot_id
                }
            )
            .unwrap(),
        ReadResponse::Snapshot { .. }
    ));
    assert!(
        service
            .read(
                &Principal::LocalUser,
                ReadRequest::GetRepoState {
                    repo_id: uuid::Uuid::new_v4(),
                    worktree_id: state.worktree_id
                }
            )
            .is_err()
    );
}
