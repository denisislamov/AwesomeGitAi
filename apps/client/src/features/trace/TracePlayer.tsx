import React, { useState } from "react";
import type { Workspace } from "../../workspace";
import { variableChanges } from "./transition";
export function TracePlayer({ workspace: w }: { workspace: Workspace }) {
  const [watches, setWatches] = useState<string[]>([]);
  const s = w.state,
    t = s.learningRecord?.trace,
    step = t?.steps.find((x) => x.id === s.traceStep);
  if (!t || !step)
    return (
      <p>
        Select a recorded scenario. Your agent can submit one with trace_record
        through MCP.
      </p>
    );
  const frame =
      step.frames.find((f) => f.id === s.traceFrame) ?? step.frames.at(-1),
    previous = t.steps
      .find((x) => x.id === s.tracePreviousStep)
      ?.frames.find((f) => f.id === frame?.id);
  const changed = frame ? variableChanges(frame, previous) : [];
  return (
    <section
      className="trace-player"
      aria-label="Step explanation"
      onKeyDown={(e) => {
        if (e.altKey && e.key === "ArrowRight") {
          e.preventDefault();
          void w.moveTrace("next");
        }
        if (e.altKey && e.key === "ArrowLeft") {
          e.preventDefault();
          void w.moveTrace("back");
        }
      }}
    >
      <h3>{t.title}</h3>
      <p className="source-note">
        Educational model · {s.learningRecord?.item.source} · not observed
        execution
      </p>
      <details>
        <summary>Inputs and assumptions</summary>
        <ul>
          {t.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <dl>
          {t.inputs.map((v) => (
            <React.Fragment key={v.name}>
              <dt>
                {v.name} : {v.type_name}
              </dt>
              <dd>{v.known ? v.value : "Unknown"}</dd>
            </React.Fragment>
          ))}
        </dl>
      </details>
      <div className="trace-controls">
        <button
          disabled={step.id === t.entry_step}
          onClick={() => void w.moveTrace("back")}
        >
          Back
        </button>
        <button disabled={!step.next} onClick={() => void w.moveTrace("next")}>
          Next
        </button>
        <button disabled={!step.into} onClick={() => void w.moveTrace("into")}>
          Step into
        </button>
        <button disabled={!step.over} onClick={() => void w.moveTrace("over")}>
          Step over
        </button>
        <button disabled={!step.out} onClick={() => void w.moveTrace("out")}>
          Step out
        </button>
        <button onClick={() => void w.moveTrace("restart")}>Restart</button>
      </div>
      <p className="trace-phase">
        Step {t.steps.indexOf(step) + 1} / {t.steps.length} · {step.phase}
        {step.location ? ` line ${step.location.line}` : ""}
      </p>
      <p className="step-explanation" aria-live="polite">
        {step.explanation}
      </p>
      {step.phase === "Unknown" && (
        <p>Execution beyond this point is unknown. No values are inferred.</p>
      )}
      {step.result && (
        <p role="status">
          Result ({step.result.type_name}):{" "}
          <strong>{step.result.known ? step.result.value : "Unknown"}</strong>
        </p>
      )}
      {!step.next && t.final_values?.length > 0 && (
        <section aria-label="Final supplied values">
          <h4>Final supplied values</h4>
          <dl>
            {t.final_values.map((v) => (
              <React.Fragment key={v.name}>
                <dt>
                  {v.name} : {v.type_name}
                </dt>
                <dd>{v.known ? v.value : "Unknown"}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      )}
      <h4>Call stack</h4>
      {step.frames.length ? (
        <ol className="trace-stack">
          {[...step.frames].reverse().map((f) => (
            <li key={f.id}>
              <button
                aria-pressed={f.id === frame?.id}
                onClick={() => void w.chooseTraceFrame(f.id)}
              >
                {f.label} · {f.location.path.display}:{f.location.line}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>Call stack empty — scenario complete.</p>
      )}
      {frame && (
        <>
          <h4>Variables · {frame.label}</h4>
          <table className="trace-values">
            <thead>
              <tr>
                <th>Name / type</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {frame.locals.map((v) => (
                <tr
                  key={v.name}
                  className={changed.includes(v.name) ? "variable-changed" : ""}
                >
                  <td>
                    {v.name}
                    <small>{v.type_name}</small>
                  </td>
                  <td>
                    {changed.includes(v.name) &&
                      (() => {
                        const old = previous?.locals.find(
                          (x) => x.name === v.name,
                        );
                        return `${old?.known ? old.value : "Unknown"} → `;
                      })()}
                    {v.known ? v.value : "Unknown"}
                    {changed.includes(v.name) && (
                      <small>changed since previous step viewed</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>Watch provided values</summary>
            <select
              aria-label="Add variable watch"
              value=""
              onChange={(e) =>
                setWatches([...new Set([...watches, e.target.value])])
              }
            >
              <option value="">Choose a variable…</option>
              {frame.locals.map((v) => (
                <option key={v.name}>{v.name}</option>
              ))}
            </select>
            {watches.map((name) => {
              const v = frame.locals.find((v) => v.name === name);
              return (
                <p key={name}>
                  {name}:{" "}
                  {v
                    ? v.known
                      ? v.value
                      : "Unknown"
                    : "Not provided for this frame"}{" "}
                  <button
                    aria-label={`Remove watch ${name}`}
                    onClick={() =>
                      setWatches(watches.filter((n) => n !== name))
                    }
                  >
                    ×
                  </button>
                </p>
              );
            })}
            <p>
              Watches display supplied values; expressions are never executed.
            </p>
          </details>
        </>
      )}
      <small>Alt + ← / →: previous / next step</small>
    </section>
  );
}
