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
export function GitLog({ workspace }: { workspace: Workspace }) {
  const s = workspace.state;
  const list = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<Extract<
    DesktopResponse,
    { kind: "CommitDetails" }
  > | null>(null);
  const [err, setErr] = useState("");
  const [base, setBase] = useState<string | null>(null);
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
  useEffect(() => setBase(null), [s.repo?.repo_id, s.repo?.worktree_id]);
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
          title="Обновить refs и коммиты, сохранив открытый код"
        >
          {s.historyStale ? "Обновить историю ●" : "Обновить историю"}
        </button>
        <input
          aria-label="Поиск коммитов"
          placeholder="Сообщение или hash…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>
          {shown.length} загружено{s.cursor ? " · есть ещё" : ""}
        </span>
        <button onClick={() => void workspace.more()} disabled={!s.cursor}>
          Загрузить ещё
        </button>
      </div>
      <div className="git-body">
        <nav className="branches" aria-label="Ветки">
          <button
            aria-pressed={s.branchFilter === "all"}
            onClick={() => workspace.filterBranch("all")}
          >
            Все ветки
          </button>
          {[false, true].map((remote) => (
            <React.Fragment key={String(remote)}>
              <h4>{remote ? "REMOTE" : "LOCAL"}</h4>
              {s.branches
                .filter((b) => b.remote === remote)
                .map((b) => (
                  <button
                    key={b.name}
                    title={b.name}
                    aria-label={`Ветка ${b.name}`}
                    aria-pressed={s.branchFilter === b.name}
                    onClick={() => workspace.filterBranch(b.name)}
                  >
                    ⑂ {b.name}
                    {s.repo?.branch === b.name ? " · HEAD" : ""}
                  </button>
                ))}
            </React.Fragment>
          ))}
        </nav>
        <div
          ref={list}
          className="commit-list"
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        >
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
                aria-label={`Коммит ${r.commit.subject}`}
                aria-pressed={s.selectedCommit === r.commit.oid}
                style={{ top: (start + i) * 38 }}
                onClick={() => workspace.selectCommit(r.commit.oid)}
              >
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
                <span className="commit-subject">
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
                <code>{r.commit.oid.slice(0, 8)}</code>
              </button>
            ))}
          </div>
        </div>
        <aside className="commit-details" aria-label="Сведения о коммите">
          {details ? (
            <>
              <strong>{details.message}</strong>
              <p>
                {details.author}
                <br />
                <small>{details.date}</small>
              </p>
              <code title={details.oid}>{details.oid.slice(0, 12)}</code>
              <p>
                <button onClick={() => setBase(details.oid)}>
                  Взять за базу сравнения
                </button>
              </p>
              {base && (
                <p>
                  База: {base.slice(0, 8)}{" "}
                  <button
                    aria-label="Сбросить базу"
                    onClick={() => setBase(null)}
                  >
                    ×
                  </button>
                </p>
              )}
              <h4>ИЗМЕНЁННЫЕ ФАЙЛЫ</h4>
              {details.paths.map((p) => (
                <button
                  key={p.raw_base64}
                  title={p.display}
                  onClick={() => open(p)}
                >
                  {p.display}
                </button>
              ))}
              {details.paths.length === 0 && (
                <p>Нет файлов для обычного diff; возможен merge-коммит.</p>
              )}
              <small>Выбор коммита не переключает ветку.</small>
            </>
          ) : (
            <p>
              {err ||
                "Выберите коммит для сведений и файлов. Открытый код останется на месте."}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
