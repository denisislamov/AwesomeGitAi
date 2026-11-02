import { CommitFileTree } from "./CommitFileTree";
import { BranchTree } from "./BranchTree";
import { GitSplitter } from "./GitSplitter";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "../../workspace";
import type {
  Commit,
  DesktopResponse,
  RepoPath,
} from "../../../../../packages/api/src/generated";
export function graphRows(commits: Commit[]) {
  let lanes: string[] = [];
  return commits.map((c) => {
    let lane = lanes.indexOf(c.oid);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(c.oid);
    }
    const before = [...lanes];
    lanes.splice(lane, 1);
    for (const [i, p] of c.parents.entries())
      if (!lanes.includes(p))
        lanes.splice(Math.min(lane + i, lanes.length), 0, p);
    return {
      commit: c,
      lane,
      before,
      after: [...lanes],
      edges: c.parents.map((p) => lanes.indexOf(p)),
    };
  });
}
const columnNames = ["Graph", "Message", "Author", "Date", "Hash"];
const defaultColumns = [80, 360, 140, 110, 90];
const columnMin = [36, 160, 60, 80, 64];
const columnMax = [500, 1600, 600, 300, 240];
function loadDimensions() {
  try {
    const v = JSON.parse(
      localStorage.getItem("agai-git-dimensions-v1") ?? "null",
    );
    if (
      v &&
      Array.isArray(v.columns) &&
      v.columns.length === 5 &&
      v.columns.every(
        (n: number, i: number) =>
          Number.isFinite(n) && n >= columnMin[i] && n <= columnMax[i],
      ) &&
      Number.isFinite(v.filesHeight) &&
      v.filesHeight >= 15 &&
      v.filesHeight <= 85
    )
      return {
        columns: v.columns as number[],
        filesHeight: v.filesHeight as number,
        branchesHeight: Number.isFinite(v.branchesHeight)
          ? Math.max(50, Math.min(300, v.branchesHeight))
          : 90,
      };
  } catch {}
  return { columns: defaultColumns, filesHeight: 60, branchesHeight: 90 };
}
export function GitLog({ workspace }: { workspace: Workspace }) {
  const [dimensions, setDimensions] = useState(loadDimensions);
  const updateDimensions = (next: typeof dimensions) => {
    setDimensions(next);
    try {
      localStorage.setItem("agai-git-dimensions-v1", JSON.stringify(next));
    } catch {}
  };
  const bodyRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!bodyRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setCompact(entry.contentRect.width <= 650),
    );
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, []);
  const s = workspace.state;
  const list = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem("agai-git-panes-v1") ?? "null");
      if (
        Array.isArray(v) &&
        v.length === 2 &&
        v.every((n) => Number.isFinite(n) && n >= 130 && n <= 700)
      )
        return v as number[];
    } catch {}
    return [235, 290];
  });
  const resize = (index: number, value: number) =>
    setWidths((old) => {
      const next = old.map((n, i) => (i === index ? value : n));
      try {
        localStorage.setItem("agai-git-panes-v1", JSON.stringify(next));
      } catch {}
      return next;
    });
  const [scroll, setScroll] = useState(0);
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<Extract<
    DesktopResponse,
    { kind: "CommitDetails" }
  > | null>(null);
  const [err, setErr] = useState("");
  const base = s.selectedCommitBase;
  const commits = workspace.visibleCommits();
  const rows = useMemo(() => graphRows(commits), [s.commits, s.branchFilter]);
  const shown = rows.filter((r) =>
    `${r.commit.subject} ${r.commit.oid}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const start = Math.max(0, Math.floor(scroll / 38) - 6);
  const visible = shown.slice(start, start + 40);
  useEffect(() => {
    setScroll(0);
    if (list.current) list.current.scrollTop = 0;
  }, [search, s.branchFilter]);
  useEffect(() => {
    let active = true;
    setDetails(null);
    setErr("");
    if (s.selectedCommit)
      workspace.api
        .desktop({
          kind: "CommitDetails",
          scope: workspace.scope(),
          oid: s.selectedCommit,
          base,
        })
        .then((r) => {
          if (active && r.kind === "CommitDetails") setDetails(r);
        })
        .catch((e) => active && setErr(e.code ?? String(e)));
    return () => {
      active = false;
    };
  }, [s.selectedCommit, s.repo?.repo_id, s.repo?.worktree_id, base]);
  const open = (path: RepoPath) => {
    if (details)
      void workspace.openFile(
        path,
        details.base_oid ? { Commit: { oid: details.base_oid } } : "Empty",
        { Commit: { oid: details.oid } },
      );
  };
  return (
    <section className="git-log" role="region" aria-label="Git Log">
      <div className="git-heading" data-loading={String(s.historyBusy)}>
        <strong>⑂ Git Log</strong>
        <button
          disabled={s.historyBusy || !s.repo}
          onClick={() => void workspace.refreshHistory()}
          title="Refresh refs and commits while preserving the open code"
        >
          {s.historyStale ? "Refresh history ●" : "Refresh history"}
        </button>
        <input
          aria-label="Search commits"
          placeholder="Message or hash…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>
          {shown.length} loaded{s.cursor ? " · more available" : ""}
        </span>
        <button onClick={() => void workspace.more()} disabled={!s.cursor}>
          Load more
        </button>
      </div>
      <div
        className="git-body"
        ref={bodyRef}
        style={
          {
            "--git-branches": `${widths[0]}px`,
            "--git-details": `${widths[1]}px`,
            "--git-branches-height": `${dimensions.branchesHeight}px`,
          } as React.CSSProperties
        }
      >
        <nav className="branches" aria-label="Branches">
          <div className="git-current">
            {s.repo?.branch ? (
              <button
                title={s.repo.branch}
                aria-label={`Current branch ${s.repo.branch}`}
                onClick={() => workspace.filterBranch(s.repo!.branch!)}
              >
                Current: {s.repo.branch}
              </button>
            ) : (
              <span>Detached HEAD {s.repo?.head_oid?.slice(0, 8) ?? ""}</span>
            )}
          </div>
          <button
            aria-pressed={s.branchFilter === "all"}
            onClick={() => workspace.filterBranch("all")}
          >
            All branches
          </button>
          <BranchTree
            branches={s.branches}
            current={s.repo?.branch ?? null}
            selected={s.branchFilter}
            onSelect={(name) => workspace.filterBranch(name)}
          />
        </nav>
        <GitSplitter
          label={compact ? "Branches height" : "Branches width"}
          axis={compact ? "y" : "x"}
          min={compact ? 50 : 130}
          max={compact ? 300 : 700}
          value={compact ? dimensions.branchesHeight : widths[0]}
          onChange={(v) =>
            compact
              ? updateDimensions({ ...dimensions, branchesHeight: v })
              : resize(0, v)
          }
        />
        <div
          ref={list}
          className="commit-list"
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        >
          <div
            className="commit-table"
            style={
              {
                width: dimensions.columns.reduce((a, b) => a + b, 0) + 8,
                minWidth: "100%",
                "--commit-columns": dimensions.columns
                  .map((n, i) => (i === 1 ? `minmax(${n}px, 1fr)` : `${n}px`))
                  .join(" "),
              } as React.CSSProperties
            }
          >
            <div className="commit-columns" aria-label="Commit columns">
              {columnNames.map((name, i) => (
                <div key={name} className="commit-column">
                  <span>{name}</span>
                  <GitSplitter
                    label={`${name} column width`}
                    value={dimensions.columns[i]}
                    min={columnMin[i]}
                    max={columnMax[i]}
                    onChange={(v) =>
                      updateDimensions({
                        ...dimensions,
                        columns: dimensions.columns.map((n, j) =>
                          i === j ? v : n,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div
              style={{
                height: shown.length * 38,
                position: "relative",
                minHeight: "100%",
              }}
            >
              {visible.map((r, i) => (
                <button
                  key={r.commit.oid}
                  className={
                    "commit-row " +
                    (s.selectedCommit === r.commit.oid ? "selected" : "")
                  }
                  aria-label={`Commit ${r.commit.subject}`}
                  aria-pressed={s.selectedCommit === r.commit.oid}
                  style={{ top: (start + i) * 38 }}
                  onClick={() => workspace.selectCommit(r.commit.oid, base)}
                >
                  <span className="commit-graph">
                    <svg
                      width={Math.max(
                        60,
                        Math.max(r.before.length, r.after.length) * 18 + 18,
                      )}
                      height="38"
                      aria-hidden="true"
                    >
                      {r.before.map((oid, j) =>
                        oid === r.commit.oid ? (
                          <path
                            key={oid}
                            d={`M ${12 + j * 18} 0 V19`}
                            stroke={`var(--lane${j % 3})`}
                            fill="none"
                          />
                        ) : r.after.indexOf(oid) >= 0 ? (
                          <path
                            key={oid}
                            d={`M ${12 + j * 18} 0 L ${12 + r.after.indexOf(oid) * 18} 38`}
                            stroke={`var(--lane${j % 3})`}
                            fill="none"
                          />
                        ) : null,
                      )}
                      {r.edges.map((j, k) => (
                        <path
                          key={k}
                          d={`M ${12 + r.lane * 18} 19 L ${12 + j * 18} 38`}
                          stroke={`var(--lane${r.lane % 3})`}
                          fill="none"
                        />
                      ))}
                      <circle
                        cx={12 + r.lane * 18}
                        cy="19"
                        r="4"
                        fill={`var(--lane${r.lane % 3})`}
                      />
                    </svg>
                  </span>
                  <span className="commit-subject" title={r.commit.subject}>
                    {s.branches
                      .filter((b) => b.oid === r.commit.oid)
                      .map((b) => (
                        <em key={b.name}>{b.name}</em>
                      ))}
                    {r.commit.subject}
                  </span>
                  <span className="commit-author" title={r.commit.author}>
                    {r.commit.author}
                  </span>
                  <time className="commit-date" title={r.commit.date}>
                    {r.commit.date.slice(0, 10)}
                  </time>
                  <code title={r.commit.oid}>{r.commit.oid.slice(0, 8)}</code>
                </button>
              ))}
            </div>
          </div>
        </div>
        <GitSplitter
          label="Commit details width"
          value={widths[1]}
          onChange={(v) => resize(1, v)}
          invert
        />
        <aside
          className={`commit-details ${details ? "has-commit" : ""}`}
          aria-label="Commit details"
          style={
            details
              ? {
                  gridTemplateRows: `minmax(0, ${dimensions.filesHeight}fr) 1px minmax(0, ${100 - dimensions.filesHeight}fr)`,
                }
              : undefined
          }
        >
          {details ? (
            <>
              <section className="commit-files" aria-label="Changed files">
                <h4>
                  Changed files <span>{details.paths.length}</span>
                </h4>
                <CommitFileTree paths={details.paths} onOpen={open} />
                {details.paths.length === 0 && (
                  <p>No ordinary diff files; this may be a merge commit.</p>
                )}
              </section>
              <GitSplitter
                label="Changed files height"
                axis="y"
                relative
                value={dimensions.filesHeight}
                min={15}
                max={85}
                step={5}
                onChange={(v) =>
                  updateDimensions({ ...dimensions, filesHeight: v })
                }
              />
              <section
                className="commit-description"
                aria-label="Commit message"
              >
                <h3>{details.message.split("\n")[0]}</h3>
                <div className="commit-metadata">
                  <span>{details.author}</span>
                  <time>{details.date.slice(0, 10)}</time>
                  <code title={details.oid}>{details.oid.slice(0, 8)}</code>
                </div>
                {details.message.includes("\n") &&
                  details.message
                    .slice(details.message.indexOf("\n"))
                    .trim() && (
                    <div className="commit-body">
                      <p>
                        {details.message
                          .slice(details.message.indexOf("\n"))
                          .trim()}
                      </p>
                    </div>
                  )}
                <button
                  className="commit-base-action"
                  onClick={() => {
                    workspace.selectCommit(details.oid, details.oid);
                  }}
                >
                  Use as comparison base
                </button>
                {base && (
                  <p>
                    Base: {base.slice(0, 8)}{" "}
                    <button
                      aria-label="Clear base"
                      onClick={() => {
                        if (s.selectedCommit)
                          workspace.selectCommit(s.selectedCommit);
                      }}
                    >
                      ×
                    </button>
                  </p>
                )}
              </section>
            </>
          ) : (
            <p>
              {err ||
                "Select a commit to see details and files. Your open code stays in place."}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
