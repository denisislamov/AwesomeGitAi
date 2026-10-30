import { it, expect } from "vitest";
import { Workspace } from "../src/workspace";
it("keeps the most recently selected artifact when an older request arrives late", async () => {
  let release!: (v: any) => void;
  const first = new Promise<any>((r) => (release = r));
  const record = (id: string) => ({
    kind: "LearningRecord" as const,
    record: {
      item: {
        id,
        kind: "diagram",
        title: id,
        snapshot_id: "snapshot",
        source: "agent_reported",
      },
      trace: null,
      diagram: {
        snapshot_id: "snapshot",
        title: id,
        assumptions: ["fixture"],
        nodes: [],
        edges: [],
      },
    },
  });
  const w = new Workspace({
    read: async () => {
      throw Error("unused");
    },
    desktop: async (r) =>
      r.kind === "LearningGet" && r.id === "first" ? first : record("second"),
  });
  w.state.repo = { repo_id: "repo", worktree_id: "wt" } as any;
  w.state.learningItems = ["first", "second"].map(
    (id) => record(id).record.item,
  );
  const slow = w.openLearning("first");
  await w.openLearning("second");
  release(record("first"));
  await slow;
  expect(w.state.learningRecord?.item.id).toBe("second");
});
it("keeps the most recent source location when navigation finishes out of order", async () => {
  const w = new Workspace({
    read: async () => {
      throw Error("unused");
    },
    desktop: async () => {
      throw Error("unused");
    },
  });
  w.state.repo = { repo_id: "repo", worktree_id: "wt" } as any;
  const path = { display: "a", raw_base64: "YQ==", encoding: "unix_bytes" };
  const a = { path, line: 1 },
    b = { path, line: 2 };
  w.state.learningRecord = {
    item: {
      id: "record",
      kind: "diagram",
      title: "fixture",
      snapshot_id: "snapshot",
      source: "agent_reported",
    },
    trace: null,
    diagram: {
      snapshot_id: "snapshot",
      title: "fixture",
      assumptions: ["fixture"],
      nodes: [
        { id: "a", label: "a", location: a },
        { id: "b", label: "b", location: b },
      ],
      edges: [],
    },
  };
  let release!: () => void;
  let count = 0;
  w.openFile = async () => {
    if (count++ === 0) await new Promise<void>((r) => (release = r));
  };
  const slow = w.openLearningLocation(a);
  await w.openLearningLocation(b);
  release();
  await slow;
  expect(w.state.learningLocation?.location.line).toBe(2);
});
it("invalidates source navigation when the trace completes", async () => {
  const fixture = await import("../../../packages/fixtures/trace-v1.json");
  const t = fixture.success as any;
  const w = new Workspace({
    read: async () => {
      throw Error("unused");
    },
    desktop: async () => {
      throw Error("unused");
    },
  });
  w.state.learningRecord = {
    item: { id: "t", snapshot_id: t.snapshot_id },
    trace: t,
  } as any;
  w.state.traceStep = t.steps.at(-2).id;
  let release!: () => void;
  w.openFile = async () => {
    await new Promise<void>((r) => (release = r));
  };
  const pending = w.openLearningLocation(t.steps[0].location);
  await w.moveTrace("next");
  release();
  await pending;
  expect(w.state.learningLocation).toBeNull();
});
