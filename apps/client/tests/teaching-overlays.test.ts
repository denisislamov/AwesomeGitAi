import { it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { csharp } from "@replit/codemirror-lang-csharp";
import {
  teachingModel,
  inlineValues,
  teachingDecorations,
} from "../src/features/code/teaching-overlays";
import { Workspace, type CodeTab } from "../src/workspace";
import fixture from "../../../packages/fixtures/trace-v1.json";
const setup = () => {
  const w = new Workspace({
    read: async () => {
      throw Error("unused");
    },
    desktop: async () => {
      throw Error("unused");
    },
  });
  const t = structuredClone(fixture.success);
  w.state.learningMode = "trace";
  w.state.learningRecord = {
    item: { id: "t", snapshot_id: t.snapshot_id },
    trace: t,
  } as any;
  w.state.traceStep = "2";
  w.state.traceFrame = "wallet";
  w.state.learningLocation = {
    snapshotId: t.snapshot_id,
    location: t.steps[2].location!,
  };
  const tab = {
    id: "tab",
    path: t.steps[2].location!.path,
    data: {
      target: { id: t.snapshot_id },
      base: { id: "other" },
      comparison: { id: "cmp" },
    },
  } as CodeTab;
  return { w, tab, t };
};
it("pins recorded values to the selected frame, path, new side and snapshot", () => {
  const { w, tab } = setup();
  expect(
    teachingModel(w, tab, "New").trace?.values.find(
      (v) => v.name === "resource",
    )?.value,
  ).toBe("30");
  expect(teachingModel(w, tab, "Old").trace).toBeNull();
  expect(
    teachingModel(
      w,
      { ...tab, data: { ...tab.data, target: { id: "newer" } as any } },
      "New",
    ).trace,
  ).toBeNull();
  w.state.traceFrame = "dash";
  expect(teachingModel(w, tab, "New").trace).toBeNull();
  w.state.traceFrame = "wallet";
  w.state.learningMode = "diagram";
  expect(teachingModel(w, tab, "New").trace).toBeNull();
});
it("marks only the explained range on its exact comparison and side", () => {
  const { w, tab } = setup();
  w.state.learningMode = "explanation";
  w.state.selection = {
    comparisonId: "cmp",
    snapshotId: tab.data.target.id,
    path: tab.path,
    side: "New",
    startLine: 2,
    endLine: 4,
  };
  expect(teachingModel(w, tab, "New").range).toEqual({ start: 2, end: 4 });
  expect(teachingModel(w, tab, "Old").range).toBeNull();
  w.state.selection.comparisonId = "other";
  expect(teachingModel(w, tab, "New").range).toBeNull();
});
it("adds values beside identifiers but never comments, strings or another object member", () => {
  const text =
    'resource += cost; other.resource = 1; var s = "resource"; // cost';
  const state = EditorState.create({ doc: text, extensions: [csharp()] });
  const values = [
    { name: "resource", type_name: "float", value: "30", known: true },
    { name: "cost", type_name: "float", value: "?", known: false },
  ];
  const hints = inlineValues(state, 1, values, []);
  expect(hints.map((h) => h.name)).toEqual(["resource", "cost"]);
  expect(hints.map((h) => h.value)).toEqual(["30", "Unknown"]);
  expect(hints[0].pos).toBe("resource".length);
});
it("keeps trace arrow, outline and inline values in the decoration set", () => {
  const state = EditorState.create({
    doc: "resource -= cost;",
    extensions: [csharp()],
  });
  const model = {
    range: null,
    trace: {
      line: 1,
      phase: "Before",
      values: [
        { name: "resource", type_name: "float", value: "10", known: true },
      ],
      previous: [
        { name: "resource", type_name: "float", value: "30", known: true },
      ],
    },
  };
  const set = teachingDecorations(state, model);
  const entries: any[] = [];
  set.between(0, state.doc.length, (_f, _t, d) => entries.push(d.spec));
  expect(
    entries.some((e) => e.attributes?.class?.includes("cm-trace-line")),
  ).toBe(true);
  const widget = entries.find((e) => e.widget)?.widget.toDOM();
  expect(widget.textContent).toContain("10");
  expect(widget.title).toContain("30 → 10");
  expect(widget.title).toContain("Simulation");
});
it("does not assign a shadowed local value to this.field", () => {
  const state = EditorState.create({
    doc: "this.resource = resource;",
    extensions: [csharp()],
  });
  const hints = inlineValues(
    state,
    1,
    [{ name: "resource", type_name: "float", value: "10", known: true }],
    [],
  );
  expect(hints).toHaveLength(1);
  expect(hints[0].pos).toBe("this.resource = resource".length);
});
