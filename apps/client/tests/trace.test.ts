import { describe, it, expect } from "vitest";
import fixture from "../../../packages/fixtures/trace-v1.json";
import {
  transition,
  selectFrame,
  validateTrace,
  variableChanges,
} from "../src/features/trace/transition";
import type { TraceScenario } from "../../../packages/api/src/generated";
const success = fixture.success as TraceScenario,
  failure = fixture.failure as TraceScenario;
const local = (s: TraceScenario, i: number, n: string) =>
  s.steps[i].frames[0].locals.find((v) => v.name === n)?.value;
describe("educational trace state", () => {
  it("keeps pre-line values, explicit normalized direction, ticks and outcome", () => {
    validateTrace(success);
    expect(success.steps[3].location?.line).toBe(10);
    expect(local(success, 3, "resource")).toBe("30");
    expect(success.steps[4].location?.line).toBe(11);
    expect(local(success, 4, "resource")).toBe("10");
    expect(local(success, 9, "direction")).toBe("(0.70710677, 0.70710677)");
    expect(local(success, 9, "ticks")).toBe("10");
    expect(local(success, 9, "active")).toBe("true");
    expect(success.steps.at(-1)?.result?.value).toBe("true");
    expect(success.steps.at(-1)?.frames).toEqual([]);
  });
  it("shows failure without inventing resource or movement changes", () => {
    validateTrace(failure);
    expect(local(failure, 1, "resource")).toBe("10");
    expect(local(failure, 1, "active")).toBe("false");
    expect(local(failure, 1, "direction")).toBe("(0, 0)");
    expect(failure.steps.at(-1)?.result?.value).toBe("false");
  });
  it("step over and into/out agree; frame selection never advances execution", () => {
    expect(transition(success, "1", "over")).toBe("5");
    expect(transition(success, transition(success, "1", "into"), "out")).toBe(
      "5",
    );
    expect(
      selectFrame(success, { step: "2", frame: "wallet" }, "dash"),
    ).toEqual({ step: "2", frame: "dash" });
  });
  it("compares variable values to the previously viewed frame snapshot", () => {
    expect(
      variableChanges(success.steps[4].frames[0], success.steps[3].frames[0]),
    ).toEqual(["resource"]);
    expect(
      variableChanges(success.steps[3].frames[0], success.steps[4].frames[0]),
    ).toEqual(["resource"]);
  });
  it("rejects dangling links, loops and mismatched stack transitions", () => {
    for (const mutate of [
      (t: TraceScenario) => {
        t.steps[0].next = "missing";
      },
      (t: TraceScenario) => {
        t.steps[1].next = "0";
      },
      (t: TraceScenario) => {
        t.steps[3].frames[0].id = "foreign";
      },
    ]) {
      const t = structuredClone(success);
      mutate(t);
      expect(() => validateTrace(t)).toThrow();
    }
  });
});
it("matches the agreed cross-file TrySpend acceptance baseline", () => {
  expect(success.inputs.find((v) => v.name === "input")?.value).toBe("(1, 1)");
  for (const scenario of [success, failure]) {
    const nested = scenario.steps.find(
      (s) => s.frames.at(-1)?.label === "TrySpend",
    )!;
    expect(nested).toBeDefined();
    expect(nested.location?.path.display).toBe("ResourceWallet.cs");
    const call = scenario.steps.find((s) => s.into === nested.id)!;
    const returned = scenario.steps.find((s) => s.id === call.over)!;
    expect(returned.phase).toBe("Return");
    expect(returned.frames[0].label).toBe("TryDash");
    expect(returned.result?.value).toBe(
      scenario === success ? "true" : "false",
    );
    expect(
      returned.frames[0].locals.find((v) => v.name === "resource")?.value,
    ).toBe("10");
  }
});
it('does not step out of the root frame', () => {
  expect(transition(success, success.entry_step, 'out')).toBe(success.entry_step);
});
