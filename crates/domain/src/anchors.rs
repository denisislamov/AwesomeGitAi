use agai_protocol::*;
fn lines(bytes: &[u8]) -> Vec<&[u8]> {
    bytes.split_inclusive(|b| *b == b'\n').collect()
}
pub fn resolve(a: &Anchor, original: &Snapshot, target: &Snapshot) -> Result<AnchorResolution> {
    a.path.bytes()?;
    if a.snapshot_id != original.id
        || original.repo_id != target.repo_id
        || original.worktree_id != target.worktree_id
        || a.start_line == 0
        || a.end_line < a.start_line
    {
        return Err(AppError::new("INVALID_ANCHOR"));
    }
    let Some(old) = original
        .files
        .iter()
        .find(|f| f.path.raw_base64 == a.path.raw_base64 && f.state == FileState::Present)
    else {
        return Ok(AnchorResolution::Missing);
    };
    let old_lines = lines(&old.bytes);
    let start = (a.start_line - 1) as usize;
    let end = a.end_line as usize;
    if end > old_lines.len() {
        return Err(AppError::new("INVALID_ANCHOR"));
    }
    let needle = old_lines[start..end].concat();
    if hash(&needle) != a.content_hash || hash(&old.bytes) != a.context_hash {
        return Err(AppError::new("INVALID_ANCHOR"));
    }
    let Some(new) = target
        .files
        .iter()
        .find(|f| f.path.raw_base64 == a.path.raw_base64 && f.state == FileState::Present)
    else {
        return Ok(AnchorResolution::Missing);
    };
    if original.id == target.id {
        if old.sha256 == new.sha256 && old.bytes == new.bytes {
            return Ok(AnchorResolution::Exact);
        }
        return Err(AppError::new("IMMUTABLE_CONFLICT"));
    }
    let new_lines = lines(&new.bytes);
    let width = end - start;
    let candidates: Vec<_> = new_lines
        .windows(width)
        .enumerate()
        .filter(|(_, chunk)| chunk.concat() == needle)
        .map(|(i, _)| i)
        .collect();
    Ok(match candidates.as_slice() {
        [] => AnchorResolution::Stale,
        [i] => AnchorResolution::Relocated {
            start_line: (i + 1) as u32,
            end_line: (i + width) as u32,
        },
        _ => AnchorResolution::Ambiguous,
    })
}
/// Public boundary when an anchor is received from a client: validate its diff side.
pub fn resolve_comparison(
    store: &agai_storage::Store,
    a: &Anchor,
    target: &Snapshot,
) -> Result<AnchorResolution> {
    let c = store.comparison(a.comparison_id)?;
    let expected = match a.side {
        Side::Old => c.base_snapshot_id,
        Side::New => c.target_snapshot_id,
    };
    if expected != a.snapshot_id {
        return Err(AppError::new("INVALID_ANCHOR"));
    }
    resolve(a, &store.snapshot(expected)?, target)
}
