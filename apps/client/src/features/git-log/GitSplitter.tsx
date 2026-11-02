import React, { useRef } from "react";
export function GitSplitter({
  label,
  value,
  onChange,
  invert = false,
  axis = "x",
  min = 130,
  max = 700,
  step = 20,
  relative = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  invert?: boolean;
  axis?: "x" | "y";
  min?: number;
  max?: number;
  step?: number;
  relative?: boolean;
}) {
  const start = useRef({ position: 0, value, scale: 1 });
  const change = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div
      className={`git-splitter ${axis === "y" ? "horizontal" : "vertical"}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={(e) => {
        const back = axis === "y" ? "ArrowUp" : "ArrowLeft";
        const forward = axis === "y" ? "ArrowDown" : "ArrowRight";
        if ([back, forward, "Home", "End"].includes(e.key)) {
          e.preventDefault();
          change(
            e.key === "Home"
              ? min
              : e.key === "End"
                ? max
                : value +
                  (e.key === forward ? step : -step) * (invert ? -1 : 1),
          );
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
        start.current = {
          position: axis === "y" ? e.clientY : e.clientX,
          value,
          scale: relative
            ? 100 / Math.max(1, axis === "y" ? rect.height : rect.width)
            : 1,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          change(
            start.current.value +
              ((axis === "y" ? e.clientY : e.clientX) -
                start.current.position) *
                start.current.scale *
                (invert ? -1 : 1),
          );
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
