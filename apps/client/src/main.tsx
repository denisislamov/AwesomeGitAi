import React from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { App } from "./app";
import type { WorkspaceApi } from "./workspace";
import type {
  AppError,
  ReadResponse,
  DesktopResponse,
} from "../../../packages/api/src/generated";
async function request<T>(command: string, envelope: unknown): Promise<T> {
  const result = await invoke<{ Ok: T } | { Err: AppError }>(command, {
    envelope,
  });
  if ("Err" in result) throw result.Err;
  return result.Ok;
}
const meta = () => ({
  schema_version: 1,
  request_id: crypto.randomUUID(),
  idempotency_key: null,
});
const api: WorkspaceApi = {
  read: (r) => request<ReadResponse>("host_read", { meta: meta(), request: r }),
  desktop: (r) =>
    request<DesktopResponse>("host_desktop", { meta: meta(), desktop: r }),
};
if (!new URLSearchParams(window.location.search).has("panel"))
  listen<string>("workspace-command", (event) => {
    window.dispatchEvent(
      new CustomEvent("agai-command", { detail: event.payload }),
    );
  }).catch((error) => console.error("Native menu listener failed", error));
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App
      api={api}
      openExternal={(root, path, target) =>
        invoke("open_external", { root, path, target })
      }
    />
  </React.StrictMode>,
);
