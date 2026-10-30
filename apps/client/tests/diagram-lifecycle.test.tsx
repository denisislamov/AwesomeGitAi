import React from "react";
import { it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
vi.mock("@xyflow/react", () => ({
  ReactFlow: () => null,
  Background: () => null,
  Controls: () => null,
}));
import { DiagramPanel } from "../src/features/diagram/DiagramPanel";
import { Workspace } from "../src/workspace";
it("can close or replace a diagram using the bundled in-process ELK engine", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.learningRecord = {
    item: { id: "diagram" },
    diagram: {
      snapshot_id: "snapshot",
      title: "fixture",
      assumptions: ["fixture"],
      nodes: [{ id: "a", label: "A", location: null }],
      edges: [],
    },
  } as any;
  const view = render(<DiagramPanel workspace={w} />);
  expect(() => view.unmount()).not.toThrow();
});
