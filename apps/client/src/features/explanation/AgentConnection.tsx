import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
export function AgentConnection({ root }: { root: string }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<{
      config: unknown;
      guide: string;
      http: string;
    } | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState("");
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
      setError("Не удалось скопировать текст");
    }
  }
  return (
    <>
      <button disabled={!root} onClick={() => void load()}>
        Подключить MCP
      </button>
      {open && (
        <div
          className="agent-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Подключение агента"
        >
          <header>
            <h2>Подключить агента</h2>
            <button
              aria-label="Закрыть подключение"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <p>
            Добавьте сервер в настройки MCP вашей IDE или harness. Приложение
            должно оставаться открытым.
          </p>
          {error && <p role="alert">{error}</p>}
          {!data && !error && <p>Проверяем локальный host…</p>}
          {data && (
            <>
              <p role="status">
                Локальный host отвечает. Формат ниже — generic mcpServers;
                названия полей настроек зависят от клиента.
              </p>
              <pre>{JSON.stringify(data.config, null, 2)}</pre>
              <button
                onClick={() =>
                  void copy(
                    JSON.stringify(data.config, null, 2),
                    "Конфигурация скопирована",
                  )
                }
              >
                Скопировать конфигурацию
              </button>
              <h3>Инструкция агенту</h3>
              <p>{data.guide}</p>
              <button
                onClick={() => void copy(data.guide, "Инструкция скопирована")}
              >
                Скопировать инструкцию
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
