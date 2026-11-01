import React, { useEffect, useRef, useState } from "react";
import {
  revisionLabel,
  isRecordedReview,
  type Workspace,
} from "../../workspace";
import type {
  RepoPath,
  Revision,
} from "../../../../../packages/api/src/generated";

type Mode = "comparison" | "working" | "all";
export function FileNavigator({
  workspace: w,
  stagingMode,
}: {
  workspace: Workspace;
  stagingMode: string;
}) {
  const s = w.state,
    tab = w.active();
  const selected = s.filesCommit;
  const historical =
    !!selected ||
    (!!tab &&
      [tab.base, tab.target].every(
        (r) => typeof r === "object" || r === "Empty",
      ));
  const key = JSON.stringify([
    s.repo?.repo_id,
    s.repo?.worktree_id,
    selected
      ? ["commit", selected.oid, selected.base]
      : historical
        ? [tab?.base, tab?.target]
        : "working",
  ]);
  const [choice, setChoice] = useState<{
    key: string;
    mode: Mode;
    destinationKey?: string;
  } | null>(null);
  const mode =
    choice && (choice.key === key || choice.destinationKey === key)
      ? choice.mode
      : historical
        ? "comparison"
        : "working";
  const [filter, setFilter] = useState("");
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const openingSerial = useRef(0);
  const [result, setResult] = useState<{
    key: string;
    paths: RepoPath[];
    base?: Revision;
    error?: string;
  } | null>(null);
  const commit =
    !!selected ||
    (tab &&
      typeof tab.target === "object" &&
      "Commit" in tab.target &&
      (tab.base === "Empty" ||
        (typeof tab.base === "object" && "Commit" in tab.base)));
  useEffect(() => {
    let current = true;
    if (!commit || !s.repo || mode !== "comparison") return;
    const oid =
      selected?.oid ?? (tab!.target as { Commit: { oid: string } }).Commit.oid;
    const base = selected
      ? selected.base
      : tab!.base === "Empty"
        ? null
        : (tab!.base as { Commit: { oid: string } }).Commit.oid;
    setResult(null);
    w.api
      .desktop({
        kind: "CommitDetails",
        scope: w.scope(),
        oid,
        base,
      })
      .then((r) => {
        if (current && r.kind === "CommitDetails")
          setResult({
            key,
            paths: r.paths,
            base: r.base_oid ? { Commit: { oid: r.base_oid } } : "Empty",
          });
      })
      .catch((e) => {
        if (current) setResult({ key, paths: [], error: e.code ?? String(e) });
      });
    return () => {
      current = false;
    };
  }, [key, commit, mode, w]);
  const changed = new Map(
    s.repo?.status_entries.flatMap(
      (e) =>
        [
          [e.path.raw_base64, e.status],
          ...(e.original_path ? [[e.original_path.raw_base64, "D"]] : []),
        ] as [string, string][],
    ) ?? [],
  );
  const comparison = selected
    ? {
        base:
          result?.key === key && result.base
            ? result.base
            : selected.base
              ? ({ Commit: { oid: selected.base } } as Revision)
              : ("Empty" as Revision),
        target: { Commit: { oid: selected.oid } } as Revision,
      }
    : tab;
  let paths = s.paths;
  let recorded = !selected && !!tab && isRecordedReview(tab);
  const status = new Map<string, string>();
  if (mode === "comparison" && comparison) {
    if (commit) paths = result?.key === key ? result.paths : [];
    else if (tab) {
      const old = new Map(
        tab.data.base.files.map((f) => [f.path.raw_base64, f]),
      );
      const next = new Map(
        tab.data.target.files.map((f) => [f.path.raw_base64, f]),
      );
      const all = new Map([...old, ...next]);
      const differences = [...all].filter(([id]) => {
        const a = old.get(id),
          b = next.get(id);
        return a?.state !== b?.state || a?.sha256 !== b?.sha256;
      });
      recorded = recorded && differences.length === 0;
      paths = (
        recorded
          ? [...all].filter(([, f]) => f.state !== "Absent")
          : differences
      ).map(([id, f]) => {
        status.set(
          id,
          old.get(id)?.state === "Absent"
            ? "A"
            : next.get(id)?.state === "Absent"
              ? "D"
              : recorded
                ? ""
                : "M",
        );
        return f.path;
      });
    }
  } else if (mode === "working")
    paths = paths.filter((p) => changed.has(p.raw_base64));
  if (mode !== "comparison")
    for (const [id, value] of changed) status.set(id, value.trim());
  paths = paths.filter((p) =>
    p.display.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = new Map<string, RepoPath[]>();
  for (const p of paths) {
    const dir = p.display.includes("/")
      ? p.display.slice(0, p.display.lastIndexOf("/"))
      : ".";
    groups.set(dir, [...(groups.get(dir) ?? []), p]);
  }
  const loading = mode === "comparison" && commit && result?.key !== key;
  const error =
    mode === "comparison" && result?.key === key ? result.error : null;
  const open = (p: RepoPath) => {
    if (mode === "all")
      setChoice({
        key,
        destinationKey: JSON.stringify([
          s.repo?.repo_id,
          s.repo?.worktree_id,
          "working",
        ]),
        mode: "all",
      });
    const pair: [Revision, Revision] =
      mode === "comparison" && comparison
        ? [comparison.base, comparison.target]
        : stagingMode === "index"
          ? ["Head", "Index"]
          : ["Index", "Worktree"];
    const serial = ++openingSerial.current;
    setOpeningPath(p.display);
    void w.openFile(p, ...pair).finally(() => {
      if (serial === openingSerial.current) setOpeningPath(null);
    });
  };
  return (
    <aside className="file-tree" aria-label="Repository files">
      <select
        aria-label="File list scope"
        disabled={!s.repo || s.openingRepository}
        value={mode}
        onChange={(e) => setChoice({ key, mode: e.target.value as Mode })}
      >
        <option value="comparison" disabled={!comparison}>
          {recorded
            ? "Recorded files"
            : commit
              ? "Commit changes"
              : "Comparison files"}
        </option>
        <option value="working">Working changes</option>
        <option value="all">All files</option>
      </select>
      {mode === "comparison" && comparison && (
        <small
          className="file-scope-note"
          title={`${revisionLabel(comparison.base)} → ${revisionLabel(comparison.target)}`}
        >
          {recorded
            ? "Saved explanation · identical versions, no + / −"
            : commit
              ? `${revisionLabel(comparison.base)} → ${revisionLabel(comparison.target)} · changed files`
              : "Files in open comparison"}
        </small>
      )}
      <input
        aria-label="Search files"
        placeholder="Find a file…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {openingPath && (
        <p role="status" className="empty-small">
          Opening {openingPath.split("/").at(-1)}…
        </p>
      )}
      <div className="file-list">
        {[...groups].map(([dir, files]) => (
          <details key={dir} open>
            <summary title={dir}>{dir === "." ? "Project" : dir}</summary>
            {files.map((p) => (
              <button
                key={p.raw_base64}
                aria-label={`File ${p.display}`}
                aria-current={
                  tab?.path.raw_base64 === p.raw_base64 ? "page" : undefined
                }
                title={p.display}
                onClick={() => open(p)}
              >
                <span className="file-icon">
                  {p.display.endsWith(".cs")
                    ? "C#"
                    : p.display.endsWith(".ts")
                      ? "TS"
                      : "◇"}
                </span>
                <span>{p.display.split("/").at(-1)}</span>
                <small>{status.get(p.raw_base64) ?? ""}</small>
              </button>
            ))}
          </details>
        ))}
        {loading && <p className="empty-small">Loading comparison files…</p>}
        {error && (
          <p role="alert" className="empty-small">
            Could not load comparison files: {error}
          </p>
        )}
        {s.repo && !loading && !error && paths.length === 0 && (
          <p className="empty-small">
            {filter
              ? "No matching files."
              : mode === "working"
                ? "No uncommitted changes."
                : mode === "comparison"
                  ? "No changed files in this comparison."
                  : "No files found."}
          </p>
        )}
      </div>
    </aside>
  );
}
