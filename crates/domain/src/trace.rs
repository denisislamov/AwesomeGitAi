//! Validation only: educational scenarios never execute source, watches, HTML or expressions.
use agai_protocol::*;
use std::collections::HashSet;
fn error() -> AppError {
    AppError::new("INVALID_LEARNING_ARTIFACT")
}
fn text(s: &str, max: usize) -> Result<()> {
    if s.trim().is_empty() || s.len() > max {
        Err(error())
    } else {
        Ok(())
    }
}
fn values(v: &[TraceValue]) -> Result<()> {
    if v.len() > 128 {
        return Err(error());
    }
    let mut names = HashSet::new();
    for v in v {
        text(&v.name, 128)?;
        text(&v.type_name, 128)?;
        if v.value.len() > 4096 || !names.insert(&v.name) {
            return Err(error());
        }
    }
    Ok(())
}
pub fn validate_location(l: &SourceLocation, s: &Snapshot) -> Result<()> {
    l.path.bytes()?;
    let f = s
        .files
        .iter()
        .find(|f| {
            f.path.raw_base64 == l.path.raw_base64
                && f.state == FileState::Present
                && f.encoding == "utf8"
        })
        .ok_or_else(error)?;
    let lines = f.bytes.split_inclusive(|b| *b == b'\n').count();
    if l.line == 0 || l.line as usize > lines {
        return Err(error());
    }
    Ok(())
}
fn header(id: uuid::Uuid, title: &str, assumptions: &[String], s: &Snapshot) -> Result<()> {
    if id != s.id || assumptions.is_empty() || assumptions.len() > 32 {
        return Err(error());
    }
    text(title, 256)?;
    for a in assumptions {
        text(a, 2048)?;
    }
    Ok(())
}
pub fn validate_trace(t: &TraceScenario, s: &Snapshot) -> Result<()> {
    header(t.snapshot_id, &t.title, &t.assumptions, s)?;
    values(&t.inputs)?;
    values(&t.final_values)?;
    if t.steps.is_empty() || t.steps.len() > 1000 || t.entry_step != t.steps[0].id {
        return Err(error());
    }
    let mut ids = HashSet::new();
    let mut retired = HashSet::new();
    for (i, step) in t.steps.iter().enumerate() {
        text(&step.id, 128)?;
        text(&step.explanation, 8192)?;
        if !ids.insert(&step.id) || step.frames.len() > 32 {
            return Err(error());
        }
        let mut frame_ids = HashSet::new();
        for f in &step.frames {
            text(&f.id, 128)?;
            text(&f.label, 256)?;
            values(&f.locals)?;
            validate_location(&f.location, s)?;
            if !frame_ids.insert(&f.id) {
                return Err(error());
            }
        }
        if let Some(l) = &step.location {
            validate_location(l, s)?;
            if step.frames.last().map(|f| &f.location) != Some(l) {
                return Err(error());
            }
        } else if !step.frames.is_empty() && step.phase != TracePhase::Unknown {
            return Err(error());
        }
        if let Some(v) = &step.result {
            values(std::slice::from_ref(v))?;
        }
        let next = t.steps.get(i + 1);
        let depth = step.frames.len();
        if step.next.as_ref() != next.map(|s| &s.id) {
            return Err(error());
        }
        let over = t.steps[i + 1..]
            .iter()
            .find(|n| n.frames.len() <= depth)
            .map(|n| &n.id);
        let out = t.steps[i + 1..]
            .iter()
            .find(|n| n.frames.len() < depth)
            .map(|n| &n.id);
        let into = next.filter(|n| n.frames.len() > depth).map(|n| &n.id);
        if step.over.as_ref() != over || step.out.as_ref() != out || step.into.as_ref() != into {
            return Err(error());
        }
        if let Some(n) = next {
            if depth == 0 || n.frames.len() > depth + 1 {
                return Err(error());
            }
            for (a, b) in step.frames.iter().zip(&n.frames) {
                if a.id != b.id || a.label != b.label {
                    return Err(error());
                }
            }
            for f in step.frames.iter().skip(n.frames.len()) {
                retired.insert(f.id.clone());
            }
            if n.frames.iter().any(|f| retired.contains(&f.id)) {
                return Err(error());
            }
        } else if step.phase != TracePhase::Unknown
            && (step.phase != TracePhase::Return
                || !step.frames.is_empty()
                || step.result.is_none())
        {
            return Err(error());
        }
    }
    if serde_json::to_vec(t).map_err(|_| error())?.len() > 1024 * 1024 {
        return Err(error());
    }
    Ok(())
}
pub fn validate_diagram(d: &Diagram, s: &Snapshot) -> Result<()> {
    header(d.snapshot_id, &d.title, &d.assumptions, s)?;
    if d.nodes.is_empty() || d.nodes.len() > 100 || d.edges.len() > 300 {
        return Err(error());
    }
    let mut ids = HashSet::new();
    for n in &d.nodes {
        text(&n.id, 128)?;
        text(&n.label, 256)?;
        if !ids.insert(&n.id) {
            return Err(error());
        }
        if let Some(l) = &n.location {
            validate_location(l, s)?;
        }
    }
    let mut edges = HashSet::new();
    for e in &d.edges {
        text(&e.id, 128)?;
        text(&e.label, 512)?;
        if !edges.insert(&e.id) || !ids.contains(&e.from) || !ids.contains(&e.to) {
            return Err(error());
        }
    }
    Ok(())
}
