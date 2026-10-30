import { describe, it, expect } from "vitest";
import {
  initialLayout,
  layoutReducer,
  restoreLayout,
  panelIds,
  leaves,
} from "../src/features/layout/model";
describe("IDE layout", () => {
  it("starts with all panels and Git below", () => {
    const s = initialLayout();
    expect(leaves(s.tree)).toEqual(panelIds);
    expect(s.tree).toMatchObject({ axis: "vertical", ratio: 0.7 });
  });
  it("moves a panel without losing or duplicating panels", () => {
    const s = layoutReducer(initialLayout(), {
      type: "move",
      panel: "files",
      target: "git",
      edge: "bottom",
    });
    expect(leaves(s.tree).sort()).toEqual([...panelIds].sort());
    expect(leaves(s.tree).at(-1)).toBe("files");
  });
  it("bounds split sizes and rejects nonfinite sizes", () => {
    let s = initialLayout();
    s = layoutReducer(s, { type: "resize", id: "root", ratio: 2 });
    expect(s.tree).toMatchObject({ ratio: 0.85 });
    expect(
      layoutReducer(s, { type: "resize", id: "root", ratio: NaN }),
    ).toEqual(s);
  });
  it("restores closed and detached panels at their original positions", () => {
    const original = initialLayout();
    let s = layoutReducer(original, { type: "hide", panel: "code" });
    s = layoutReducer(s, { type: "detach", panel: "files" });
    s = layoutReducer(s, { type: "show", panel: "code" });
    s = layoutReducer(s, { type: "redock", panel: "files" });
    expect(s).toEqual(original);
  });
  it("recovers corrupt, obsolete and duplicate saved data", () => {
    for (const raw of [
      "bad",
      "null",
      '{"version":99}',
      JSON.stringify({
        ...initialLayout(),
        tree: { kind: "panel", panel: "files" },
      }),
    ])
      expect(restoreLayout(raw)).toEqual(initialLayout());
  });
  it("persists geometry but redocks stale detached windows after restart", () => {
    const s = layoutReducer(initialLayout(), {
      type: "detach",
      panel: "files",
    });
    expect(restoreLayout(JSON.stringify(s))).toEqual(initialLayout());
  });
});

it("keeps split identifiers unique through repeated moves", () => {
  let s = initialLayout();
  for (let i = 0; i < 100; i++) {
    s = layoutReducer(s, {
      type: "move",
      panel: panelIds[i % 4],
      target: panelIds[(i + 1) % 4],
      edge: i % 2 ? "left" : "bottom",
    });
    expect(restoreLayout(JSON.stringify(s))).toEqual(s);
  }
});
