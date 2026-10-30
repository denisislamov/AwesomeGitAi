import React, { useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import "@xyflow/react/dist/style.css";
import type { Workspace } from "../../workspace";
export function DiagramPanel({ workspace: w }: { workspace: Workspace }) {
  const d = w.state.learningRecord?.diagram;
  const [layout, setLayout] = useState<{
      id: string;
      nodes: Node[];
      edges: Edge[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLayout(null);
    setError("");
    if (!d) return;
    const id = w.state.learningRecord!.item.id;
    const elk = new ELK();
    void elk
      .layout({
        id: "root",
        layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN" },
        children: d.nodes.map((n) => ({ id: n.id, width: 210, height: 60 })),
        edges: d.edges.map((e) => ({
          id: e.id,
          sources: [e.from],
          targets: [e.to],
        })),
      })
      .then((graph) => {
        if (cancelled) return;
        setLayout({
          id,
          nodes: d.nodes.map((n) => {
            const position = graph.children?.find((c) => c.id === n.id);
            return {
              id: n.id,
              position: { x: position?.x ?? 0, y: position?.y ?? 0 },
              data: { label: n.label },
              style: {
                width: 210,
                background: "#282828",
                color: "#ebdbb2",
                border: "1px solid #8ec07c",
                fontFamily: "Monaco,monospace",
                fontSize: 15,
              },
            };
          }),
          edges: d.edges.map((e) => ({
            id: e.id,
            source: e.from,
            target: e.to,
            label: `${e.label} · ${e.certainty}`,
            style: {
              stroke: e.certainty === "Reported" ? "#8ec07c" : "#d79921",
              strokeDasharray: e.certainty === "Reported" ? undefined : "5 4",
            },
            labelStyle: { fill: "#ebdbb2" },
            labelBgStyle: { fill: "#282828" },
          })),
        });
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Diagram layout failed. The relationship list is still available.",
          );
      });
    return () => {
      cancelled = true;
      elk.terminateWorker();
    };
  }, [d]);
  if (!d)
    return (
      <p>
        Select a recorded diagram. Your agent can submit one with diagram_record
        through MCP.
      </p>
    );
  return (
    <section aria-label="Dependency diagram">
      <h3>{d.title}</h3>
      <p>
        Agent-reported model · snapshot {d.snapshot_id.slice(0, 8)}. Dashed
        edges are inferred or unknown.
      </p>
      <details>
        <summary>Assumptions</summary>
        <ul>
          {d.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </details>
      {error && <p role="status">{error}</p>}
      <div className="diagram-canvas">
        {layout && layout.id === w.state.learningRecord?.item.id && (
          <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode="dark"
            fitView
            minZoom={0.2}
            onNodeClick={(_, n) => {
              const location = d.nodes.find((x) => x.id === n.id)?.location;
              if (location) void w.openLearningLocation(location);
            }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
      <h4>Code locations</h4>
      <ul>
        {d.nodes.map((n) => (
          <li key={n.id}>
            {n.location ? (
              <button onClick={() => void w.openLearningLocation(n.location!)}>
                {n.label} · {n.location.path.display}:{n.location.line}
              </button>
            ) : (
              <span>{n.label} · no code location provided</span>
            )}
          </li>
        ))}
      </ul>
      <h4>Relationships</h4>
      <ul>
        {d.edges.map((e) => (
          <li key={e.id}>
            {d.nodes.find((n) => n.id === e.from)?.label} →{" "}
            {d.nodes.find((n) => n.id === e.to)?.label}: {e.label} (
            {e.certainty})
          </li>
        ))}
      </ul>
    </section>
  );
}
