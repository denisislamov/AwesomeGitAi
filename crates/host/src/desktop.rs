use crate::HostService;
use agai_protocol::*;
use std::path::Path;
fn validate_oid(oid: &str) -> Result<()> {
    if [40, 64].contains(&oid.len()) && oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(AppError::new("INVALID_REVISION"))
    }
}
impl HostService {
    pub fn desktop(
        &mut self,
        principal: &Principal,
        request: DesktopRequest,
    ) -> Result<DesktopResponse> {
        if !matches!(principal, Principal::LocalUser) {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let response = match request {
            DesktopRequest::LearningList { scope } => self.learning_list(scope)?,
            DesktopRequest::LearningGet {
                scope,
                id,
                artifact_kind,
            } => self.learning_get(scope, id, artifact_kind)?,
            DesktopRequest::GitStart {
                scope,
                expected_generation,
                action,
            } => self.start_git(scope, expected_generation, action)?,
            DesktopRequest::GitPoll { id } => self.operations.poll(id)?,
            DesktopRequest::GitCancel { id } => self.operations.cancel(id)?,
            DesktopRequest::GitShutdown => {
                self.operations.stop();
                DesktopResponse::GitStopped
            }
            DesktopRequest::CreateRepository { path, source } => {
                self.operations.create(path, source)?
            }
            DesktopRequest::GitRemotes { scope } => DesktopResponse::GitRemotes {
                names: String::from_utf8_lossy(
                    &self
                        .reader(scope.repo_id, scope.worktree_id)?
                        .run(&["remote"])?,
                )
                .lines()
                .map(str::to_owned)
                .collect(),
            },
            DesktopRequest::PrepareSelection {
                scope,
                comparison_id,
                path,
                expected_generation,
                old_lines,
                new_lines,
                unstage,
            } => self.prepare_selection(
                scope,
                comparison_id,
                path,
                expected_generation,
                old_lines,
                new_lines,
                unstage,
            )?,
            DesktopRequest::CreateAgentGrant { scope } => self.create_agent_grant(scope)?,
            DesktopRequest::GetDecisions {
                scope,
                comparison_id,
                path,
            } => self.decisions(scope, comparison_id, path)?,
            DesktopRequest::ReviewDecision {
                scope,
                decision_id,
                base_snapshot_id,
                target_snapshot_id,
                state,
                note,
                idempotency_key,
            } => self.review_decision(
                scope,
                decision_id,
                base_snapshot_id,
                target_snapshot_id,
                state,
                note,
                idempotency_key,
            )?,
            DesktopRequest::OpenRepository { path } => {
                let state = self.register_repository(Path::new(&path))?;
                let reader = self.reader(state.repo_id, state.worktree_id)?;
                let refs = reader.run(&[
                    "for-each-ref",
                    "--format=%(refname)%00%(objectname)",
                    "refs/heads/",
                    "refs/remotes/",
                ])?;
                let mut branches = vec![];
                for line in refs.split(|b| *b == b'\n').filter(|s| !s.is_empty()) {
                    let zero = line
                        .iter()
                        .position(|b| *b == 0)
                        .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?;
                    let (name, tail) = line.split_at(zero);
                    let oid = &tail[1..];
                    let name = String::from_utf8_lossy(name).into_owned();
                    let remote = name.starts_with("refs/remotes/");
                    branches.push(BranchRef {
                        name: name
                            .trim_start_matches("refs/heads/")
                            .trim_start_matches("refs/remotes/")
                            .into(),
                        oid: String::from_utf8_lossy(oid).into_owned(),
                        remote,
                    });
                }
                DesktopResponse::Repository {
                    state,
                    branches,
                    root: reader.root.to_string_lossy().into_owned(),
                }
            }
            DesktopRequest::CommitDetails { scope, oid, base } => {
                validate_oid(&oid)?;
                let r = self.reader(scope.repo_id, scope.worktree_id)?;
                let raw = r.run(&["show", "-s", "--format=%an%x00%aI%x00%B%x00%P", &oid, "--"])?;
                let fields: Vec<_> = raw.split(|b| *b == 0).collect();
                if fields.len() != 4 {
                    return Err(AppError::new("INVALID_GIT_OUTPUT"));
                }
                let parents: Vec<String> = String::from_utf8_lossy(fields[3])
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect();
                if let Some(ref base) = base {
                    validate_oid(base)?;
                    r.run(&["cat-file", "-e", &format!("{base}^{{commit}}")])?;
                }
                let base_oid = base.or_else(|| parents.first().cloned());
                let paths = if let Some(parent) = base_oid.as_ref() {
                    r.run(&[
                        "diff-tree",
                        "--no-commit-id",
                        "--name-only",
                        "--no-renames",
                        "-r",
                        "-z",
                        parent,
                        &oid,
                        "--",
                    ])?
                } else {
                    r.run(&[
                        "diff-tree",
                        "--root",
                        "--no-commit-id",
                        "--name-only",
                        "--no-renames",
                        "-r",
                        "-z",
                        &oid,
                        "--",
                    ])?
                };
                DesktopResponse::CommitDetails {
                    oid,
                    base_oid,
                    author: String::from_utf8_lossy(fields[0]).into_owned(),
                    date: String::from_utf8_lossy(fields[1]).into_owned(),
                    message: String::from_utf8_lossy(fields[2]).trim().into(),
                    parents: String::from_utf8_lossy(fields[3])
                        .split_whitespace()
                        .map(str::to_owned)
                        .collect(),
                    paths: paths
                        .split(|b| *b == 0)
                        .filter(|b| !b.is_empty())
                        .map(RepoPath::from_bytes)
                        .collect::<Result<Vec<_>>>()?,
                }
            }
            DesktopRequest::ListFiles { scope, revision } => {
                let r = self.reader(scope.repo_id, scope.worktree_id)?;
                let raw = if let Some(ref oid) = revision {
                    validate_oid(&oid)?;
                    r.run(&["ls-tree", "-r", "--name-only", "-z", &oid, "--"])?
                } else {
                    r.run(&[
                        "ls-files",
                        "-z",
                        "--cached",
                        "--others",
                        "--exclude-standard",
                    ])?
                };
                let mut paths = std::collections::BTreeMap::new();
                for bytes in raw.split(|b| *b == 0).filter(|s| !s.is_empty()) {
                    paths.insert(bytes.to_vec(), RepoPath::from_bytes(bytes)?);
                }
                // Deleted/renamed original names remain selectable for old-side inspection.
                if revision.is_none() {
                    for entry in r.state()?.status_entries {
                        if let Some(p) = entry.original_path {
                            paths.insert(p.bytes()?, p);
                        }
                    }
                }
                DesktopResponse::Files {
                    paths: paths.into_values().collect(),
                }
            }
            DesktopRequest::CompareFile {
                scope,
                path,
                base,
                target,
            } => {
                path.bytes()?;
                let r = self.reader(scope.repo_id, scope.worktree_id)?;
                let observed_generation = r.state()?.generation;
                let live = matches!(base, Revision::Head | Revision::Index | Revision::Worktree)
                    || matches!(
                        target,
                        Revision::Head | Revision::Index | Revision::Worktree
                    );
                let captured = if live {
                    let generation = r.generation_for_paths(&[path.clone()])?;
                    Some(agai_domain::capture(
                        &r,
                        &mut self.store,
                        &[path.clone()],
                        &generation,
                    )?)
                } else {
                    None
                };
                let mut endpoint = |revision: Revision| -> Result<Snapshot> {
                    let id = match revision {
                        Revision::Empty => {
                            let id = uuid::Uuid::new_v4();
                            let snapshot = Snapshot {
                                id,
                                repo_id: scope.repo_id,
                                worktree_id: scope.worktree_id,
                                layer: Layer::Head,
                                generation: "empty-tree".into(),
                                files: vec![SnapshotFile::new(path.clone(), None, None)],
                                exclusions: vec![],
                                captured_at: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_millis()
                                    .to_string(),
                            };
                            self.store.append_event(
                                &RequestMeta {
                                    schema_version: 1,
                                    request_id: uuid::Uuid::new_v4(),
                                    idempotency_key: Some(uuid::Uuid::new_v4()),
                                },
                                &EventInput {
                                    repo_id: scope.repo_id,
                                    worktree_id: scope.worktree_id,
                                    kind: "snapshot_capture".into(),
                                    entity_id: id,
                                    summary: "Empty tree baseline".into(),
                                },
                                &[snapshot],
                            )?;
                            id
                        }
                        Revision::Head => captured.as_ref().unwrap().head_snapshot_id,
                        Revision::Index => captured.as_ref().unwrap().index_snapshot_id,
                        Revision::Worktree => captured.as_ref().unwrap().worktree_snapshot_id,
                        Revision::Commit { oid } => {
                            agai_domain::capture_commit(&r, &mut self.store, &[path.clone()], &oid)?
                        }
                        Revision::Snapshot { id } => id,
                    };
                    let s = self.store.snapshot(id)?;
                    if s.repo_id != scope.repo_id || s.worktree_id != scope.worktree_id {
                        return Err(AppError::new("SCOPE_DENIED"));
                    }
                    if let Some(e) = s
                        .exclusions
                        .iter()
                        .find(|e| e.path.raw_base64 == path.raw_base64)
                    {
                        return Err(AppError::new(&e.reason));
                    }
                    if !s.files.iter().any(|f| f.path.raw_base64 == path.raw_base64) {
                        return Err(AppError::new("INCOMPLETE_COMPARISON"));
                    }
                    Ok(s)
                };
                let a = endpoint(base)?;
                let b = endpoint(target)?;
                let comparison = agai_domain::compare(&mut self.store, a.id, b.id)?;
                DesktopResponse::FileComparison {
                    comparison,
                    base: a,
                    target: b,
                    observed_generation,
                }
            }
        };
        if serde_json::to_vec(&response)
            .map_err(|_| AppError::new("INVALID_DATA"))?
            .len()
            > crate::local_ipc::MAX_FRAME - 1024
        {
            return Err(AppError::new("CAPTURE_TOO_LARGE"));
        }
        Ok(response)
    }
}
