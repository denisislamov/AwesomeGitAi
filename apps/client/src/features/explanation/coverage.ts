import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import type { CodeTab } from "../../workspace";
import type { DecisionView } from "../../../../../packages/api/src/generated";
export function coverage(tab: CodeTab, decisions: DecisionView[]) {
  const decode = (bytes: number[]) =>
    Text.of(new TextDecoder().decode(new Uint8Array(bytes)).split("\n"));
  const a = decode(
      tab.data.base.files.find((f) => f.path.raw_base64 === tab.path.raw_base64)
        ?.bytes ?? [],
    ),
    b = decode(
      tab.data.target.files.find(
        (f) => f.path.raw_base64 === tab.path.raw_base64,
      )?.bytes ?? [],
    );
  const changed = new Set<string>();
  for (const c of Chunk.build(a, b))
    for (const [side, doc, from, to] of [
      ["Old", a, c.fromA, c.toA],
      ["New", b, c.fromB, c.toB],
    ] as const) {
      if (to <= from) continue;
      for (
        let line = doc.lineAt(Math.min(from, doc.length)).number;
        line <= doc.lineAt(Math.min(Math.max(from, to - 1), doc.length)).number;
        line++
      )
        changed.add(`${side}:${line}`);
    }
  const explained = new Set<string>();
  for (const d of decisions)
    if (!d.superseded_by)
      for (const v of d.anchors) {
        if (
          v.resolution !== "Exact" ||
          d.base_snapshot_id !== tab.data.base.id ||
          d.target_snapshot_id !== tab.data.target.id
        )
          continue;
        for (let n = v.anchor.start_line; n <= v.anchor.end_line; n++) {
          const key = `${v.anchor.side}:${n}`;
          if (changed.has(key)) explained.add(key);
        }
      }
  return { total: changed.size, explained: explained.size };
}
