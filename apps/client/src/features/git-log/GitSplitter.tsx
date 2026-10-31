import React, { useRef } from "react";
export function GitSplitter({
  label,
  value,
  onChange,
  invert = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  invert?: boolean;
}) {
  const start = useRef({ x: 0, value });
  const change = (v: number) => onChange(Math.max(130, Math.min(700, v)));
  return (
    <div
      className="git-splitter"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={130}
      aria-valuemax={700}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          change(
            e.key === "Home"
              ? 130
              : e.key === "End"
                ? 700
                : value +
                  (e.key === "ArrowRight" ? 20 : -20) * (invert ? -1 : 1),
          );
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          change(
            start.current.value +
              (e.clientX - start.current.x) * (invert ? -1 : 1),
          );
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
