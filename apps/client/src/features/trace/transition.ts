import type {
  TraceScenario,
  TraceFrame,
} from "../../../../../packages/api/src/generated";
export type StepAction = "next" | "over" | "into" | "out";
export function validateTrace(t: TraceScenario) {
  if (
    !t.steps.length ||
    t.steps.length > 1000 ||
    t.entry_step !== t.steps[0].id
  )
    throw Error("INVALID_TRACE");
  const ids = new Set<string>();
  for (let i = 0; i < t.steps.length; i++) {
    const s = t.steps[i],
      next = t.steps[i + 1],
      rest = t.steps.slice(i + 1),
      depth = s.frames.length;
    if (
      ids.has(s.id) ||
      s.next !== (next?.id ?? null) ||
      s.over !== (rest.find((n) => n.frames.length <= depth)?.id ?? null) ||
      s.out !== (rest.find((n) => n.frames.length < depth)?.id ?? null) ||
      s.into !== ((next?.frames.length ?? 0) > depth ? next.id : null)
    )
      throw Error("INVALID_TRACE");
    ids.add(s.id);
    if (
      next &&
      (depth === 0 ||
        next.frames.length > depth + 1 ||
        s.frames
          .slice(0, next.frames.length)
          .some((f, j) => f.id !== next.frames[j].id))
    )
      throw Error("INVALID_TRACE");
    if (
      !next &&
      s.phase !== "Unknown" &&
      (s.frames.length || s.phase !== "Return" || !s.result)
    )
      throw Error("INVALID_TRACE");
  }
}
export function transition(t: TraceScenario, id: string, action: StepAction) {
  const s = t.steps.find((s) => s.id === id);
  if (!s) throw Error("INVALID_TRACE_STEP");
  return s[action] ?? id;
}
export function selectFrame(
  t: TraceScenario,
  state: { step: string; frame: string | null },
  frame: string,
) {
  if (
    !t.steps
      .find((s) => s.id === state.step)
      ?.frames.some((f) => f.id === frame)
  )
    throw Error("INVALID_FRAME");
  return { ...state, frame };
}
export function variableChanges(current: TraceFrame, previous?: TraceFrame) {
  return current.locals
    .filter((v) => {
      const old =
        previous?.id === current.id
          ? previous.locals.find((x) => x.name === v.name)
          : undefined;
      return (
        !!old &&
        (old.value !== v.value ||
          old.type_name !== v.type_name ||
          old.known !== v.known)
      );
    })
    .map((v) => v.name);
}
