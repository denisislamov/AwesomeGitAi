import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import type { CodeTab, FileComparison } from "../../workspace";
import type {
  CodeRelationsReport,
  RelationSymbol,
  RepoPath,
  RelationReference,
} from "../../../../../packages/api/src/generated";
export function relationCount(
  report: CodeRelationsReport,
  symbol: RelationSymbol,
) {
  if (report.status !== "Ready" && report.status !== "Partial")
    return "Unknown";
  const count = symbol.references.length;
  return report.status === "Partial"
    ? `${count} found · partial`
    : `${count} references`;
}
export function relationLenses(
  report: CodeRelationsReport | null | undefined,
  path: RepoPath,
  tab?: CodeTab,
) {
  if (!report || !["Ready", "Partial"].includes(report.status)) return [];
  return report.symbols
    .filter(
      (s) =>
        s.path.raw_base64 === path.raw_base64 &&
        !["Local", "Parameter", "TypeParameter", "param"].includes(s.kind),
    )
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .slice(0, 200)
    .map((symbol) => ({
      id: symbol.id,
      symbolId: symbol.id,
      name: symbol.name,
      path: symbol.path,
      line: symbol.line,
      label:
        relationCount(report, symbol) +
        (() => {
          const count = relationChanges(report, symbol, tab).locations.length;
          return count
            ? ` · ${count} changed location${count === 1 ? "" : "s"}`
            : "";
        })(),
    }));
}

type ChangedFile = { text: Text; lines: Set<number>; precise: boolean };
const comparisonChanges = new WeakMap<
  FileComparison,
  Map<string, ChangedFile | null>
>();
function changedFile(tab: CodeTab, path: RepoPath): ChangedFile | null {
  let cache = comparisonChanges.get(tab.data);
  if (!cache) comparisonChanges.set(tab.data, (cache = new Map()));
  if (cache.has(path.raw_base64)) return cache.get(path.raw_base64)!;
  const a = tab.data.base.files.find(
    (f) => f.path.raw_base64 === path.raw_base64,
  );
  const b = tab.data.target.files.find(
    (f) => f.path.raw_base64 === path.raw_base64,
  );
  let result: ChangedFile | null = null;
  // A missing manifest entry is unknown. Only an explicit Absent entry is empty.
  if (a && b && a.state !== "Conflicted" && b.state !== "Conflicted") {
    try {
      const decode = (f: typeof a) => {
        const text =
          f.state === "Absent"
            ? ""
            : new TextDecoder("utf-8", { fatal: true }).decode(
                new Uint8Array(f.bytes),
              );
        if (text.includes("\0")) throw Error("BINARY");
        return Text.of(text.replace(/\r\n/g, "\n").split("\n"));
      };
      const old = decode(a),
        text = decode(b);
      const chunks = Chunk.build(old, text);
      const lines = new Set<number>();
      for (const chunk of chunks) {
        if (!chunk.precise || chunk.fromB === chunk.toB) continue;
        for (const change of chunk.changes) {
          const from = chunk.fromB + change.fromB,
            to = chunk.fromB + change.toB;
          // A deleted whole line has no corresponding changed target line.
          if (
            from === to &&
            old
              .sliceString(chunk.fromA + change.fromA, chunk.fromA + change.toA)
              .includes("\n")
          )
            continue;
          const first = text.lineAt(Math.min(from, text.length)).number;
          const last = text.lineAt(
            Math.min(Math.max(from, to - 1), text.length),
          ).number;
          for (let n = first; n <= last; n++) lines.add(n);
        }
      }
      result = { text, lines, precise: chunks.every((c) => c.precise) };
    } catch {
      /* Binary or invalid text is not change evidence. */
    }
  }
  cache.set(path.raw_base64, result);
  return result;
}
/** Confirmed source-line changes, not inferred effects on behavior. */
export function relationChanges(
  report: CodeRelationsReport,
  symbol: RelationSymbol,
  tab?: CodeTab,
): {
  locations: RelationReference[];
  checkedPaths: RepoPath[];
  partial: boolean;
} {
  if (
    !tab ||
    report.origin_snapshot_id !== tab.data.target.id ||
    tab.data.base.repo_id !== tab.data.target.repo_id ||
    tab.data.base.worktree_id !== tab.data.target.worktree_id ||
    !["Ready", "Partial"].includes(report.status)
  )
    return { locations: [], checkedPaths: [], partial: true };
  const candidates = [
    {
      path: symbol.path,
      line: symbol.line,
      column: symbol.column,
      kind: "Declaration",
      snippet: "",
    },
    ...symbol.references,
  ];
  const paths = new Map(candidates.map((r) => [r.path.raw_base64, r.path]));
  const checkedPaths: RepoPath[] = [],
    locations: RelationReference[] = [];
  const seen = new Set<string>();
  let partial = false;
  for (const path of paths.values()) {
    const changed = changedFile(tab, path);
    if (!changed) {
      partial = true;
      continue;
    }
    checkedPaths.push(path);
    if (!changed.precise) partial = true;
    for (const location of candidates) {
      if (
        location.path.raw_base64 !== path.raw_base64 ||
        !changed.lines.has(location.line)
      )
        continue;
      const key = JSON.stringify([
        path.raw_base64,
        location.line,
        location.column,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({
        ...location,
        snippet: changed.text.line(location.line).text,
      });
    }
  }
  return { locations, checkedPaths, partial };
}
