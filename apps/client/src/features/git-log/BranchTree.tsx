import React, { useState } from "react";
import type { BranchRef } from "../../../../../packages/api/src/generated";
type Node = {
  label: string;
  prefix: string;
  children: Map<string, Node>;
  branch?: BranchRef;
};
export function BranchTree({
  branches,
  current,
  selected,
  onSelect,
}: {
  branches: BranchRef[];
  current: string | null;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [folders, setFolders] = useState<Record<string, boolean>>(() => {
    try {
      const v = JSON.parse(
        localStorage.getItem("agai-branch-folders-v1") ?? "{}",
      );
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  });
  const toggle = (key: string, open: boolean) => {
    setFolders((old) => {
      const next = { ...old, [key]: open };
      try {
        localStorage.setItem("agai-branch-folders-v1", JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const render = (nodes: Map<string, Node>, remote: boolean): React.ReactNode =>
    [...nodes.values()]
      .sort(
        (a, b) =>
          Number(b.children.size > 0) - Number(a.children.size > 0) ||
          a.label.localeCompare(b.label),
      )
      .map((n) => {
        const key = `${remote ? "remote" : "local"}/${n.prefix}`;
        const branch = n.branch;
        const button = branch && (
          <button
            key={branch.name}
            title={branch.name}
            aria-label={`Branch ${branch.name}`}
            aria-current={
              !remote && current === branch.name ? "true" : undefined
            }
            aria-pressed={selected === branch.name}
            onClick={() => onSelect(branch.name)}
          >
            ⑂ {n.label}
            {!remote && current === branch.name ? " · HEAD" : ""}
          </button>
        );
        return n.children.size ? (
          <details
            key={key}
            open={
              folders[key] ?? (!remote && !!current?.startsWith(n.prefix + "/"))
            }
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                toggle(
                  key,
                  !(
                    folders[key] ??
                    (!remote && !!current?.startsWith(n.prefix + "/"))
                  ),
                );
              }}
              title={n.prefix}
            >
              {n.label}
            </summary>
            <div className="branch-children">
              {button}
              {render(n.children, remote)}
            </div>
          </details>
        ) : (
          button
        );
      });
  return (
    <>
      {[false, true].map((remote) => {
        const nodes = new Map<string, Node>();
        for (const b of branches.filter((b) => b.remote === remote)) {
          let level = nodes;
          let prefix = "";
          const parts = b.name.split("/");
          parts.forEach((label, i) => {
            prefix = prefix ? prefix + "/" + label : label;
            let node = level.get(label);
            if (!node) {
              node = { label, prefix, children: new Map() };
              level.set(label, node);
            }
            if (i === parts.length - 1) node.branch = b;
            level = node.children;
          });
        }
        return (
          <section
            key={String(remote)}
            aria-label={remote ? "Remote branches" : "Local branches"}
          >
            <h4>{remote ? "REMOTE" : "LOCAL"}</h4>
            {render(nodes, remote)}
          </section>
        );
      })}
    </>
  );
}
