import { relationTokens } from "../relations/hoverModel";
import { ConstructDialog } from "./ConstructDialog";
import { resolveConstruct, type ConstructHelp } from "./language-help";
import { createPortal } from "react-dom";
import { Dialog } from "../commands/CommandUI";
import React, { useEffect, useRef, useState } from "react";
import { teachingModel, teachingDecorations } from "./teaching-overlays";
import { relationLenses } from "../relations/model";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  WidgetType,
  gutter,
  GutterMarker,
  lineNumbers,
  highlightActiveLineGutter,
  keymap,
} from "@codemirror/view";
import {
  syntaxHighlighting,
  HighlightStyle,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { defaultKeymap } from "@codemirror/commands";
import { MergeView, unifiedMergeView, Chunk } from "@codemirror/merge";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { csharp } from "@replit/codemirror-lang-csharp";
import { tags } from "@lezer/highlight";
import type { CodeTab, Workspace } from "../../workspace";
const savedPositions = new Map<
  string,
  { side: "Old" | "New"; anchor: number; head: number }
>();
export class RelationsWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly name: string,
    readonly open: () => void,
    readonly identity = "",
    readonly symbolId = "",
  ) {
    super();
  }
  eq(other: RelationsWidget) {
    return (
      this.identity === other.identity &&
      this.label === other.label &&
      this.name === other.name
    );
  }
  toDOM() {
    const b = document.createElement("button");
    b.className = "code-relations-lens";
    if (this.symbolId) b.dataset.symbolId = this.symbolId;
    b.textContent = this.label;
    b.setAttribute("aria-label", `Relations for ${this.name}: ${this.label}`);
    b.onclick = this.open;
    b.onmousedown = (event) => event.preventDefault();
    return b;
  }
  ignoreEvent() {
    return true;
  }
}
class ExplanationMarker extends GutterMarker {
  constructor(
    readonly summary: string,
    readonly open: () => void,
  ) {
    super();
  }
  toDOM() {
    const b = document.createElement("button");
    b.textContent = "●";
    // CodeMirror gutters are aria-hidden; keyboard users use selection + Explain.
    b.tabIndex = -1;
    b.title = this.summary;
    b.setAttribute("aria-label", `Explanation: ${this.summary}`);
    b.className = "code-explanation-marker";
    b.onclick = this.open;
    return b;
  }
}
const syntax = HighlightStyle.define([
  { tag: tags.keyword, color: "#fe8019" },
  { tag: tags.typeName, color: "#fabd2f" },
  { tag: [tags.string, tags.function(tags.variableName)], color: "#b8bb26" },
  { tag: tags.propertyName, color: "#8ec07c" },
  { tag: tags.variableName, color: "#83a598" },
  { tag: [tags.number, tags.bool, tags.null], color: "#d3869b" },
  { tag: tags.comment, color: "#a89984" },
]);
const lightSyntax = HighlightStyle.define([
  { tag: tags.keyword, color: "#9d3000" },
  { tag: tags.typeName, color: "#775400" },
  { tag: [tags.string, tags.function(tags.variableName)], color: "#426000" },
  { tag: tags.number, color: "#84407f" },
  { tag: tags.comment, color: "#645c50" },
]);
export function CodeReader({
  tab,
  workspace,
  view,
  light,
  ignoreWhitespace,
  showDeleted,
  actionsHost,
}: {
  tab: CodeTab;
  workspace: Workspace;
  view: "unified" | "split";
  light: boolean;
  ignoreWhitespace: boolean;
  showDeleted: boolean;
  actionsHost?: HTMLElement | null;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const markerEditors = useRef<
    {
      view: EditorView;
      side: "Old" | "New";
      compartment: Compartment;
      teaching: Compartment;
      relations: Compartment;
    }[]
  >([]);
  const selected = useRef<{ side: "Old" | "New"; start: number; end: number }>({
    side: "New",
    start: 1,
    end: 1,
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const [construct, setConstruct] = useState<{
    help: ConstructHelp;
    location: string;
    side: "Old" | "New";
  } | null>(null);
  const showConstruct = (
    sourceView?: EditorView,
    sourceSide?: "Old" | "New",
  ) => {
    const side = sourceSide ?? selected.current.side;
    const v =
      sourceView ??
      markerEditors.current.find((e) => e.side === side)?.view ??
      editor.current;
    if (!v) return;
    const snapshot = side === "Old" ? tab.data.base.id : tab.data.target.id;
    setConstruct({
      side,
      help: resolveConstruct(
        tab.path.display,
        v.state.doc.toString(),
        v.state.selection.main.from,
      ),
      location: `${tab.path.display} · ${side} · Snapshot ${snapshot.slice(0, 8)}`,
    });
    setActionsOpen(false);
  };
  useEffect(() => {
    setConstruct(null);
  }, [tab.id, tab.data.comparison.id]);
  const [line, setLine] = useState("1");
  useEffect(() => {
    if (!parent.current) return;
    const a = tab.data.base.files.find(
        (f) => f.path.raw_base64 === tab.path.raw_base64,
      )!,
      b = tab.data.target.files.find(
        (f) => f.path.raw_base64 === tab.path.raw_base64,
      )!;
    const decode = (bytes: number[]) => {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(bytes),
      );
      return ignoreWhitespace ? text.replace(/[ \t]+$/gm, "") : text;
    };
    const lang = tab.path.display.endsWith(".cs")
      ? csharp()
      : tab.path.display.endsWith(".py")
        ? python()
        : /\.[cm]?[jt]sx?$/.test(tab.path.display)
          ? javascript({ typescript: true, jsx: true })
          : [];
    const positionKey = JSON.stringify([tab.id, tab.data.comparison.id]);
    const compartments = { Old: new Compartment(), New: new Compartment() };
    const teaching = { Old: new Compartment(), New: new Compartment() };
    const relations = { Old: new Compartment(), New: new Compartment() };
    const extension = (side: "Old" | "New") => [
      compartments[side].of([]),
      teaching[side].of([]),
      relations[side].of([]),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({
        "aria-label": side === "Old" ? "Old code version" : "New code version",
        tabindex: "0",
      }),
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      lang,
      search({ top: true }),
      keymap.of([
        {
          key: "Mod-Shift-k",
          run: (v) => {
            showConstruct(v, side);
            return true;
          },
        },
        ...searchKeymap,
        ...foldKeymap,
        ...defaultKeymap,
      ]),
      syntaxHighlighting(light ? lightSyntax : syntax),
      EditorView.theme(
        {
          "&": {
            height: "100%",
            backgroundColor: light ? "#fbf1c7" : "#1d2021",
            color: light ? "#3c3836" : "#ebdbb2",
            fontSize: "var(--code-size)",
            lineHeight: "1.4",
          },
          ".cm-scroller": { fontFamily: "Monaco, monospace", overflow: "auto" },
          ".cm-gutters": {
            backgroundColor: light ? "#eee4bb" : "#242727",
            color: light ? "#645c50" : "#bdae93",
            border: "none",
          },
          ".cm-line": { padding: "0 12px" },
          ".cm-content": { padding: "8px 0" },
          ".cm-cursor": { borderLeftColor: "#fabd2f" },
          ".cm-selectionBackground": {
            backgroundColor: light
              ? "#d5c4a1 !important"
              : "#504945 !important",
          },
        },
        { dark: !light },
      ),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || (u.focusChanged && u.view.hasFocus)) {
          const s = u.state.selection.main;
          savedPositions.set(positionKey, {
            side,
            anchor: s.anchor,
            head: s.head,
          });
          if (savedPositions.size > 64)
            savedPositions.delete(savedPositions.keys().next().value!);
          selected.current = {
            side,
            start: u.state.doc.lineAt(s.from).number,
            end: u.state.doc.lineAt(s.to).number,
          };
        }
      }),
    ];
    let cleanup: () => void;
    let views: EditorView[];
    if (view === "split") {
      const merge = new MergeView({
        a: { doc: decode(a.bytes), extensions: extension("Old") },
        b: { doc: decode(b.bytes), extensions: extension("New") },
        parent: parent.current,
        highlightChanges: true,
        gutter: true,
      });
      views = [merge.a, merge.b];
      markerEditors.current = [
        {
          view: merge.a,
          side: "Old",
          compartment: compartments.Old,
          teaching: teaching.Old,
          relations: relations.Old,
        },
        {
          view: merge.b,
          side: "New",
          compartment: compartments.New,
          teaching: teaching.New,
          relations: relations.New,
        },
      ];
      editor.current = b.state === "Absent" ? merge.a : merge.b;
      cleanup = () => merge.destroy();
    } else {
      const removed = b.state === "Absent";
      const v = new EditorView({
        doc: decode(removed ? a.bytes : b.bytes),
        extensions: [
          ...extension(removed ? "Old" : "New"),
          ...(removed
            ? []
            : [
                unifiedMergeView({
                  original: decode(a.bytes),
                  gutter: true,
                  highlightChanges: true,
                  syntaxHighlightDeletions: true,
                  mergeControls: false,
                  allowInlineDiffs: false,
                }),
              ]),
        ],
        parent: parent.current,
      });
      views = [v];
      markerEditors.current = [
        {
          view: v,
          side: removed ? "Old" : "New",
          compartment: removed ? compartments.Old : compartments.New,
          teaching: removed ? teaching.Old : teaching.New,
          relations: removed ? relations.Old : relations.New,
        },
      ];
      editor.current = v;
      cleanup = () => v.destroy();
    }
    selected.current = {
      side: b.state === "Absent" ? "Old" : "New",
      start: 1,
      end: 1,
    };
    const saved = savedPositions.get(positionKey);
    const savedEditor = markerEditors.current.find(
      (e) => e.side === saved?.side,
    )?.view;
    if (saved && savedEditor)
      savedEditor.dispatch({
        selection: {
          anchor: Math.min(saved.anchor, savedEditor.state.doc.length),
          head: Math.min(saved.head, savedEditor.state.doc.length),
        },
      });
    const restore = requestAnimationFrame(() =>
      views.forEach((v) => {
        v.scrollDOM.scrollTop = tab.scroll;
        v.requestMeasure();
      }),
    );
    const onscroll = () => {
      if (editor.current)
        workspace.setScroll(tab.id, editor.current.scrollDOM.scrollTop);
    };
    views.forEach((v) => v.scrollDOM.addEventListener("scroll", onscroll));
    return () => {
      cancelAnimationFrame(restore);
      views.forEach((v) => v.scrollDOM.removeEventListener("scroll", onscroll));
      cleanup();
      editor.current = null;
      markerEditors.current = [];
    };
  }, [tab.data, view, light, ignoreWhitespace]);
  useEffect(() => {
    const target = workspace.state.recordedLocation;
    if (
      !target ||
      target.comparisonId !== tab.data.comparison.id ||
      target.path.raw_base64 !== tab.path.raw_base64
    )
      return;
    const v = markerEditors.current.find(
      (entry) => entry.side === target.side,
    )?.view;
    if (!v) return;
    const start = v.state.doc.line(
      Math.min(v.state.doc.lines, target.startLine),
    );
    const end = v.state.doc.line(Math.min(v.state.doc.lines, target.endLine));
    const reveal = requestAnimationFrame(() =>
      v.dispatch({
        selection: { anchor: start.from, head: end.to },
        effects: EditorView.scrollIntoView(start.from, { y: "center" }),
      }),
    );
    return () => cancelAnimationFrame(reveal);
  }, [workspace.state.recordedLocation, tab.data, view]);
  useEffect(() => {
    const selected = workspace.state.learningLocation;
    const v = editor.current;
    if (
      !selected ||
      !v ||
      selected.snapshotId !== tab.data.target.id ||
      selected.location.path.raw_base64 !== tab.path.raw_base64
    )
      return;
    const line = v.state.doc.line(
      Math.min(v.state.doc.lines, selected.location.line),
    );
    v.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }, [workspace.state.learningLocation, tab.data, view]);
  useEffect(() => {
    for (const { view: editor, side, compartment } of markerEditors.current) {
      const markers = new Map<number, { summary: string; end: number }>();
      for (const decision of workspace.state.explanations) {
        if (decision.superseded_by) continue;
        for (const { anchor, resolution } of decision.anchors) {
          if (
            anchor.side !== side ||
            anchor.path.raw_base64 !== tab.path.raw_base64
          )
            continue;
          if (resolution !== "Exact" && typeof resolution !== "object")
            continue;
          const start =
            typeof resolution === "object"
              ? resolution.Relocated.start_line
              : anchor.start_line;
          const end =
            typeof resolution === "object"
              ? resolution.Relocated.end_line
              : anchor.end_line;
          markers.set(start, {
            summary: `${decision.summary}${resolution === "Exact" ? "" : " (relocated anchor)"}`,
            end,
          });
        }
      }
      editor.dispatch({
        effects: compartment.reconfigure(
          gutter({
            class: "explanation-gutter",
            lineMarker(v, line) {
              const number = v.state.doc.lineAt(line.from).number,
                m = markers.get(number);
              return m
                ? new ExplanationMarker(m.summary, () =>
                    workspace.explain(side, number, m.end),
                  )
                : null;
            },
          }),
        ),
      });
    }
  }, [workspace.state.explanations, tab.data, view, light, ignoreWhitespace]);
  useEffect(() => {
    for (const entry of markerEditors.current) {
      entry.view.dispatch({
        effects: entry.teaching.reconfigure(
          EditorView.decorations.of(
            teachingDecorations(
              entry.view.state,
              teachingModel(workspace, tab, entry.side),
            ),
          ),
        ),
      });
    }
  }, [
    workspace.state.selection,
    workspace.state.explanationOpen,
    workspace.state.learningMode,
    workspace.state.learningLocation,
    workspace.state.learningRecord,
    workspace.state.traceStep,
    workspace.state.traceFrame,
    workspace.state.tracePreviousStep,
    tab.data,
    view,
    light,
    ignoreWhitespace,
  ]);
  useEffect(() => {
    void workspace.loadRelations(false);
  }, [workspace, tab.id, tab.data.target.id]);
  useEffect(() => {
    const r = workspace.state.relations;
    const report =
      r?.report?.origin_snapshot_id === tab.data.target.id ? r.report : null;
    for (const entry of markerEditors.current) {
      const marks =
        entry.side === "New"
          ? relationLenses(report, tab.path, tab)
              .filter((l) => l.line > 0 && l.line <= entry.view.state.doc.lines)
              .map((l) =>
                Decoration.widget({
                  widget: new RelationsWidget(
                    l.label,
                    l.name,
                    () => workspace.showRelations(true, l.symbolId),
                    `${report!.origin_snapshot_id}:${l.symbolId}`,
                    l.symbolId,
                  ),
                  block: true,
                  side: -1,
                }).range(entry.view.state.doc.line(l.line).from),
              )
          : [];
      if (entry.side === "New" && report) {
        for (const token of relationTokens(
          report,
          tab.path,
          entry.view.state.doc.toString(),
        ))
          marks.push(
            Decoration.mark({
              class: "relation-token",
              attributes: { "data-symbol-id": token.id },
            }).range(token.from, token.to),
          );
      }
      entry.view.dispatch({
        effects: entry.relations.reconfigure(
          EditorView.decorations.of(Decoration.set(marks, true)),
        ),
      });
    }
  }, [workspace.state.relations, tab.data, view, light, ignoreWhitespace]);
  useEffect(() => {
    const target = workspace.state.relationLocation,
      v = editor.current;
    if (
      !target ||
      !v ||
      target.snapshotId !== tab.data.target.id ||
      target.path.raw_base64 !== tab.path.raw_base64
    )
      return;
    const line = v.state.doc.line(Math.min(v.state.doc.lines, target.line));
    const pos = Math.min(line.to, line.from + Math.max(0, target.column - 1));
    v.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    v.focus();
  }, [workspace.state.relationLocation, tab.data, view]);
  const file = tab.data.target.files.find(
    (f) => f.path.raw_base64 === tab.path.raw_base64,
  )!;
  const old = tab.data.base.files.find(
    (f) => f.path.raw_base64 === tab.path.raw_base64,
  )!;
  if (file.state === "Conflicted" || old.state === "Conflicted")
    return (
      <div className="conflict">
        <h3>Merge conflict</h3>
        <p>
          The Index contains multiple versions. Resolve this conflict in your
          IDE.
        </p>
        {[...old.stages, ...file.stages].map((s, i) => (
          <details key={i}>
            <summary>
              Stage {s.stage} · {s.oid.slice(0, 8)}
            </summary>
            <pre>{new TextDecoder().decode(new Uint8Array(s.bytes))}</pre>
          </details>
        ))}
      </div>
    );
  const canStage =
    !tab.stale &&
    ((tab.base === "Index" && tab.target === "Worktree") ||
      (tab.base === "Head" && tab.target === "Index"));
  const selectionLines = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const prepareHunk = () => {
    const a = EditorState.create({
      doc: new TextDecoder().decode(new Uint8Array(old.bytes)),
    }).doc;
    const b = EditorState.create({
      doc: new TextDecoder().decode(new Uint8Array(file.bytes)),
    }).doc;
    const side = selected.current.side;
    const doc = side === "Old" ? a : b;
    const pos = doc.line(Math.min(doc.lines, selected.current.start)).from;
    const chunks = Chunk.build(a, b);
    const c = chunks.find((c) =>
      side === "Old"
        ? pos >= c.fromA && pos <= c.toA
        : pos >= c.fromB && pos <= c.toB,
    );
    if (!c) {
      workspace.error({ code: "SELECT_CHANGED_BLOCK" });
      return;
    }
    const lines = (d: typeof a, from: number, to: number) =>
      from >= to || from >= d.length
        ? []
        : selectionLines(
            d.lineAt(Math.min(from, d.length)).number,
            d.lineAt(Math.min(to - 1, d.length - 1)).number,
          );
    void workspace.prepareSelection(
      lines(a, c.fromA, c.toA),
      lines(b, c.fromB, c.toB),
    );
  };
  const actions = (
    <div className="reader-actions">
      {workspace.state.relationBack && (
        <button
          onClick={() => workspace.backFromRelations()}
          title="Return to the original code and selection"
        >
          ← Back
        </button>
      )}
      <button onClick={() => setActionsOpen(true)}>Code actions</button>{" "}
      <button
        className="explain-button"
        onClick={() =>
          workspace.explain(
            selected.current.side,
            selected.current.start,
            selected.current.end,
          )
        }
      >
        Explain selection
      </button>
    </div>
  );
  return (
    <div
      className="reader"
      onContextMenu={(e) => {
        e.preventDefault();
        setActionsOpen(true);
      }}
    >
      {actionsHost ? createPortal(actions, actionsHost) : actions}
      {construct && (
        <ConstructDialog
          help={construct.help}
          location={construct.location}
          onClose={() => {
            setConstruct(null);
            (
              markerEditors.current.find((e) => e.side === construct.side)
                ?.view ?? editor.current
            )?.focus();
          }}
        />
      )}
      {actionsOpen && (
        <Dialog title="Code actions" onClose={() => setActionsOpen(false)}>
          <div className="editor-settings">
            <button onClick={() => showConstruct()}>
              Explain language construct… ⌘⇧K
            </button>
            <button
              onClick={() => {
                setActionsOpen(false);
                void workspace.loadRelations(true);
              }}
            >
              Usages and relationships…
            </button>{" "}
            {canStage && (
              <>
                <button
                  onClick={() => {
                    const s = selected.current;
                    const lines = selectionLines(s.start, s.end);
                    setActionsOpen(false);
                    void workspace.prepareSelection(
                      s.side === "Old" ? lines : [],
                      s.side === "New" ? lines : [],
                    );
                  }}
                >
                  Selected lines → Index…
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    prepareHunk();
                  }}
                >
                  Hunk at cursor → Index…
                </button>
              </>
            )}
            <button
              onClick={() => {
                setActionsOpen(false);
                if (editor.current) openSearchPanel(editor.current);
              }}
            >
              Search code ⌘F
            </button>
            <label>
              Line{" "}
              <input
                aria-label="Go to line"
                type="number"
                min="1"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editor.current) {
                    const v = editor.current;
                    const n = Math.max(
                      1,
                      Math.min(v.state.doc.lines, Number(line) || 1),
                    );
                    v.dispatch({
                      selection: { anchor: v.state.doc.line(n).from },
                      effects: EditorView.scrollIntoView(
                        v.state.doc.line(n).from,
                        {
                          y: "center",
                        },
                      ),
                    });
                    setActionsOpen(false);
                    v.focus();
                  }
                }}
              />
            </label>
          </div>
        </Dialog>
      )}
      {file.state === "Absent" && (
        <div className="deleted-label">File deleted</div>
      )}
      <div
        className={"editor-mount " + (!showDeleted ? "hide-deleted" : "")}
        ref={parent}
      />
    </div>
  );
}
