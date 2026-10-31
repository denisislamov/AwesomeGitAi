import { SymbolText } from "../relations/RelationsHover";
import React, { useEffect, useMemo, useState } from "react";
import { isRecordedReview, type Workspace } from "../../workspace";
import type {
  AnchorResolution,
  DecisionView,
} from "../../../../../packages/api/src/generated";
import { coverage } from "./coverage";
const label = (r: AnchorResolution) =>
  typeof r === "object"
    ? "Anchor relocated — check context"
    : {
        Exact: "Exact version",
        Stale: "Code changed",
        Missing: "Fragment missing",
        Ambiguous: "Multiple matches",
      }[r];
export function ExplanationPanel({ workspace }: { workspace: Workspace }) {
  const s = workspace.state,
    tab = workspace.active(),
    selection = s.selection;
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const counts = useMemo(
    () => (tab ? coverage(tab, s.explanations) : null),
    [tab, s.explanations],
  );
  useEffect(() => {
    if (!s.explanationOpen || s.explanationLayout !== "popover") return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") workspace.showExplanation(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [workspace, s.explanationOpen, s.explanationLayout]);
  if (!s.explanationOpen) return null;
  const visible = s.explanations.filter(
    (d) =>
      !selection ||
      d.anchors.some(
        (v) =>
          v.anchor.side === selection.side &&
          (typeof v.resolution === "object"
            ? v.resolution.Relocated.start_line <= selection.endLine &&
              v.resolution.Relocated.end_line >= selection.startLine
            : v.anchor.start_line <= selection.endLine &&
              v.anchor.end_line >= selection.startLine),
      ),
  );
  return (
    <aside
      aria-label="Explanation"
      className={
        "explanation " + (s.explanationLayout === "popover" ? "popover" : "")
      }
    >
      {s.explanationLayout === "popover" && (
        <header>
          <span>Explanation</span>
          <button
            aria-label="Close explanation"
            onClick={() => workspace.showExplanation(false)}
          >
            ×
          </button>
        </header>
      )}
      <div className="explanation-body">
        {tab?.stale && (
          <p role="status">
            This snapshot is stale. The worktree changed; this is the previous
            code version.
          </p>
        )}
        {!visible.length && (
          <h2>{selection ? "No explanation yet" : "Select lines"}</h2>
        )}
        {!visible.length && (
          <p>
            {selection
              ? "The agent has not explained this fragment yet. Diff highlighting does not mean a decision was verified."
              : "Select code and choose Explain selection."}
          </p>
        )}
        {s.explanationsError && (
          <p role="alert">Could not load explanations: {s.explanationsError}</p>
        )}
        {s.explanationsTruncated && (
          <p>Showing the latest 100 decisions for this file.</p>
        )}
        {visible.map((d) => (
          <DecisionCard key={d.id} d={d} workspace={workspace} />
        ))}
        {tab && (
          <details className="explanation-source-details">
            <summary>Source details</summary>
            <h2>
              {visible.length
                ? tab && isRecordedReview(tab)
                  ? "About this code"
                  : "Why the code changed"
                : selection
                  ? "No explanation yet"
                  : "Select lines"}
            </h2>
            {selection && (
              <div className="context-card" data-testid="explanation-target">
                <strong>{selection.path.display}</strong>
                <br />
                {selection.side === "Old" ? "Old" : "New"} side · lines{" "}
                {selection.startLine}–{selection.endLine}
                <br />
                <small>
                  Snapshot {selection.snapshotId.slice(0, 8)}
                  <br />
                  Comparison {selection.comparisonId.slice(0, 8)}
                </small>
              </div>
            )}
            {counts && counts.total > 0 && (
              <p className="quiet-note">
                Exactly anchored explanations: {counts.explained} of{" "}
                {counts.total} changed lines (both sides). This measures
                explanation coverage, not correctness.
              </p>
            )}
          </details>
        )}
        {tab && (
          <div className="explanation-actions">
            <button onClick={() => void workspace.refreshExplanations()}>
              Refresh explanations
            </button>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    workspace.explanationRequest(),
                  );
                  setCopied(true);
                  setCopyError("");
                } catch {
                  setCopyError("Could not copy request");
                }
              }}
            >
              {copied ? "Request copied" : "Copy agent request"}
            </button>
            {copyError && <p role="alert">{copyError}</p>}
          </div>
        )}
        <p className="quiet-note">
          Explanations and check results are reported by the agent through MCP.
          The application does not invent the author's motives.
        </p>
      </div>
    </aside>
  );
}
function DecisionCard({
  d,
  workspace,
}: {
  d: DecisionView;
  workspace: Workspace;
}) {
  const [note, setNote] = useState("");
  const tab = workspace.active();
  const exact =
    tab?.data.base.id === d.base_snapshot_id &&
    tab?.data.target.id === d.target_snapshot_id;
  return (
    <article className="context-card decision-card">
      <small>
        Agent reported · revision {d.revision}
        {d.superseded_by ? " · superseded" : ""}
      </small>
      <h3>
        <SymbolText workspace={workspace} text={d.summary} />
      </h3>
      <p>
        <SymbolText workspace={workspace} text={d.behavior} />
      </p>
      <p>
        <SymbolText workspace={workspace} text={d.rationale} />
      </p>
      {d.anchors.map((v, i) => {
        const range =
          typeof v.resolution === "object" ? v.resolution.Relocated : v.anchor;
        const canHighlight =
          tab?.path.raw_base64 === v.anchor.path.raw_base64 &&
          (v.resolution === "Exact" || typeof v.resolution === "object");
        const caption = (
          <>
            {v.anchor.side === "Old" ? "Before" : "After"} · lines{" "}
            {range.start_line}–{range.end_line} · {label(v.resolution)}
          </>
        );
        return (
          <p className="quiet-note" key={i}>
            {canHighlight ? (
              <button
                className="anchor-link"
                title="Highlight explained block"
                onClick={() =>
                  workspace.explain(
                    v.anchor.side,
                    range.start_line,
                    range.end_line,
                  )
                }
              >
                {caption}
              </button>
            ) : (
              caption
            )}
          </p>
        );
      })}
      {!exact && (
        <>
          <p>
            Different snapshot pair. Review is available in the original
            comparison.
          </p>
          <button onClick={() => void workspace.openDecision(d.id)}>
            Open original version
          </button>
        </>
      )}
      <details>
        <summary>Details and checks</summary>
        <h4>Constraints</h4>
        {d.constraints.length ? (
          <ul>
            {d.constraints.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        ) : (
          <p>Not specified.</p>
        )}
        <h4>Alternatives considered</h4>
        {d.alternatives.length ? (
          d.alternatives.map((v, i) => (
            <p key={i}>
              <strong>{v.description}</strong>
              <br />
              {v.reason_not_chosen}
            </p>
          ))
        ) : (
          <p>The agent did not report alternatives.</p>
        )}
        <h4>Checks — agent reported</h4>
        {d.evidence.length ? (
          d.evidence.map((e, i) => (
            <p key={i}>
              <strong>
                {e.check} · {e.status}
              </strong>
              <br />
              {e.environment}
              <br />
              {e.summary}
            </p>
          ))
        ) : (
          <p>No evidence provided.</p>
        )}
        {d.supersedes && (
          <p>
            Supersedes decision {d.supersedes.slice(0, 8)}:{" "}
            {d.supersede_reason || "Reason not specified"}
          </p>
        )}
        {d.superseded_by && (
          <button onClick={() => void workspace.openDecision(d.superseded_by!)}>
            Open newer version
          </button>
        )}
      </details>
      {d.review && (
        <p>
          Your review:{" "}
          {
            {
              Viewed: "Viewed",
              Accepted: "Accepted",
              Question: "Question",
            }[d.review.state]
          }
          {d.review.note && ` — ${d.review.note}`}
        </p>
      )}
      {exact && !d.superseded_by && (
        <div className="human-review">
          <label>
            Comment
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2048}
            />
          </label>
          <div className="explanation-actions">
            <button
              onClick={() =>
                void workspace.reviewDecision(d.id, "Viewed", note)
              }
            >
              Viewed
            </button>
            <button
              onClick={() =>
                void workspace.reviewDecision(d.id, "Accepted", note)
              }
            >
              Accepted
            </button>
            <button
              onClick={() =>
                void workspace.reviewDecision(d.id, "Question", note)
              }
            >
              Question
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
