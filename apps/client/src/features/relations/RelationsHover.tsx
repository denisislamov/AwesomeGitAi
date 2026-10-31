import React, { useEffect, useState } from "react";
import type { Workspace } from "../../workspace";
import { activeRelations, fileUsages } from "./hoverModel";
export function SymbolText({
  workspace: w,
  text,
}: {
  workspace: Workspace;
  text: string;
}) {
  const report = activeRelations(w);
  if (!report) return <>{text}</>;
  const names = new Map<string, string[]>();
  for (const s of report.symbols)
    names.set(s.name, [...(names.get(s.name) ?? []), s.id]);
  return (
    <>
      {text.split(/([\p{L}_][\p{L}\p{N}_]*)/u).map((part, i) => {
        const ids = names.get(part);
        return ids?.length === 1 ? (
          <button
            key={i}
            className="prose-symbol"
            data-symbol-id={ids[0]}
            onClick={() => w.showRelations(true, ids[0])}
          >
            {part}
          </button>
        ) : (
          part
        );
      })}
    </>
  );
}
export function FileUsageHint({ workspace: w }: { workspace: Workspace }) {
  const r = activeRelations(w),
    tab = w.active();
  if (!r || !tab) return null;
  return (
    <button
      className="file-usage-hint"
      data-symbol-id="__file__"
      aria-label="File usages"
    >
      ↗ {fileUsages(r, tab.path).length} usages
      {r.status === "Partial" ? " · partial" : ""}
    </button>
  );
}
export function RelationsHover({ workspace: w }: { workspace: Workspace }) {
  const report = activeRelations(w),
    tab = w.active();
  const [hover, setHover] = useState<{ id: string; node: HTMLElement } | null>(
    null,
  );
  const [lines, setLines] = useState<string[]>([]);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const enter = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".relation-hover")) {
        clearTimeout(timer);
        return;
      }
      const node = target?.closest<HTMLElement>("[data-symbol-id]");
      clearTimeout(timer);
      if (node) {
        const show = () => setHover({ id: node.dataset.symbolId!, node });
        if (event.type === "mouseover") timer = setTimeout(show, 220);
        else show();
      } else timer = setTimeout(() => setHover(null), 180);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHover(null);
    };
    document.addEventListener("mouseover", enter);
    document.addEventListener("focusin", enter);
    // Read the original target before React can replace it during navigation.
    document.addEventListener("click", enter, true);
    document.addEventListener("keydown", escape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("click", enter, true);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    setHover(null);
  }, [tab?.id, report?.origin_snapshot_id, w.state.relations?.open]);
  useEffect(() => {
    if (!hover || !report) {
      setLines([]);
      return;
    }
    const update = () => {
      if (!hover.node.isConnected) {
        setHover(null);
        return;
      }
      const a = hover.node.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(a.left, window.innerWidth - 370)),
        top: Math.max(8, Math.min(a.bottom + 5, window.innerHeight - 280)),
      });
      const linked = Array.from(
        document.querySelectorAll<HTMLElement>("[data-symbol-id]"),
      ).filter((n) => n !== hover.node && n.dataset.symbolId === hover.id);
      const paths: string[] = [];
      for (const n of linked) {
        const b = n.getBoundingClientRect();
        const owner = n
          .closest(".cm-scroller, .explanation-body")
          ?.getBoundingClientRect();
        if (
          !b.width ||
          !b.height ||
          b.bottom < 0 ||
          b.top > window.innerHeight ||
          b.right < 0 ||
          b.left > window.innerWidth ||
          (owner &&
            (b.top < owner.top ||
              b.bottom > owner.bottom ||
              b.left < owner.left ||
              b.right > owner.right))
        )
          continue;
        const x = a.left + a.width / 2,
          y = a.top + a.height / 2,
          xx = b.left + b.width / 2,
          yy = b.top + b.height / 2;
        paths.push(
          `M ${x} ${y} C ${x + 35} ${y}, ${xx + 35} ${yy}, ${xx} ${yy}`,
        );
        if (paths.length === 8) break;
      }
      setLines(paths);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const all = Array.from(
      document.querySelectorAll<HTMLElement>("[data-symbol-id]"),
    ).filter((n) => n.dataset.symbolId === hover.id);
    all.forEach((n) => n.classList.add("relation-linked"));
    return () => {
      all.forEach((n) => n.classList.remove("relation-linked"));
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hover, report]);
  if (!hover || !report || !tab || w.state.relations?.open) return null;
  const symbol = report.symbols.find((s) => s.id === hover.id);
  const refs =
    hover.id === "__file__" ? fileUsages(report, tab.path) : symbol?.references;
  if (!refs) return null;
  return (
    <>
      <svg className="relation-threads" aria-hidden="true">
        {lines.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
      <section
        className="relation-hover"
        aria-label="Usages preview"
        style={position}
      >
        <strong>
          {symbol?.name ?? "File usages"} · {refs.length}
          {report.status === "Partial" ? " found · partial" : " usages"}
        </strong>
        <small>
          {symbol
            ? "Captured code references"
            : "External references to symbols declared in this file"}
        </small>
        {!refs.length && <p>No usages found in the captured source set.</p>}
        <div className="usage-preview-list">
          {refs.slice(0, 40).map((r, i) => (
            <button
              key={i}
              title={`${r.path.display}:${r.line}:${r.column}`}
              onClick={() => {
                setHover(null);
                void w.openRelationLocation(r.path, r.line, r.column);
              }}
            >
              <span>
                {r.path.display.split("/").at(-1)}:{r.line} · {r.kind}
              </span>
              <code>{r.snippet}</code>
            </button>
          ))}
        </div>
        {refs.length > 40 && <small>Showing the first 40 locations.</small>}
        {symbol && (
          <button
            onClick={() => {
              setHover(null);
              w.showRelations(true, symbol.id);
            }}
          >
            All relations…
          </button>
        )}
        <button
          onClick={() => setHover(null)}
          aria-label="Close usages preview"
        >
          Close
        </button>
      </section>
    </>
  );
}
