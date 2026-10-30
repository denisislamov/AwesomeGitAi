import { expect, it } from "vitest";
import {
  relationChanges,
  relationLenses,
} from "../src/features/relations/model";
import type { CodeTab } from "../src/workspace";
const path = { display: "a.ts", raw_base64: "YQ==", encoding: "unix_bytes" };
const other = { display: "b.ts", raw_base64: "Yg==", encoding: "unix_bytes" };
const file = (path: any, text: string) => ({
  path,
  state: "Present",
  encoding: "utf8",
  bytes: [...new TextEncoder().encode(text)],
});
const symbol: any = {
  id: "f",
  name: "f",
  path,
  kind: "function",
  line: 1,
  column: 17,
  references: [
    { path: other, line: 2, column: 1, kind: "Call", snippet: "f(2);" },
    { path: other, line: 3, column: 1, kind: "Call", snippet: "f(3);" },
    { path: other, line: 2, column: 1, kind: "Reference", snippet: "f(2);" },
  ],
};
const report: any = {
  origin_snapshot_id: "target",
  snapshot_id: "analysis",
  status: "Partial",
  files: [path, other],
  symbols: [symbol],
};
const tab = () =>
  ({
    data: {
      base: {
        id: "base",
        repo_id: "r",
        worktree_id: "w",
        files: [
          file(path, "export function f(n: number) {}\n"),
          file(other, "// calls\nf(1);\nf(3);\n"),
        ],
      },
      target: {
        id: "target",
        repo_id: "r",
        worktree_id: "w",
        files: [
          file(path, "export function f(n: number) {}\n"),
          file(other, "// calls\nf(2);\nf(3);\n"),
        ],
      },
    },
  }) as CodeTab;
it("identifies actual changed reference lines, excludes unchanged references and deduplicates locations", () => {
  const result = relationChanges(report, symbol, tab());
  expect(
    result.locations.map((l) => [l.path.display, l.line, l.column]),
  ).toEqual([["b.ts", 2, 1]]);
  expect(result.checkedPaths.map((p) => p.display)).toEqual(["a.ts", "b.ts"]);
  expect(result.partial).toBe(false);
  expect(relationLenses(report, path, tab())[0].label).toContain(
    "1 changed location",
  );
});
it("does not interpret a missing base manifest entry as a deleted or new file", () => {
  const t = tab();
  t.data.base.files = t.data.base.files.filter(
    (f) => f.path.raw_base64 !== other.raw_base64,
  );
  const result = relationChanges(report, symbol, t);
  expect(result.locations).toEqual([]);
  expect(result.partial).toBe(true);
  expect(result.checkedPaths.map((p) => p.display)).toEqual(["a.ts"]);
});
it("rejects comparison evidence from another origin snapshot", () => {
  const result = relationChanges(
    { ...report, origin_snapshot_id: "other" },
    symbol,
    tab(),
  );
  expect(result.locations).toEqual([]);
  expect(result.checkedPaths).toEqual([]);
  expect(result.partial).toBe(true);
});
it("includes a changed declaration but does not shift a deleted line onto an unchanged reference", () => {
  const t = tab();
  t.data.base.files = [
    file(path, "export function f(n: number) {}\n"),
    file(other, "// calls\nremoved();\nf(2);\nf(3);\n"),
  ] as any;
  t.data.target.files[0] = file(
    path,
    "export function f(n: string) {}\n",
  ) as any;
  expect(
    relationChanges(report, symbol, t).locations.map((l) => [
      l.path.display,
      l.line,
    ]),
  ).toEqual([["a.ts", 1]]);
});
