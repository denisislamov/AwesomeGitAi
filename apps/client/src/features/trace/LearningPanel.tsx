import React from "react";
import type { Workspace } from "../../workspace";
import { ExplanationPanel } from "../explanation/ExplanationPanel";
import { TracePlayer } from "./TracePlayer";
import { DiagramPanel } from "../diagram/DiagramPanel";
export function LearningPanel({ workspace: w }: { workspace: Workspace }) {
  const s = w.state;
  return (
    <div className="learning-panel">
      <div className="segmented" aria-label="Explanation tools">
        {(["explanation", "trace", "diagram"] as const).map((mode, i) => (
          <button
            key={mode}
            aria-pressed={s.learningMode === mode}
            onClick={() => w.setLearningMode(mode)}
          >
            {["Explanation", "Steps", "Diagram"][i]}
          </button>
        ))}
      </div>
      {s.learningMode === "explanation" ? (
        <ExplanationPanel workspace={w} />
      ) : (
        <div className="learning-content">
          <div className="learning-picker">
            <select
              aria-label="Recorded learning artifact"
              value={
                s.learningRecord?.item.kind === s.learningMode
                  ? s.learningRecord.item.id
                  : ""
              }
              onChange={(e) => void w.openLearning(e.target.value)}
            >
              <option value="">
                Select a recorded{" "}
                {s.learningMode === "trace" ? "scenario" : "diagram"}…
              </option>
              {s.learningItems
                .filter((i) => i.kind === s.learningMode)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title} · {i.snapshot_id.slice(0, 8)}
                  </option>
                ))}
            </select>
            <button onClick={() => void w.refreshLearning()}>Refresh</button>
          </div>
          {s.learningRecord?.item.kind === s.learningMode && (
            <p className="snapshot-notice">
              Pinned snapshot {s.learningRecord.item.snapshot_id.slice(0, 8)}.
              This model describes that recorded version, not your current
              working copy.
            </p>
          )}
          {s.learningMode === "trace" ? (
            <TracePlayer key={s.learningRecord?.item.id} workspace={w} />
          ) : (
            <DiagramPanel workspace={w} />
          )}
        </div>
      )}
    </div>
  );
}
