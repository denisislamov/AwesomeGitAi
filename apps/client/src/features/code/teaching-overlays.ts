import { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import type { CodeTab, Workspace } from "../../workspace";
import type { TraceValue } from "../../../../../packages/api/src/generated";
export type TeachingModel = {
  range: { start: number; end: number } | null;
  trace: {
    line: number;
    phase: string;
    values: TraceValue[];
    previous: TraceValue[];
  } | null;
};
export function teachingModel(
  w: Workspace,
  tab: CodeTab,
  side: "Old" | "New",
): TeachingModel {
  const s = w.state,
    selected = s.selection,
    snapshot = side === "Old" ? tab.data.base.id : tab.data.target.id;
  const range =
    s.learningMode === "explanation" &&
    s.explanationOpen &&
    selected?.comparisonId === tab.data.comparison.id &&
    selected.snapshotId === snapshot &&
    selected.path.raw_base64 === tab.path.raw_base64 &&
    selected.side === side
      ? { start: selected.startLine, end: selected.endLine }
      : null;
  const record = s.learningRecord,
    step = record?.trace?.steps.find((x) => x.id === s.traceStep),
    frame =
      step?.frames.find((f) => f.id === s.traceFrame) ?? step?.frames.at(-1),
    location = s.learningLocation;
  if (
    s.learningMode !== "trace" ||
    side !== "New" ||
    !step ||
    !frame ||
    !location ||
    step.phase === "Unknown" ||
    record?.item.snapshot_id !== snapshot ||
    location.snapshotId !== snapshot ||
    frame.location.path.raw_base64 !== tab.path.raw_base64 ||
    location.location.path.raw_base64 !== tab.path.raw_base64 ||
    frame.location.line !== location.location.line
  )
    return { range, trace: null };
  const previous =
    record?.trace?.steps
      .find((x) => x.id === s.tracePreviousStep)
      ?.frames.find((f) => f.id === frame.id)?.locals ?? [];
  return {
    range,
    trace: {
      line: frame.location.line,
      phase: step.phase,
      values: frame.locals,
      previous,
    },
  };
}
export type InlineValue = {
  name: string;
  pos: number;
  value: string;
  title: string;
  changed: boolean;
};
export function inlineValues(
  state: EditorState,
  lineNumber: number,
  values: TraceValue[],
  previous: TraceValue[],
): InlineValue[] {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return [];
  const line = state.doc.line(lineNumber),
    tree = ensureSyntaxTree(state, line.to, 30),
    result: InlineValue[] = [],
    seen = new Set<string>();
  // Without a parsed language tree, do not guess which text is executable code.
  if (!tree || !tree.topNode.firstChild) return [];
  for (const match of line.text.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
    const name = match[0],
      from = line.from + match.index!,
      value = values.find((v) => v.name === name);
    if (!value || seen.has(name)) continue;
    let node = tree.resolveInner(from, 1),
      excluded = false;
    for (let n: typeof node | null = node; n; n = n.parent)
      if (/comment|string|char|literal/i.test(n.name)) {
        excluded = true;
        break;
      }
    const prefix = line.text.slice(0, match.index!);
    if (excluded || /\.\s*$/.test(prefix)) continue;
    // Values are supplied for this frame and line, not a project-wide name match.
    const old = previous.find((v) => v.name === name),
      display = value.known ? value.value : "Unknown",
      before = old ? (old.known ? old.value : "Unknown") : null;
    result.push({
      name,
      pos: from + name.length,
      value: display,
      title: `Simulation · ${name}: ${value.type_name} · ${before !== null && before !== display ? before + " → " : ""}${display}`,
      changed: before !== null && before !== display,
    });
    seen.add(name);
    if (result.length === 4) break;
  }
  return result;
}
class ValueWidget extends WidgetType {
  constructor(readonly hint: InlineValue) {
    super();
  }
  eq(other: ValueWidget) {
    return (
      this.hint.title === other.hint.title && this.hint.pos === other.hint.pos
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className =
      "cm-recorded-value" + (this.hint.changed ? " changed" : "");
    span.textContent = ` = ${this.hint.value.length > 40 ? this.hint.value.slice(0, 37) + "…" : this.hint.value}`;
    span.title = this.hint.title;
    span.setAttribute("aria-label", this.hint.title);
    return span;
  }
  ignoreEvent() {
    return true;
  }
}
class TraceSourceWidget extends WidgetType {
  constructor(readonly phase: string) {
    super();
  }
  eq(other: TraceSourceWidget) {
    return this.phase === other.phase;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-trace-source";
    span.textContent = `${this.phase} · simulation`;
    span.title = "Recorded educational values, not live execution";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}
export function teachingDecorations(state: EditorState, model: TeachingModel) {
  const marks = [];
  if (model.range) {
    const start = Math.max(1, model.range.start),
      end = Math.min(state.doc.lines, model.range.end);
    for (let n = start; n <= end; n++)
      marks.push(
        Decoration.line({
          attributes: {
            class:
              "cm-explained-line" +
              (n === start ? " cm-explained-start" : "") +
              (n === end ? " cm-explained-end" : ""),
            "data-explained": "true",
          },
        }).range(state.doc.line(n).from),
      );
  }
  if (
    model.trace &&
    model.trace.line > 0 &&
    model.trace.line <= state.doc.lines
  ) {
    const t = model.trace;
    marks.push(
      Decoration.line({
        attributes: {
          class: "cm-trace-line",
          "data-trace-phase": t.phase,
          title: `Simulation · ${t.phase} this line`,
        },
      }).range(state.doc.line(t.line).from),
    );
    marks.push(
      Decoration.widget({
        widget: new TraceSourceWidget(t.phase),
        side: 2,
      }).range(state.doc.line(t.line).to),
    );
    for (const hint of inlineValues(state, t.line, t.values, t.previous))
      marks.push(
        Decoration.widget({ widget: new ValueWidget(hint), side: 1 }).range(
          hint.pos,
        ),
      );
  }
  return Decoration.set(marks, true);
}
