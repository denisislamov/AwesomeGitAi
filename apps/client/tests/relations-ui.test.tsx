import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { relationLenses, relationCount } from "../src/features/relations/model";
import { RelationsDialog } from "../src/features/relations/RelationsDialog";
import { Workspace } from "../src/workspace";
afterEach(cleanup);
const path = { display: "a.ts", raw_base64: "YQ==", encoding: "unix_bytes" };
const report: any = {
  origin_snapshot_id: "origin",
  snapshot_id: "snapshot",
  status: "Partial",
  adapter: "ts",
  message: "Captured files only",
  files: [path],
  symbols: Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    name: "method" + i,
    kind: "method",
    path,
    line: i + 1,
    column: 1,
    references:
      i === 0
        ? [
            {
              path,
              line: 10,
              column: 1,
              kind: "ReadWrite",
              snippet: "count += 1",
            },
          ]
        : [],
  })),
};
it("keeps later declarations accessible and labels partial counts explicitly", () => {
  expect(relationLenses(report, path).map((l) => l.label)).toEqual([
    "1 found · partial",
    "0 found · partial",
    "0 found · partial",
    "0 found · partial",
    "0 found · partial",
  ]);
  expect(
    relationCount({ ...report, status: "Unavailable" }, report.symbols[1]),
  ).toBe("Unknown");
  expect(relationLenses({ ...report, status: "Unavailable" }, path)).toEqual(
    [],
  );
  expect(relationLenses(report, { ...path, raw_base64: "other" })).toEqual([]);
});
it("shows grouped snippets and makes additional declarations explicitly accessible", () => {
  const w = new Workspace({
    read: async () => {
      throw Error();
    },
    desktop: async () => {
      throw Error();
    },
  });
  w.state.relations = {
    key: "k",
    snapshotId: "origin",
    path,
    loading: false,
    report,
    error: null,
    open: true,
    symbolId: "0",
  };
  render(<RelationsDialog workspace={w} />);
  expect(screen.getByRole("dialog", { name: "Code relations" })).toBeTruthy();
  expect(screen.getByText("ReadWrite")).toBeTruthy();
  expect(screen.getByText("count += 1")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Declaration"), {
    target: { value: "4" },
  });
  expect(w.state.relations?.symbolId).toBe("4");
  expect(
    screen.getByText(
      "No references found in captured files; analysis is partial.",
    ),
  ).toBeTruthy();
});
it("shows confirmed comparison changes separately from semantic reference groups", () => {
  const w = new Workspace({
    read: async () => {
      throw Error();
    },
    desktop: async () => {
      throw Error();
    },
  });
  const file = (text: string) => ({
    path,
    state: "Present",
    bytes: [...new TextEncoder().encode(text)],
  });
  const before = Array.from({ length: 10 }, (_, i) =>
    i === 9 ? "count += 0" : "// unchanged",
  ).join("\n");
  const after = before.replace("count += 0", "count += 1");
  w.state.tabs = [
    {
      id: "tab",
      path,
      data: {
        base: { id: "base", files: [file(before)] },
        target: { id: "origin", files: [file(after)] },
      },
    } as any,
  ];
  w.state.activeTab = "tab";
  w.state.relations = {
    key: "k",
    snapshotId: "origin",
    path,
    loading: false,
    report,
    error: null,
    open: true,
    symbolId: "0",
  };
  render(<RelationsDialog workspace={w} />);
  const group = screen.getByRole("region", {
    name: "Related changes in this comparison",
  });
  expect(group.textContent).toContain("a.ts:10:1");
  expect(group.textContent).toContain("1 file checked");
  expect(group.textContent).toContain(
    "Only files captured on both sides; other related files not evaluated",
  );
});
it("keeps parameter and local-variable counts out of default declaration lenses", () => {
  const r = {
    ...report,
    symbols: [
      report.symbols[0],
      ...["Parameter", "Local", "param"].map((kind) => ({
        ...report.symbols[1],
        kind,
      })),
    ],
  };
  expect(relationLenses(r, path)).toHaveLength(1);
});
