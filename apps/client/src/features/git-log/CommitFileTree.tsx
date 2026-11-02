import React, { useMemo } from "react";
import type { RepoPath } from "../../../../../packages/api/src/generated";
type Folder = { folders: Map<string, Folder>; files: RepoPath[] };
export function CommitFileTree({
  paths,
  onOpen,
}: {
  paths: RepoPath[];
  onOpen: (p: RepoPath) => void;
}) {
  const root = useMemo(() => {
    const root: Folder = { folders: new Map(), files: [] };
    for (const path of paths) {
      let folder = root;
      for (const name of path.display.split("/").slice(0, -1)) {
        if (!folder.folders.has(name))
          folder.folders.set(name, { folders: new Map(), files: [] });
        folder = folder.folders.get(name)!;
      }
      folder.files.push(path);
    }
    return root;
  }, [paths]);
  const render = (folder: Folder, prefix: string): React.ReactNode => (
    <>
      {[...folder.folders]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => (
          <details key={name} open>
            <summary title={prefix + name}>{name}</summary>
            <div className="commit-tree-children">
              {render(child, prefix + name + "/")}
            </div>
          </details>
        ))}
      {folder.files.map((p) => (
        <button
          key={p.raw_base64}
          className="commit-file"
          title={p.display}
          aria-label={p.display}
          onClick={() => onOpen(p)}
        >
          <span>{p.display.split("/").at(-1)}</span>
        </button>
      ))}
    </>
  );
  return <div className="commit-file-tree">{render(root, "")}</div>;
}
