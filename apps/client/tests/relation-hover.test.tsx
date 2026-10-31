import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import {
  relationTokens,
  fileUsages,
} from "../src/features/relations/hoverModel";
import {
  RelationsHover,
  SymbolText,
} from "../src/features/relations/RelationsHover";
import { Workspace } from "../src/workspace";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const path = { display: "A.cs", raw_base64: "QQ==", encoding: "unix_bytes" };
const other = { ...path, display: "B.cs", raw_base64: "Qg==" };
const symbol = {
  id: "symbol",
  name: "Spend",
  kind: "Method",
  path,
  line: 1,
  column: 1,
  references: [
    { path: other, line: 7, column: 4, kind: "Call", snippet: "a.Spend();" },
  ],
};
const report: any = {
  origin_snapshot_id: "origin",
  snapshot_id: "expanded",
  status: "Partial",
  symbols: [symbol],
  files: [path, other],
};
function fixture() {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.tabs = [
    { id: "tab", path, data: { target: { id: "origin" } } } as any,
  ];
  w.state.activeTab = "tab";
  w.state.relations = { report } as any;
  return w;
}
it("only marks verified source coordinates and deduplicates external file references", () => {
  expect(relationTokens(report, path, "Spend()\n")).toEqual([
    { from: 0, to: 5, id: "symbol" },
  ]);
  expect(relationTokens(report, path, "Other()\n")).toEqual([]);
  expect(
    fileUsages({ ...report, symbols: [symbol, symbol] }, path),
  ).toHaveLength(1);
});
it("shows cached usages on hover and navigates to their exact location", () => {
  vi.useFakeTimers();
  const w = fixture();
  const open = vi.spyOn(w, "openRelationLocation").mockResolvedValue();
  render(
    <>
      <SymbolText workspace={w} text="Call Spend here" />
      <RelationsHover workspace={w} />
    </>,
  );
  fireEvent.mouseOver(screen.getByRole("button", { name: "Spend" }));
  expect(screen.queryByRole("region", { name: "Usages preview" })).toBeNull();
  act(() => vi.advanceTimersByTime(220));
  expect(screen.getByText(/partial/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /B.cs:7/ }));
  expect(open).toHaveBeenCalledWith(other, 7, 4);
  expect(w.api.desktop).not.toHaveBeenCalled();
});
it("does not open a popup when the pointer only crosses a symbol", () => {
  vi.useFakeTimers();
  const w = fixture();
  render(
    <>
      <SymbolText workspace={w} text="Spend" />
      <RelationsHover workspace={w} />
    </>,
  );
  fireEvent.mouseOver(screen.getByRole("button", { name: "Spend" }));
  fireEvent.mouseOver(document.body);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("region", { name: "Usages preview" })).toBeNull();
});
it("does not link ambiguous names or stale snapshot reports", () => {
  const w = fixture();
  w.state.relations!.report = {
    ...report,
    symbols: [symbol, { ...symbol, id: "overload" }],
  };
  const ui = render(<SymbolText workspace={w} text="Spend" />);
  expect(screen.queryByRole("button")).toBeNull();
  w.state.relations!.report = { ...report, origin_snapshot_id: "old" };
  ui.rerender(<SymbolText workspace={w} text="Spend" />);
  expect(screen.queryByRole("button")).toBeNull();
});
