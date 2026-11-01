import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "../../workspace";
import type { PanelSettings } from "../layout/sync";
import { SessionController } from "./session";

export function useWorkspaceSession(
  w: Workspace,
  enabled: boolean,
  settings: PanelSettings,
  apply: (v: PanelSettings) => void,
) {
  const controller = useMemo(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {}
    return new SessionController(w, storage);
  }, [w]);
  const latest = useRef({ settings, apply });
  latest.current = { settings, apply };
  const [restoring, setRestoring] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const promise = controller.restore((v) => latest.current.apply(v));
    setRestoring(controller.restoring);
    const save = () => controller.save(latest.current.settings);
    const unsubscribe = w.subscribe(save);
    const timer = setInterval(save, 500); // Includes scroll positions without republishing editor state.
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    void promise.then((result) => {
      if (disposed) return;
      setRestoring(false);
      setWarnings(result.warnings);
      save();
    });
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
      save();
    };
  }, [controller, enabled, w]);
  return {
    restoring,
    warnings,
    cancel: () => {
      controller.cancel();
      setRestoring(false);
    },
    dismiss: () => setWarnings([]),
  };
}
