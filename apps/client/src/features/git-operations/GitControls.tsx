import React, { useState } from "react";
import type { Workspace } from "../../workspace";
export function GitControls({
  workspace: w,
  section = "commit",
}: {
  workspace: Workspace;
  section?: "commit" | "branches" | "remotes";
}) {
  const s = w.state;
  const [message, setMessage] = useState(""),
    [branch, setBranch] = useState(""),
    [remote, setRemote] = useState(""),
    [target, setTarget] = useState("");
  const busy =
    s.gitStarting || s.gitJob?.status === "Running" || s.openingRepository;
  const remoteName = s.gitRemotes.includes(remote)
    ? remote
    : (s.gitRemotes[0] ?? "");
  const targetName = target || s.repo?.branch || "";
  return (
    <div className="git-controls">
      <fieldset hidden={section !== "commit"} disabled={busy || !s.repo}>
        <legend>Commit</legend>
        <p>
          {s.repo?.status_entries.filter(
            (e) =>
              e.status[0] !== "." && e.status[0] !== " " && e.status[0] !== "?",
          ).length ?? 0}{" "}
          files staged. Only the Index will be committed.
        </p>
        <textarea
          aria-label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What changed and why?"
          rows={2}
        />
        <button
          disabled={!message.trim()}
          onClick={() => void w.runGit({ kind: "Commit", message })}
        >
          Create commit
        </button>
      </fieldset>
      <fieldset hidden={section !== "branches"} disabled={busy || !s.repo}>
        <legend>Branches</legend>
        <input
          aria-label="New branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/name"
        />
        <button
          disabled={!branch}
          onClick={() => void w.runGit({ kind: "CreateBranch", name: branch })}
        >
          Create branch
        </button>
        <select
          aria-label="Switch branch"
          value=""
          onChange={(e) =>
            void w.runGit({ kind: "SwitchBranch", name: e.target.value })
          }
        >
          <option value="">Switch to…</option>
          {s.branches
            .filter((b) => !b.remote)
            .map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
        </select>
      </fieldset>
      <fieldset
        hidden={section !== "remotes"}
        disabled={busy || !s.repo || !remoteName}
      >
        <legend>Remote repository</legend>
        <select
          aria-label="Git remote"
          value={remoteName}
          onChange={(e) => setRemote(e.target.value)}
        >
          {s.gitRemotes.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <input
          aria-label="Remote branch"
          value={targetName}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="main"
        />
        <button
          onClick={() => void w.runGit({ kind: "Fetch", remote: remoteName })}
        >
          Fetch
        </button>
        <button
          disabled={!targetName}
          onClick={() =>
            void w.runGit({
              kind: "Pull",
              remote: remoteName,
              branch: targetName,
            })
          }
        >
          Pull · fast-forward only
        </button>
        <button
          disabled={!targetName}
          onClick={() =>
            void w.runGit({
              kind: "Push",
              remote: remoteName,
              branch: targetName,
            })
          }
        >
          Push HEAD → {targetName}
        </button>
      </fieldset>
      {section === "remotes" && s.repo && s.gitRemotes.length === 0 && (
        <p>No remote configured. Add one in your terminal.</p>
      )}
      <p className="hint">
        Git uses your hooks, SSH, credential helper, and signing settings.
        Passwords are not stored by the application.
      </p>
    </div>
  );
}
export function GitJobStatus({ workspace: w }: { workspace: Workspace }) {
  const j = w.state.gitJob;
  if (!j) return null;
  return (
    <div className="git-job" role="status">
      <span>
        {j.root.split("/").at(-1)} ·{" "}
        {(
          {
            Running: "Git running…",
            Succeeded: "Git: done",
            Failed: "Git: failed",
            Cancelled: "Cancelled",
          } as Record<string, string>
        )[j.status] ?? j.status}
      </span>
      {j.status === "Running" && (
        <button onClick={() => void w.cancelGit()}>Cancel Git operation</button>
      )}
      {j.error && <span>{j.error}</span>}
      {j.state_changed && <span>Repository state changed.</span>}
      {j.outcome_uncertain && (
        <strong>
          The operation may have changed Git. Check history and the remote
          before retrying.
        </strong>
      )}
      {j.error === "AUTH_INTERACTION_REQUIRED" && (
        <span>
          Authenticate with your Git credential helper / SSH in the terminal and
          try again.
        </span>
      )}
      {j.status === "Succeeded" && j.root !== w.state.root && (
        <button onClick={() => void w.openRepository(j.root)}>
          Open result
        </button>
      )}
    </div>
  );
}
export function GitPreview({ workspace: w }: { workspace: Workspace }) {
  const p = w.state.gitPreview;
  if (!p) return null;
  return (
    <section className="git-preview" role="dialog" aria-label="Index preview">
      <h3>Index preview · {p.path}</h3>
      <p>
        Your working file stays unchanged. Review the result before applying.
      </p>
      <div className="preview-columns">
        <div>
          <strong>Current Index</strong>
          <pre>{p.before || "(empty)"}</pre>
        </div>
        <div>
          <strong>After applying</strong>
          <pre>{p.after || "(empty)"}</pre>
        </div>
      </div>
      <button
        disabled={
          w.state.gitStarting ||
          w.state.gitJob?.status === "Running" ||
          p.generation !== w.state.repo?.generation
        }
        onClick={() => void w.applyGitPreview()}
      >
        Apply to Index
      </button>
      <button onClick={() => w.dismissGitPreview()}>Close preview</button>
    </section>
  );
}
