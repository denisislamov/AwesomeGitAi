#[test]
fn only_implemented_tools_are_advertised() {
    let names = agai_mcp::tool_names();
    assert_eq!(names.len(), 11);
    assert!(names.contains(&"integration_guide"));
    assert!(names.contains(&"trace_record"));
    assert!(names.contains(&"diagram_record"));
}

#[test]
fn schemas_are_self_contained_and_reject_bad_version() {
    for name in agai_mcp::tool_names() {
        let schema = agai_mcp::tool_schema(name).unwrap();
        assert!(!schema.to_string().contains("$ref"));
        assert!(!jsonschema::is_valid(
            &schema,
            &serde_json::json!({"schema_version":2})
        ));
    }
    assert!(agai_mcp::tool_schema("desktop").is_none());
}

#[test]
fn token_files_are_private_and_symlinks_are_rejected() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("token");
    let token = "a".repeat(64);
    agai_mcp::write_secret(&path, token.as_bytes()).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(agai_mcp::read_http_token(&path).unwrap(), token);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(agai_mcp::read_http_token(&path).is_err());
    let link = dir.path().join("link");
    symlink(&path, &link).unwrap();
    assert!(agai_mcp::write_secret(&link, b"never written").is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), token);
}

#[test]
fn missing_host_is_reported_without_credentials_or_repo_paths() {
    let profile = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agai-mcp"))
        .args([
            "--profile",
            profile.path().to_str().unwrap(),
            "--repo",
            repo.path().to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "agai-mcp: HOST_OFFLINE"
    );
}

#[test]
fn token_rejects_short_or_non_hex_material() {
    let dir = tempfile::tempdir().unwrap();
    for (name, token) in [("short", "abcd".to_owned()), ("nonhex", "z".repeat(64))] {
        let path = dir.path().join(name);
        agai_mcp::write_secret(&path, token.as_bytes()).unwrap();
        assert!(agai_mcp::read_http_token(&path).is_err());
    }
}
