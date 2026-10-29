import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/app";
import type { WorkspaceApi } from "../src/workspace";
const send = async (key: string, value: unknown) => {
  const r = await fetch("/test-rpc", {
    method: "POST",
    body: JSON.stringify({
      meta: {
        schema_version: 1,
        request_id: crypto.randomUUID(),
        idempotency_key: null,
      },
      [key]: value,
    }),
  });
  const data = await r.json();
  if (data.Err) throw data.Err;
  return data.Ok;
};
const api: WorkspaceApi = {
  read: (r) => send("request", r),
  desktop: (r) => send("desktop", r),
};
createRoot(document.getElementById("root")!).render(<App api={api} />);
