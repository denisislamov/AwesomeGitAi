export const panelIds = ["files", "code", "explanation", "git"] as const;
export type PanelId = (typeof panelIds)[number];
export type Edge = "left" | "right" | "top" | "bottom";
export type Node =
  | { kind: "panel"; panel: PanelId }
  | {
      kind: "split";
      id: string;
      axis: "horizontal" | "vertical";
      ratio: number;
      first: Node;
      second: Node;
    };
export type Layout = {
  version: 1;
  tree: Node;
  hidden: PanelId[];
  detached: PanelId[];
};
const panel = (id: PanelId): Node => ({ kind: "panel", panel: id });
export const initialLayout = (): Layout => ({
  version: 1,
  hidden: [],
  detached: [],
  tree: {
    kind: "split",
    id: "root",
    axis: "vertical",
    ratio: 0.7,
    first: {
      kind: "split",
      id: "columns",
      axis: "horizontal",
      ratio: 0.2,
      first: panel("files"),
      second: {
        kind: "split",
        id: "editor",
        axis: "horizontal",
        ratio: 0.7,
        first: panel("code"),
        second: panel("explanation"),
      },
    },
    second: panel("git"),
  },
});
export const leaves = (n: Node): PanelId[] =>
  n.kind === "panel" ? [n.panel] : [...leaves(n.first), ...leaves(n.second)];
export type LayoutAction =
  | { type: "move"; panel: PanelId; target: PanelId; edge: Edge }
  | { type: "resize"; id: string; ratio: number }
  | { type: "hide" | "show" | "detach" | "redock"; panel: PanelId }
  | { type: "reset" };
const map = (n: Node, f: (n: Node) => Node): Node =>
  f(
    n.kind === "panel"
      ? n
      : { ...n, first: map(n.first, f), second: map(n.second, f) },
  );
function remove(n: Node, p: PanelId): Node | null {
  if (n.kind === "panel") return n.panel === p ? null : n;
  const first = remove(n.first, p),
    second = remove(n.second, p);
  return first && second ? { ...n, first, second } : (first ?? second);
}
export function layoutReducer(s: Layout, a: LayoutAction): Layout {
  if (a.type === "reset") return initialLayout();
  if (a.type === "resize")
    return Number.isFinite(a.ratio)
      ? {
          ...s,
          tree: map(s.tree, (n) =>
            n.kind === "split" && n.id === a.id
              ? { ...n, ratio: Math.max(0.15, Math.min(0.85, a.ratio)) }
              : n,
          ),
        }
      : s;
  if (a.type === "move") {
    if (a.panel === a.target) return s;
    const tree = remove(s.tree, a.panel)!;
    const ids = new Set<string>();
    map(tree, (n) => {
      if (n.kind === "split") ids.add(n.id);
      return n;
    });
    let id = `split-${a.panel}`;
    while (ids.has(id)) id += "-next";
    return {
      ...s,
      tree: map(tree, (n) =>
        n.kind === "panel" && n.panel === a.target
          ? {
              kind: "split",
              id,
              axis:
                a.edge === "left" || a.edge === "right"
                  ? "horizontal"
                  : "vertical",
              ratio: 0.5,
              first: a.edge === "left" || a.edge === "top" ? panel(a.panel) : n,
              second:
                a.edge === "left" || a.edge === "top" ? n : panel(a.panel),
            }
          : n,
      ),
    };
  }
  const hidden = s.hidden.filter((p) => p !== a.panel),
    detached = s.detached.filter((p) => p !== a.panel);
  if (a.type === "hide") hidden.push(a.panel);
  if (a.type === "detach") detached.push(a.panel);
  return { ...s, hidden, detached };
}
export function restoreLayout(raw: string | null): Layout {
  try {
    if (!raw || raw.length > 10000) return initialLayout();
    const s = JSON.parse(raw);
    const ids = new Set<string>();
    const valid = (n: any, depth = 0): boolean => {
      if (!n || depth > 6) return false;
      if (n.kind === "panel") return panelIds.includes(n.panel);
      if (
        n.kind !== "split" ||
        typeof n.id !== "string" ||
        ids.has(n.id) ||
        !["horizontal", "vertical"].includes(n.axis) ||
        !Number.isFinite(n.ratio) ||
        n.ratio < 0.15 ||
        n.ratio > 0.85
      )
        return false;
      ids.add(n.id);
      return valid(n.first, depth + 1) && valid(n.second, depth + 1);
    };
    if (
      s?.version !== 1 ||
      !valid(s.tree) ||
      leaves(s.tree).sort().join() !== [...panelIds].sort().join() ||
      !Array.isArray(s.hidden) ||
      !s.hidden.every((p: any) => panelIds.includes(p)) ||
      new Set(s.hidden).size !== s.hidden.length
    )
      return initialLayout();
    return { version: 1, tree: s.tree, hidden: s.hidden, detached: [] };
  } catch {
    return initialLayout();
  }
}
