import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
export function AgentConnection({
  root,
  hiddenTrigger = false,
}: {
  root: string;
  hiddenTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<{
      config: unknown;
      guide: string;
      http: string;
    } | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState("");
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("agai-dismiss-overlays", close);
    return () => window.removeEventListener("agai-dismiss-overlays", close);
  }, []);
  async function load() {
    setOpen(true);
    setError("");
    setData(null);
    try {
      setData(await invoke("integration_config", { repo: root }));
    } catch (e) {
      setError(String(e));
    }
  }
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setError("Could not copy text");
    }
  }
  return (
    <>
      <button
        data-agent-connect
        hidden={hiddenTrigger}
        disabled={!root}
        onClick={() => void load()}
      >
        Connect MCP
      </button>
      {open && (
        <div
          className="agent-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Agent connection"
        >
          <header>
            <h2>Connect an agent</h2>
            <button
              aria-label="Close connection"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <p>
            Add this server to your IDE or harness MCP settings. The application
            must stay open.
          </p>
          {error && <p role="alert">{error}</p>}
          {!data && !error && <p>Checking the local host…</p>}
          {data && (
            <>
              <p role="status">
                Local host is ready. The configuration below uses generic
                mcpServers; setting names may vary between clients.
              </p>
              <pre>{JSON.stringify(data.config, null, 2)}</pre>
              <button
                onClick={() =>
                  void copy(
                    JSON.stringify(data.config, null, 2),
                    "Configuration copied",
                  )
                }
              >
                Copy configuration
              </button>
              <h3>Agent instructions</h3>
              <p>{data.guide}</p>
              <button
                onClick={() => void copy(data.guide, "Instructions copied")}
              >
                Copy instructions
              </button>
              <details>
                <summary>Streamable HTTP</summary>
                <p>{data.http}</p>
              </details>
              <p>{copied}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
