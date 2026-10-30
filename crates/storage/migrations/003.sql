BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL,id TEXT NOT NULL,repo_id TEXT NOT NULL,worktree_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS documents_scope ON documents(kind,repo_id,worktree_id);
CREATE TABLE IF NOT EXISTS operation_receipts(scope TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(scope,key));
CREATE VIRTUAL TABLE IF NOT EXISTS decision_search USING fts5(id UNINDEXED,repo_id UNINDEXED,worktree_id UNINDEXED,summary,rationale);
CREATE TRIGGER IF NOT EXISTS decision_search_insert AFTER INSERT ON documents WHEN new.kind='decision' BEGIN
 INSERT INTO decision_search VALUES(new.id,new.repo_id,new.worktree_id,json_extract(new.data,'$.summary'),json_extract(new.data,'$.rationale'));
END;
CREATE TRIGGER IF NOT EXISTS decision_search_update AFTER UPDATE ON documents WHEN new.kind='decision' BEGIN
 DELETE FROM decision_search WHERE id=old.id;
 INSERT INTO decision_search VALUES(new.id,new.repo_id,new.worktree_id,json_extract(new.data,'$.summary'),json_extract(new.data,'$.rationale'));
END;
INSERT INTO decision_search SELECT id,repo_id,worktree_id,json_extract(data,'$.summary'),json_extract(data,'$.rationale') FROM documents d WHERE kind='decision' AND NOT EXISTS(SELECT 1 FROM decision_search s WHERE s.id=d.id);
PRAGMA user_version=3;
COMMIT;
