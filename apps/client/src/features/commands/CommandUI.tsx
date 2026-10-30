import React, { useEffect, useRef, useState } from "react";
export function Dialog({
  title,
  onClose,
  children,
  error,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const focusable = () =>
      [
        ...node.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        ),
      ].filter((el) => {
        if (
          el.matches(":disabled") ||
          el.closest('[hidden],[aria-hidden="true"]')
        )
          return false;
        for (
          let ancestor: HTMLElement | null = el;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden")
            return false;
        }
        return true;
      });
    (
      focusable().find((el) => el.tagName === "INPUT") ??
      focusable()[0] ??
      node
    ).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const dismiss = () => onClose();
    window.addEventListener("agai-dismiss-overlays", dismiss);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("agai-dismiss-overlays", dismiss);
      window.removeEventListener("keydown", key, true);
      if (
        node.contains(document.activeElement) ||
        document.activeElement === document.body
      )
        previous?.focus();
    };
  }, []);
  return (
    <div
      className="command-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <strong>{title}</strong>
          <button aria-label={`Close ${title}`} onClick={onClose}>
            ×
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {children}
      </div>
    </div>
  );
}
export function CommandMenu({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="command-menu" ref={ref}>
      <button
        aria-label={`${label} menu`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div
          className="command-menu-items"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
