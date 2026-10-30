pub fn tool_names() -> Vec<&'static str> {
    vec![
        "integration_guide",
        "context_get",
        "session_open",
        "snapshot_capture",
        "decision_record",
        "event_append",
        "evidence_record",
        "decision_supersede",
        "session_close",
    ]
}

use serde_json::Value;
use std::{
    io::{self, Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};

pub fn tool_schema(name: &str) -> Option<Value> {
    if !tool_names().contains(&name) {
        return None;
    }
    let root: Value = serde_json::from_str(include_str!(
        "../../../contracts/mcp/v1/tool-inputs.schema.json"
    ))
    .expect("embedded schema");
    fn expand(value: &Value, root: &Value) -> Value {
        match value {
            Value::Object(map) => {
                if let Some(reference) = map.get("$ref").and_then(Value::as_str) {
                    return expand(
                        root.pointer(reference.trim_start_matches('#'))
                            .expect("local schema ref"),
                        root,
                    );
                }
                Value::Object(
                    map.iter()
                        .map(|(k, v)| (k.clone(), expand(v, root)))
                        .collect(),
                )
            }
            Value::Array(items) => Value::Array(items.iter().map(|v| expand(v, root)).collect()),
            _ => value.clone(),
        }
    }
    Some(expand(&root["$defs"][name], &root))
}
fn invalid_secret() -> io::Error {
    io::Error::other("INVALID_SECRET_FILE")
}
/// Create only: never overwrite another token or follow symlinks.
pub fn write_secret(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}
pub fn read_http_token(path: &Path) -> io::Result<String> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file()
        || meta.mode() & 0o777 != 0o600
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.len() > 256
    {
        return Err(invalid_secret());
    }
    let mut token = String::new();
    file.take(257).read_to_string(&mut token)?;
    let token = token.trim().to_string();
    // At least 256 bits when encoded as hexadecimal, generated outside the MCP request surface.
    if token.len() < 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid_secret());
    }
    Ok(token)
}
pub mod gateway;
