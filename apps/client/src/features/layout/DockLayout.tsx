import React, { useEffect, useReducer, useRef, useState } from "react";
import {
  initialLayout,
  layoutReducer,
  restoreLayout,
  panelIds,
  type Node,
  type PanelId,
  type Edge,
} from "./model";
import {
  openPanel,
  closePanel,
  listPanels,
  nativePanelsAvailable,
} from "./native";
import "./layout.css";
import { Dialog } from "../commands/CommandUI";
const titles: Record<PanelId, string> = {
  files: "Files",
  code: "Code",
  explanation: "Explanation",
  git: "Git",
};
const key = "agai-layout-v1";
export function DockLayout({
  panels,
  native = nativePanelsAvailable(),
  settingsOpen,
  onSettingsClose,
}: {
  panels: Record<PanelId, React.ReactNode>;
  native?: boolean;
  settingsOpen?: boolean;
  onSettingsClose?: () => void;
}) {
  const [layout, dispatch] = useReducer(layoutReducer, null, () => {
    try {
      return restoreLayout(localStorage.getItem(key));
    } catch {
      return initialLayout();
    }
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PanelId[]>([]);
  const drag = useRef<PanelId | null>(null);
  const latest = useRef(layout);
  latest.current = layout;
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      setError("Could not save panel layout.");
    }
  }, [layout]);
  useEffect(() => {
    if (!native) return;
    let stopped = false;
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const candidates = [...latest.current.detached];
        const open = await listPanels();
        if (!stopped)
          for (const p of candidates)
            if (!open.includes(p)) dispatch({ type: "redock", panel: p });
      } catch {
        /* retry while desktop is starting */
      } finally {
        running = false;
      }
    };
    const timer = setInterval(check, 500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [native]);
  async function detach(p: PanelId) {
    setPending((v) => [...v, p]);
    try {
      await openPanel(p);
      dispatch({ type: "detach", panel: p });
      setError("");
    } catch (e) {
      setError(`Could not open window: ${String(e)}`);
    } finally {
      setPending((v) => v.filter((x) => x !== p));
    }
  }
  async function show(p: PanelId) {
    try {
      if (layout.detached.includes(p)) await closePanel(p);
      dispatch({ type: "show", panel: p });
    } catch (e) {
      setError(String(e));
    }
  }
  async function reset() {
    try {
      for (const p of layout.detached) await closePanel(p);
      dispatch({ type: "reset" });
    } catch (e) {
      setError(String(e));
    }
  }
  const visible = (n: Node): boolean =>
    n.kind === "panel"
      ? !layout.hidden.includes(n.panel) && !layout.detached.includes(n.panel)
      : visible(n.first) || visible(n.second);
  function render(n: Node): React.ReactNode {
    if (!visible(n)) return null;
    if (n.kind === "split") {
      if (!visible(n.first)) return render(n.second);
      if (!visible(n.second)) return render(n.first);
      return (
        <div
          className={`dock-split ${n.axis}`}
          key={n.id}
          style={{
            gridTemplateColumns:
              n.axis === "horizontal"
                ? `${n.ratio}fr 6px ${1 - n.ratio}fr`
                : undefined,
            gridTemplateRows:
              n.axis === "vertical"
                ? `${n.ratio}fr 6px ${1 - n.ratio}fr`
                : undefined,
          }}
        >
          {render(n.first)}
          <div
            className="dock-divider"
            role="separator"
            tabIndex={0}
            aria-label="Panel size"
            aria-orientation={
              n.axis === "horizontal" ? "vertical" : "horizontal"
            }
            aria-valuemin={15}
            aria-valuemax={85}
            aria-valuenow={Math.round(n.ratio * 100)}
            onKeyDown={(e) => {
              const delta =
                e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -0.03
                  : e.key === "ArrowRight" || e.key === "ArrowDown"
                    ? 0.03
                    : 0;
              if (delta) {
                e.preventDefault();
                dispatch({ type: "resize", id: n.id, ratio: n.ratio + delta });
              }
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const r = e.currentTarget.parentElement!.getBoundingClientRect();
              dispatch({
                type: "resize",
                id: n.id,
                ratio:
                  n.axis === "horizontal"
                    ? (e.clientX - r.left) / r.width
                    : (e.clientY - r.top) / r.height,
              });
            }}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          />
          {render(n.second)}
        </div>
      );
    }
    const p = n.panel;
    return (
      <section
        key={p}
        className={`dock-panel dock-panel-${p}`}
        aria-label={titles[p]}
        onDragOver={(e) => {
          if (drag.current) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const source = drag.current;
          drag.current = null;
          if (!source || source === p) return;
          const r = e.currentTarget.getBoundingClientRect(),
            x = (e.clientX - r.left) / r.width,
            y = (e.clientY - r.top) / r.height;
          const distances: [Edge, number][] = [
            ["left", x],
            ["right", 1 - x],
            ["top", y],
            ["bottom", 1 - y],
          ];
          distances.sort((a, b) => a[1] - b[1]);
          dispatch({
            type: "move",
            panel: source,
            target: p,
            edge: distances[0][0],
          });
        }}
      >
        <header
          className="dock-title"
          draggable
          onDragStart={(e) => {
            drag.current = p;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", p);
          }}
          onDragEnd={() => {
            drag.current = null;
          }}
        >
          <strong>{p === "explanation" ? "Context" : titles[p]}</strong>
          <details className="dock-menu">
            <summary aria-label={`Place ${titles[p]}`}>⋮</summary>
            <div>
              {panelIds
                .filter((t) => t !== p)
                .flatMap((target) =>
                  (["left", "right", "top", "bottom"] as Edge[]).map((edge) => (
                    <button
                      key={`${target}-${edge}`}
                      onClick={() =>
                        dispatch({ type: "move", panel: p, target, edge })
                      }
                    >
                      {
                        {
                          left: "Left of",
                          right: "Right of",
                          top: "Above",
                          bottom: "Below",
                        }[edge]
                      }{" "}
                      «{titles[target]}»
                    </button>
                  )),
                )}
              {native && (
                <button
                  disabled={pending.includes(p)}
                  onClick={() => void detach(p)}
                >
                  Detach window
                </button>
              )}
            </div>
          </details>
          <button
            aria-label={`Hide ${titles[p]}`}
            disabled={pending.includes(p)}
            onClick={() => dispatch({ type: "hide", panel: p })}
          >
            ×
          </button>
        </header>
        <div className="dock-content">{panels[p]}</div>
      </section>
    );
  }
  return (
    <div className="dock-workspace">
      {settingsOpen === undefined ? (
        <details className="dock-toolbar">
          <summary>Panels</summary>
          <div className="dock-toolbar-menu">
            {panelIds.map((p) => (
              <button key={p} onClick={() => void show(p)}>
                {titles[p]}
              </button>
            ))}
            <button onClick={() => void reset()}>Reset layout</button>
          </div>
        </details>
      ) : (
        settingsOpen && (
          <Dialog title="Panels" onClose={() => onSettingsClose?.()}>
            <div className="panel-settings">
              {panelIds.map((p) => (
                <button
                  key={p}
                  disabled={pending.includes(p)}
                  onClick={() => void show(p)}
                >
                  {titles[p]}
                  {layout.detached.includes(p) ? " — return from window" : ""}
                </button>
              ))}
              <button
                disabled={pending.length > 0}
                onClick={() => void reset()}
              >
                Reset layout
              </button>
            </div>
          </Dialog>
        )
      )}
      {error && <span role="alert">{error}</span>}
      <div className="dock-root">
        {render(layout.tree) || (
          <button disabled={pending.length > 0} onClick={() => void reset()}>
            Show panels
          </button>
        )}
      </div>
    </div>
  );
}
