import React, { useSyncExternalStore } from "react";
import { Dialog } from "../commands/CommandUI";
import { relationCount, relationChanges } from "./model";
import type { Workspace } from "../../workspace";
import type { RelationReference } from "../../../../../packages/api/src/generated";
export function RelationsDialog({ workspace: w }: { workspace: Workspace }) {
  const state = useSyncExternalStore(w.subscribe, w.getSnapshot),
    relations = state.relations;
  if (!relations?.open) return null;
  const report = relations.report;
  const symbols = report?.symbols ?? [];
  const selected =
    symbols.find((s) => s.id === relations.symbolId) ??
    symbols.find((s) => s.path.raw_base64 === relations.path.raw_base64) ??
    symbols[0];
  const changes =
    report && selected ? relationChanges(report, selected, w.active()) : null;
  const groups = new Map<string, RelationReference[]>();
  for (const r of selected?.references ?? [])
    groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
  return (
    <Dialog title="Code relations" onClose={() => w.showRelations(false)}>
      <div className="relations-dialog">
        <p className="muted">{relations.path.display} · captured snapshot</p>
        {relations.loading && <p role="status">Finding references…</p>}
        {relations.error && (
          <p role="alert">References unavailable. {relations.error}</p>
        )}
        {report && (
          <>
            <p role="status">
              {report.status} · {report.adapter}. {report.message}
            </p>
            {!["Ready", "Partial"].includes(report.status) ? (
              <p>Reference count unknown.</p>
            ) : (
              <>
                {symbols.length > 0 && (
                  <label>
                    Declaration{" "}
                    <select
                      aria-label="Declaration"
                      value={selected?.id ?? ""}
                      onChange={(e) => w.showRelations(true, e.target.value)}
                    >
                      {symbols.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.kind} · {s.path.display}:{s.line}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selected && (
                  <p>
                    <button
                      onClick={() =>
                        void w.openRelationLocation(
                          selected.path,
                          selected.line,
                          selected.column,
                        )
                      }
                    >
                      {selected.name}:{selected.line}
                    </button>{" "}
                    · {relationCount(report, selected)}
                  </p>
                )}
                {[...groups].map(([kind, refs]) => (
                  <section key={kind} aria-label={kind}>
                    <h4>{kind}</h4>
                    <ul>
                      {refs.map((ref, i) => (
                        <li
                          key={`${ref.path.raw_base64}:${ref.line}:${ref.column}:${i}`}
                        >
                          <button
                            className="relation-reference"
                            onClick={() =>
                              void w.openRelationLocation(
                                ref.path,
                                ref.line,
                                ref.column,
                              )
                            }
                          >
                            <span>
                              {ref.path.display}:{ref.line}:{ref.column}
                            </span>
                            <code>{ref.snippet}</code>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {changes && (
                  <section aria-label="Related changes in this comparison">
                    <h4>Related changes in this comparison</h4>
                    <p className="muted">
                      Only files captured on both sides; other related files not
                      evaluated
                    </p>
                    <p>
                      {changes.checkedPaths.length} file
                      {changes.checkedPaths.length === 1 ? "" : "s"} checked
                      {changes.partial ? " · incomplete coverage" : ""}
                    </p>
                    <ul>
                      {changes.locations.map((location) => (
                        <li
                          key={`${location.path.raw_base64}:${location.line}:${location.column}`}
                        >
                          <button
                            className="relation-reference"
                            onClick={() =>
                              void w.openRelationLocation(
                                location.path,
                                location.line,
                                location.column,
                              )
                            }
                          >
                            <span>
                              {location.path.display}:{location.line}:
                              {location.column}
                            </span>
                            <code>{location.snippet}</code>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {!changes.locations.length && (
                      <p>
                        {changes.checkedPaths.length
                          ? "No changed related locations confirmed in checked files."
                          : "Related changes unknown for this comparison."}
                      </p>
                    )}
                  </section>
                )}
                {selected && !selected.references.length && (
                  <p>
                    {report.status === "Partial"
                      ? "No references found in captured files; analysis is partial."
                      : "No references found in this analysis."}
                  </p>
                )}
                {!symbols.length && (
                  <p>
                    {report.status === "Partial"
                      ? "No declarations found in captured files; analysis is partial."
                      : "No declarations found in this file."}
                  </p>
                )}
              </>
            )}
            {report.files.length > 0 && (
              <details>
                <summary>
                  Related files in analysis ({report.files.length})
                </summary>
                <p className="muted">
                  Captured source files; inclusion does not imply a semantic
                  effect.
                </p>
                <ul>
                  {report.files.map((path) => (
                    <li key={path.raw_base64}>
                      <button
                        onClick={() => void w.openRelationLocation(path, 1)}
                      >
                        {path.display}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {state.relationBack && (
          <button
            onClick={() => {
              w.showRelations(false);
              w.backFromRelations();
            }}
          >
            Back to source
          </button>
        )}
      </div>
    </Dialog>
  );
}
