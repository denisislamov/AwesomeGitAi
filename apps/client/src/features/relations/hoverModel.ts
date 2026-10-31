import type {
  CodeRelationsReport,
  RepoPath,
} from "../../../../../packages/api/src/generated";
import type { Workspace } from "../../workspace";
export function activeRelations(w: Workspace) {
  const report = w.state.relations?.report;
  return report &&
    report.origin_snapshot_id === w.active()?.data.target.id &&
    ["Ready", "Partial"].includes(report.status)
    ? report
    : null;
}
export function fileUsages(report: CodeRelationsReport, path: RepoPath) {
  const unique = new Map();
  for (const s of report.symbols.filter(
    (s) => s.path.raw_base64 === path.raw_base64,
  ))
    for (const r of s.references.filter(
      (r) => r.path.raw_base64 !== path.raw_base64,
    ))
      unique.set(JSON.stringify([r.path.raw_base64, r.line, r.column]), r);
  return [
    ...unique.values(),
  ] as CodeRelationsReport["symbols"][number]["references"];
}
export function relationTokens(
  report: CodeRelationsReport,
  path: RepoPath,
  text: string,
) {
  const lines = text.split("\n"),
    starts = [0];
  for (let i = 0; i < lines.length; i++)
    starts.push(starts[i] + lines[i].length + 1);
  const tokens = new Map<
    string,
    { from: number; to: number; id: string } | null
  >();
  for (const symbol of report.symbols)
    for (const place of [symbol, ...symbol.references]) {
      if (
        place.path.raw_base64 !== path.raw_base64 ||
        place.line < 1 ||
        place.line > lines.length ||
        place.column < 1
      )
        continue;
      const from = starts[place.line - 1] + place.column - 1,
        to = from + symbol.name.length;
      if (text.slice(from, to) !== symbol.name) continue;
      const key = `${from}:${to}`,
        prior = tokens.get(key);
      if (tokens.has(key) && prior?.id !== symbol.id) tokens.set(key, null);
      else tokens.set(key, { from, to, id: symbol.id });
    }
  return [...tokens.values()].filter(
    (x): x is { from: number; to: number; id: string } => !!x,
  );
}
