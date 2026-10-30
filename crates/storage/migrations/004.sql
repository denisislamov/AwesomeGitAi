BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS bundle_imports(repo_id TEXT NOT NULL,worktree_id TEXT NOT NULL,bundle_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,redacted INTEGER NOT NULL,PRIMARY KEY(repo_id,worktree_id,bundle_id));
CREATE TABLE IF NOT EXISTS redaction_tombstones(id TEXT PRIMARY KEY,repo_id TEXT NOT NULL,worktree_id TEXT NOT NULL);
PRAGMA user_version=4;
COMMIT;
