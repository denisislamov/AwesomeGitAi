import { it, expect, vi } from "vitest";
import { Workspace } from "../src/workspace";
import {
  DetachedWorkspace,
  dispatchPanelAction,
  panelSnapshot,
} from "../src/features/layout/sync";
const transport = vi.hoisted(() => ({
  sendPanelAction: vi.fn().mockResolvedValue(undefined),
  closePanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/features/layout/native", () => transport);
function fixture() {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.repo = {
    repo_id: "repo",
    worktree_id: "wt",
    generation: "g",
    branch: "main",
    head_oid: "a",
    status_entries: [],
    capabilities: [],
  };
  return w;
}
it("rejects an action from a stale repository generation", async () => {
  const w = fixture();
  const select = vi.spyOn(w, "selectCommit");
  await dispatchPanelAction(w, {
    panel: "git",
    action: "select_commit",
    payload: { scope: "old", oid: "a" },
  });
  expect(select).not.toHaveBeenCalled();
});
it("accepts only loaded tab identifiers", async () => {
  const w = fixture();
  const activate = vi.spyOn(w, "activate");
  await dispatchPanelAction(w, {
    panel: "code",
    action: "select_tab",
    payload: { scope: panelSnapshot(w, {}).scope, id: "missing" },
  });
  expect(activate).not.toHaveBeenCalled();
});
it("rejects invalid selections without changing state", async () => {
  const w = fixture();
  const explain = vi.spyOn(w, "explain");
  await dispatchPanelAction(w, {
    panel: "code",
    action: "set_selection",
    payload: {
      scope: panelSnapshot(w, {}).scope,
      startLine: -1,
      endLine: NaN,
      side: "New",
    },
  });
  expect(explain).not.toHaveBeenCalled();
});
it("reviews only the exact active snapshot pair and visible decision", async () => {
  const w = fixture();
  w.state.tabs = [
    {
      id: "tab",
      data: {
        comparison: { id: "comparison" },
        base: { id: "base" },
        target: { id: "target" },
      },
    } as never,
  ];
  w.state.activeTab = "tab";
  w.state.explanations = [{ id: "decision" } as never];
  const review = vi.spyOn(w, "reviewDecision").mockResolvedValue();
  const payload = {
    scope: panelSnapshot(w, {}).scope,
    id: "decision",
    comparisonId: "comparison",
    baseSnapshotId: "base",
    targetSnapshotId: "target",
    state: "Viewed",
    note: "",
  };
  await dispatchPanelAction(w, {
    panel: "explanation",
    action: "review_decision",
    payload: { ...payload, targetSnapshotId: "old" },
  });
  expect(review).not.toHaveBeenCalled();
  await dispatchPanelAction(w, {
    panel: "explanation",
    action: "review_decision",
    payload,
  });
  expect(review).toHaveBeenCalledWith("decision", "Viewed", "");
});
it("includes bytes only for the active tab in shared snapshots", () => {
  const w = fixture();
  w.state.tabs = [
    { id: "a", data: { bytes: [1, 2, 3] } },
    { id: "b", data: { bytes: [4, 5, 6] } },
  ] as never;
  w.state.activeTab = "a";
  const shared = panelSnapshot(w, {});
  expect(shared.workspace.tabs[0].data).toEqual({ bytes: [1, 2, 3] });
  expect(shared.workspace.tabs[1].data).toBeUndefined();
});
it("accepts only loaded branch names", async () => {
  const w = fixture();
  w.state.branches = [{ name: "feature", oid: "a" } as never];
  const filter = vi.spyOn(w, "filterBranch");
  await dispatchPanelAction(w, {
    panel: "git",
    action: "select_branch",
    payload: { scope: panelSnapshot(w, {}).scope, name: "feature" },
  });
  expect(filter).toHaveBeenCalledWith("feature");
  await dispatchPanelAction(w, {
    panel: "git",
    action: "select_branch",
    payload: { scope: panelSnapshot(w, {}).scope, name: "unknown" },
  });
  expect(filter).toHaveBeenCalledTimes(1);
});

it("detached actions queue intents without changing authoritative state", async () => {
  const main = fixture();
  main.state.tabs = [{ id: "active", data: {} } as never];
  main.state.activeTab = "active";
  const detached = new DetachedWorkspace({ read: vi.fn(), desktop: vi.fn() });
  detached.hydrate(panelSnapshot(main, {}));
  detached.activate("other");
  expect(detached.state.activeTab).toBe("active");
  expect(transport.sendPanelAction).toHaveBeenCalledWith("select_tab", {
    id: "other",
    scope: panelSnapshot(main, {}).scope,
  });
});

it("keeps immutable editor data and detached scroll across equivalent JSON hydrations", () => {
  const main = fixture();
  main.state.tabs = [
    {
      id: "active",
      scroll: 0,
      stale: false,
      data: {
        comparison: { id: "comparison" },
        base: { id: "base" },
        target: { id: "target" },
      },
    } as never,
  ];
  main.state.activeTab = "active";
  const remote = new DetachedWorkspace({ read: vi.fn(), desktop: vi.fn() });
  const wire = () => JSON.parse(JSON.stringify(panelSnapshot(main, {})));
  remote.hydrate(wire());
  const data = remote.active()!.data;
  remote.setScroll("active", 725);
  for (let i = 0; i < 3; i++) {
    remote.hydrate(wire());
    expect(remote.active()!.data).toBe(data);
    expect(remote.active()!.scroll).toBe(725);
  }
  main.state.repo!.generation = "new-generation";
  main.state.tabs[0].stale = true;
  remote.hydrate(wire());
  expect(remote.active()!.data).toBe(data);
  expect(remote.active()!.stale).toBe(true);
  expect(remote.active()!.scroll).toBe(725);
});
it("takes new immutable comparisons and resets local view state on repository change", () => {
  const main = fixture();
  main.state.tabs = [
    {
      id: "active",
      scroll: 0,
      data: {
        comparison: { id: "comparison" },
        base: { id: "base" },
        target: { id: "target" },
      },
    } as never,
  ];
  main.state.activeTab = "active";
  const remote = new DetachedWorkspace({ read: vi.fn(), desktop: vi.fn() });
  const wire = () => JSON.parse(JSON.stringify(panelSnapshot(main, {})));
  remote.hydrate(wire());
  const old = remote.active()!.data;
  remote.setScroll("active", 400);
  main.state.tabs[0].data.comparison.id = "new-comparison";
  remote.hydrate(wire());
  expect(remote.active()!.data).not.toBe(old);
  expect(remote.active()!.data.comparison.id).toBe("new-comparison");
  expect(remote.active()!.scroll).toBe(400);
  const prior = remote.active()!.data;
  main.state.repo!.repo_id = "other-repo";
  remote.hydrate(wire());
  expect(remote.active()!.data).not.toBe(prior);
  expect(remote.active()!.scroll).toBe(0);
});
it("validates selection bounds against the selected file in a multi-file snapshot", async () => {
  const main = fixture();
  main.state.tabs = [
    {
      id: "active",
      path: { raw_base64: "selected" },
      data: {
        comparison: { id: "comparison" },
        target: {
          files: [
            { path: { raw_base64: "other" }, bytes: [97] },
            { path: { raw_base64: "selected" }, bytes: [97, 10, 98, 10, 99] },
          ],
        },
        base: { files: [] },
      },
    } as never,
  ];
  main.state.activeTab = "active";
  const explain = vi.spyOn(main, "explain").mockImplementation(() => {});
  const payload = {
    scope: panelSnapshot(main, {}).scope,
    comparisonId: "comparison",
    side: "New",
    startLine: 1,
    endLine: 3,
  };
  await dispatchPanelAction(main, {
    panel: "code",
    action: "set_selection",
    payload,
  });
  expect(explain).toHaveBeenCalledWith("New", 1, 3);
  main.state.tabs[0].data.target.files.splice(1);
  await dispatchPanelAction(main, {
    panel: "code",
    action: "set_selection",
    payload: { ...payload, endLine: 1 },
  });
  expect(explain).toHaveBeenCalledTimes(1);
});

it("opens a recorded-only file from detached Files only within the active pair", async () => {
  const w = fixture();
  const path = {
    display: "Removed.cs",
    raw_base64: btoa("Removed.cs"),
    encoding: "unix_bytes",
  };
  const base = { Snapshot: { id: "11111111-1111-1111-1111-111111111111" } },
    target = { Snapshot: { id: "22222222-2222-2222-2222-222222222222" } };
  w.state.tabs = [
    {
      id: "t",
      path: { ...path, raw_base64: "other" },
      base,
      target,
      data: { base: { files: [{ path }] }, target: { files: [{ path }] } },
    } as any,
  ];
  w.state.activeTab = "t";
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  const payload = {
    scope: panelSnapshot(w, {}).scope,
    path: path.raw_base64,
    base,
    target,
  };
  await dispatchPanelAction(w, {
    panel: "files",
    action: "open_revision",
    payload,
  });
  expect(open).toHaveBeenCalledWith(path, base, target, false);
  open.mockClear();
  await dispatchPanelAction(w, {
    panel: "files",
    action: "open_revision",
    payload: {
      ...payload,
      target: { Snapshot: { id: "33333333-3333-3333-3333-333333333333" } },
    },
  });
  expect(open).not.toHaveBeenCalled();
});

it("ignores detached historical file lookup after switching the active tab", async () => {
  const w = fixture();
  const path = {
    display: "Deleted.cs",
    raw_base64: btoa("Deleted.cs"),
    encoding: "unix_bytes",
  };
  const base = { Commit: { oid: "a".repeat(40) } },
    target = { Commit: { oid: "b".repeat(40) } };
  w.state.tabs = [
    {
      id: "t",
      path: { ...path, raw_base64: "other" },
      base,
      target,
      data: { base: { files: [] }, target: { files: [] } },
    } as any,
  ];
  w.state.activeTab = "t";
  let finish: any;
  w.api.desktop = vi.fn(() => new Promise((r) => (finish = r)));
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  const pending = dispatchPanelAction(w, {
    panel: "files",
    action: "open_revision",
    payload: {
      scope: panelSnapshot(w, {}).scope,
      path: path.raw_base64,
      base,
      target,
    },
  });
  w.state.activeTab = "another";
  finish({ kind: "CommitDetails", paths: [path] });
  await pending;
  expect(open).not.toHaveBeenCalled();
});
it("accepts smaller and larger font sizes from detached panels", async () => {
  const w = fixture();
  const settings = vi.fn();
  for (const scale of [80, 90, 175, 200]) {
    await dispatchPanelAction(
      w,
      {
        panel: "files",
        action: "set_view",
        payload: { scope: panelSnapshot(w, {}).scope, scale },
      },
      settings,
    );
    expect(settings).toHaveBeenLastCalledWith({ scale });
  }
});

it("shares a selected comparison with detached panels and rejects unknown bases", async () => {
  const w = fixture();
  w.state.commits = [{ oid: "target" }, { oid: "base" }] as any;
  const payload = {
    scope: panelSnapshot(w, {}).scope,
    oid: "target",
    base: "base",
  };
  await dispatchPanelAction(w, {
    panel: "git",
    action: "select_commit",
    payload,
  });
  const detached = new DetachedWorkspace({ read: vi.fn(), desktop: vi.fn() });
  detached.hydrate(panelSnapshot(w, {}));
  expect(detached.state.filesCommit).toEqual({ oid: "target", base: "base" });
  await dispatchPanelAction(w, {
    panel: "git",
    action: "select_commit",
    payload: { ...payload, base: "unknown" },
  });
  expect(w.state.filesCommit).toEqual({ oid: "target", base: "base" });
});
