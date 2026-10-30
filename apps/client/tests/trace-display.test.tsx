import React from "react";
import { it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TracePlayer } from "../src/features/trace/TracePlayer";
import { Workspace } from "../src/workspace";
import fixture from "../../../packages/fixtures/trace-v1.json";
it("displays old and new values in both navigation directions", () => {
  const w = new Workspace({
    read: async () => {
      throw Error("unused");
    },
    desktop: async () => {
      throw Error("unused");
    },
  });
  const t = structuredClone(fixture.success);
  w.state.learningRecord = {
    item: { id: "t", source: "agent_reported" },
    trace: t,
  } as any;
  const pair = t.steps.findIndex(
    (s, i) =>
      i > 0 &&
      s.frames[0]?.locals.find((v) => v.name === "resource")?.value === "10" &&
      t.steps[i - 1].frames[0]?.locals.find((v) => v.name === "resource")
        ?.value === "30",
  );
  w.state.traceStep = t.steps[pair].id;
  w.state.tracePreviousStep = t.steps[pair - 1].id;
  const view = render(<TracePlayer workspace={w} />);
  expect(view.container.textContent).toContain("30 → 10");
  w.state.traceStep = t.steps[pair - 1].id;
  w.state.tracePreviousStep = t.steps[pair].id;
  view.rerender(<TracePlayer workspace={w} />);
  expect(view.container.textContent).toContain("10 → 30");
  cleanup();
});
