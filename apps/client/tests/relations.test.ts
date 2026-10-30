import { expect, it } from "vitest";
import { Workspace, type WorkspaceApi } from "../src/workspace";
const path = {
  display: "a.ts",
  raw_base64: "YS50cw==",
  encoding: "unix_bytes",
};
const related = {
  display: "b.ts",
  raw_base64: "Yi50cw==",
  encoding: "unix_bytes",
};
const repo = {
  repo_id: "repo",
  worktree_id: "wt",
  generation: "g",
  status_entries: [],
  capabilities: [],
};
const report = {
  origin_snapshot_id: "source",
  snapshot_id: "analysis",
  status: "Partial",
  adapter: "ts",
  message: "Captured files only",
  files: [path, related],
  symbols: [
    {
      id: "f",
      name: "f",
      kind: "function",
      path,
      line: 1,
      column: 1,
      references: [
        { path: related, line: 2, column: 3, kind: "Call", snippet: "f()" },
      ],
    },
  ],
};
function comparison(p = path, id = "source") {
  const snapshot = {
    id,
    ...repo,
    files: [],
    exclusions: [],
    captured_at: "0",
    layer: "Worktree",
  };
  return {
    kind: "FileComparison",
    comparison: {
      id: "cmp" + id,
      base_snapshot_id: id,
      target_snapshot_id: id,
      file_pairs: [],
      diff_algorithm_version: "1",
    },
    base: snapshot,
    target: snapshot,
    observed_generation: "g",
  };
}
function fixture(
  answer: (r: any) => Promise<any> = async () => ({
    kind: "CodeRelations",
    report,
  }),
) {
  const api: WorkspaceApi = {
    read: async () => ({
      kind: "History",
      page: { commits: [], cursor: null },
    }),
    desktop: async (r: any) => {
      if (r.kind === "CompareFile")
        return comparison(
          r.path,
          typeof r.target === "object" && "Snapshot" in r.target
            ? r.target.Snapshot.id
            : "source",
        ) as any;
      if (r.kind === "CodeRelations") return answer(r);
      if (r.kind === "OpenRepository")
        return {
          kind: "Repository",
          state: { ...repo, repo_id: "other" },
          root: "other",
          branches: [],
        } as any;
      if (r.kind === "ListFiles") return { kind: "Files", paths: [] };
      if (r.kind === "GetDecisions")
        return { kind: "Decisions", decisions: [], truncated: false };
      if (r.kind === "LearningList") return { kind: "LearningList", items: [] };
      if (r.kind === "GitRemotes") return { kind: "GitRemotes", names: [] };
      throw Error(r.kind);
    },
  };
  const w = new Workspace(api);
  w.state.repo = repo as any;
  return w;
}
it("ignores relations arriving after changing active snapshot", async () => {
  let release!: (r: any) => void;
  const w = fixture(() => new Promise((r) => (release = r)));
  await w.openFile(path);
  const pending = w.loadRelations();
  await w.openFile(
    path,
    { Snapshot: { id: "new" } },
    { Snapshot: { id: "new" } },
  );
  release({ kind: "CodeRelations", report });
  await pending;
  expect(w.state.relations?.report).toBeNull();
});
it("rejects mismatched origin snapshots", async () => {
  const w = fixture(async () => ({
    kind: "CodeRelations",
    report: { ...report, origin_snapshot_id: "wrong" },
  }));
  await w.openFile(path);
  await w.loadRelations();
  expect(w.state.relations?.report).toBeNull();
  expect(w.state.relations?.error).toBeTruthy();
});
it("drops relation results across repository switches", async () => {
  let release!: (r: any) => void;
  const w = fixture(() => new Promise((r) => (release = r)));
  await w.openFile(path);
  const pending = w.loadRelations();
  await w.openRepository("other");
  release({ kind: "CodeRelations", report });
  await pending;
  expect(w.state.relations).toBeNull();
});
it("navigates references and related files on analysis snapshot and Back restores tab, selection and scroll", async () => {
  const w = fixture();
  await w.openFile(path);
  const origin = w.active()!;
  w.setScroll(origin.id, 420);
  w.explain("New", 1, 2);
  const selection = w.state.selection;
  await w.loadRelations();
  await w.openRelationLocation(related, 2, 3);
  expect(w.active()?.data.target.id).toBe("analysis");
  expect(w.state.relationLocation?.line).toBe(2);
  expect(w.active()?.path).toEqual(related);
  w.backFromRelations();
  expect(w.active()).toEqual(origin);
  expect(w.active()?.scroll).toBe(420);
  expect(w.state.selection).toEqual(selection);
  expect(w.state.relationLocation).toBeNull();
  await w.openRelationLocation(related, 1);
  expect(w.active()?.data.target.id).toBe("analysis");
});
it("Back cancels a pending reference comparison", async () => {
  const w = fixture();
  await w.openFile(path);
  await w.loadRelations();
  const original = w.active();
  let release!: (r: any) => void;
  const desktop = w.api.desktop;
  w.api.desktop = async (r) =>
    r.kind === "CompareFile"
      ? new Promise((resolve) => (release = resolve))
      : desktop(r);
  const pending = w.openRelationLocation(related, 2, 3);
  w.backFromRelations();
  release(comparison(related, "analysis"));
  await pending;
  expect(w.active()).toEqual(original);
  expect(w.state.relationLocation).toBeNull();
});
it("restores original relations after analysing a reference file", async () => {
  const w = fixture();
  await w.openFile(path);
  await w.loadRelations();
  await w.openRelationLocation(related, 2, 3);
  w.api.desktop = async (r) =>
    r.kind === "CodeRelations"
      ? ({
          kind: "CodeRelations",
          report: {
            ...report,
            origin_snapshot_id: "analysis",
            snapshot_id: "second",
            symbols: [],
          },
        } as any)
      : { kind: "Decisions", decisions: [], truncated: false };
  await w.loadRelations();
  expect(w.state.relations?.report?.snapshot_id).toBe("second");
  w.backFromRelations();
  expect(w.state.relations?.report?.snapshot_id).toBe("analysis");
});
it("closes a report when switching to another revision", async () => {
  const w = fixture();
  await w.openFile(path);
  await w.loadRelations(true);
  await w.openFile(
    path,
    { Snapshot: { id: "new" } },
    { Snapshot: { id: "new" } },
  );
  expect(w.state.relations?.open).toBe(false);
});
it("accepts scoped detached relation actions and rejects stale comparison commands", async () => {
  const { dispatchPanelAction, panelSnapshot } =
    await import("../src/features/layout/sync");
  const w = fixture();
  await w.openFile(path);
  const scope = panelSnapshot(w, {}).scope,
    comparisonId = w.active()!.data.comparison.id;
  await dispatchPanelAction(w, {
    panel: "code",
    action: "relations_load",
    payload: { scope, comparisonId: "old", open: true },
  });
  expect(w.state.relations).toBeNull();
  await dispatchPanelAction(w, {
    panel: "code",
    action: "relations_load",
    payload: { scope, comparisonId, open: true },
  });
  expect(w.state.relations?.open).toBe(true);
  const key = w.state.relations!.key;
  await dispatchPanelAction(w, {
    panel: "code",
    action: "relation_location",
    payload: { scope, key, path: related, line: 2, column: 3 },
  });
  expect(w.active()?.data.target.id).toBe("analysis");
  await dispatchPanelAction(w, {
    panel: "code",
    action: "relations_back",
    payload: { scope, tabId: w.state.relationBack?.tab.id },
  });
  expect(w.active()?.data.target.id).toBe("source");
});
