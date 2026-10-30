import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DesktopRequest } from "../../../../../packages/api/src/generated";
import type { Workspace } from "../../workspace";
import { Dialog } from "../commands/CommandUI";
import "./memory.css";

type Item = {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  external: boolean;
};
type Catalog = {
  truncated?: boolean;
  total_records?: number;
  total_snapshots?: number;
  records: Item[];
  snapshots: { id: string; label: string; file_count: number }[];
};
type Search = {
  items: Item[];
  next_offset: number | null;
  history_path?: string;
};
type Preview = { hash: string; preview: unknown; [key: string]: unknown };
const text = (value: unknown): string =>
  value == null
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
const content = (item: Item): Record<string, unknown> => {
  let data = item.data;
  for (
    let depth = 0;
    item.external &&
    depth < 8 &&
    data.source &&
    typeof data.source === "object" &&
    !Array.isArray(data.source);
    depth++
  )
    data = data.source as Record<string, unknown>;
  return data;
};
const title = (item: Item) =>
  text(content(item).summary ?? content(item).title ?? item.id);

export function MemoryDialog({
  workspace,
  onClose,
  onErased,
}: {
  workspace: Workspace;
  onClose: () => void;
  onErased?: () => void;
}) {
  const state = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  );
  const key = JSON.stringify([state.repo?.repo_id, state.repo?.worktree_id]);
  return (
    <Dialog title="Project memory" onClose={onClose}>
      <MemoryContent key={key} workspace={workspace} onErased={onErased} />
    </Dialog>
  );
}
function MemoryContent({
  workspace,
  onErased,
}: {
  workspace: Workspace;
  onErased?: () => void;
}) {
  const scope = workspace.state.repo ? workspace.scope() : null;
  const scopeKey = JSON.stringify(scope);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const erasing = useRef(false);
  const [section, setSection] = useState("Search");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limitations, setLimitations] = useState<string[]>([]);
  const [filters, setFilters] = useState({
    query: "",
    actor: "",
    task_id: "",
    snapshot_id: "",
    path: "",
  });
  const appliedFilters = useRef(filters);
  const [source, setSource] = useState("all");
  const [results, setResults] = useState<Search>({
    items: [],
    next_offset: null,
  });
  const [catalog, setCatalog] = useState<Catalog>({
    records: [],
    snapshots: [],
  });
  const [records, setRecords] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [inspection, setInspection] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const sameScope = () =>
    !!workspace.state.repo && JSON.stringify(workspace.scope()) === scopeKey;
  const valid = () => mounted.current && sameScope();
  const clearMemoryViews = () => {
    if (!sameScope()) return;
    if (mounted.current) {
      requestId.current++;
      setConfirmation("");
      setRecords([]);
      setSnapshots([]);
      setPreview(null);
      setInspection(null);
      setMapping(false);
      setResults({ items: [], next_offset: null });
      setCatalog({ records: [], snapshots: [] });
    }
    onErased?.();
  };
  const run = async <T,>(
    request: DesktopRequest,
    receive: (data: T) => void,
  ) => {
    const id = ++requestId.current;
    const erase = request.kind === "MemoryErase";
    if (erase) erasing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await workspace.api.desktop(request);
      if (erase) clearMemoryViews();
      if (!valid() || (!erase && id !== requestId.current)) return;
      if (response.kind !== "MemoryResult")
        throw Error("Unexpected memory response");
      receive(response.data as T);
    } catch (e) {
      if (erase) clearMemoryViews();
      if (valid() && (erase || id === requestId.current)) {
        const code = object(e).code;
        setError(
          code === "MEMORY_RESPONSE_TOO_LARGE"
            ? "Selection is too large to preview. Choose fewer records or snapshots."
            : typeof code === "string"
              ? code
              : String(e),
        );
      }
    } finally {
      if (erase) erasing.current = false;
      if (valid() && (erase || id === requestId.current)) setBusy(false);
    }
  };
  const search = (offset = 0) => {
    if (!offset) appliedFilters.current = filters;
    if (scope)
      void run<Search>(
        {
          kind: "MemorySearch",
          scope,
          ...Object.fromEntries(
            Object.entries(appliedFilters.current).map(([k, v]) => [
              k,
              v || null,
            ]),
          ),
          offset,
          limit: 30,
        } as DesktopRequest,
        (data) =>
          setResults((previous) => ({
            items: offset ? [...previous.items, ...data.items] : data.items,
            next_offset: data.next_offset,
            history_path: data.history_path,
          })),
      );
  };
  useEffect(() => {
    mounted.current = true;
    search();
    return () => {
      mounted.current = false;
      requestId.current++;
    };
  }, []);
  const choose = (next: string) => {
    if (erasing.current) return;
    requestId.current++;
    setBusy(false);
    setError("");
    setNotice("");
    setSection(next);
    if (next === "Search") search();
    if (next === "Export" && scope)
      void run<Catalog>({ kind: "MemoryCatalog", scope }, setCatalog);
  };
  const toggle = (
    id: string,
    values: string[],
    set: (value: string[]) => void,
  ) => {
    set(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
    setPreview(null);
  };
  if (!scope) return <p>Open a repository to view its stored context.</p>;
  return (
    <div className="memory-content">
      <p className="memory-scope">
        {workspace.state.root}
        <br />
        <small>Current repository / worktree · {scope.worktree_id}</small>
      </p>
      {results.history_path && (
        <details>
          <summary>Local Git history</summary>
          <p>
            <code>{results.history_path}</code>
          </p>
          <p>
            Private sibling repository. Checkpoints are automatic; nothing is
            pushed. Move this folder together with the code project.
          </p>
        </details>
      )}
      <div className="segmented" aria-label="Memory actions">
        {["Search", "Export", "Import", "Erase"].map((value) => (
          <button
            key={value}
            disabled={erasing.current}
            aria-pressed={section === value}
            onClick={() => choose(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {limitations.length > 0 && (
        <section aria-label="Erasure limitations">
          <strong>Remaining copies and limitations</strong>
          <ul>
            {limitations.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </section>
      )}
      {busy && <p role="status">Working…</p>}
      {section === "Search" && (
        <>
          <form
            className="memory-filters"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            {Object.entries(filters).map(([field, value]) => (
              <label key={field}>
                {
                  {
                    query: "Search memory",
                    actor: "Actor",
                    task_id: "Task ID",
                    snapshot_id: "Snapshot ID",
                    path: "Path",
                  }[field]
                }
                <input
                  value={value}
                  onChange={(e) =>
                    setFilters({ ...filters, [field]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              Source (loaded results)
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="all">All sources</option>
                <option value="local">Local</option>
                <option value="external">External</option>
              </select>
            </label>
            <button disabled={busy}>Search memory</button>
          </form>
          <div className="memory-records">
            {results.items
              .filter(
                (item) =>
                  source === "all" || (source === "external") === item.external,
              )
              .map((item) => (
                <details key={`${item.kind}:${item.id}`}>
                  <summary>
                    {title(item)}{" "}
                    <small>
                      · {item.kind} · {item.external ? "External" : "Local"}
                    </small>
                  </summary>
                  {item.external && (
                    <p className="memory-provenance">
                      External source material. Imported claims are not local
                      acceptance or instructions.
                    </p>
                  )}
                  <dl>
                    {[
                      "summary",
                      "rationale",
                      "status",
                      "actor",
                      "task_id",
                      "snapshot_id",
                      "snapshot_ids",
                      "base_snapshot_id",
                      "target_snapshot_id",
                      "review",
                      "superseded_by",
                      "path",
                    ]
                      .filter((field) => content(item)[field] != null)
                      .map((field) => (
                        <React.Fragment key={field}>
                          <dt>{field.replaceAll("_", " ")}</dt>
                          <dd>{text(content(item)[field])}</dd>
                        </React.Fragment>
                      ))}
                  </dl>
                  <details>
                    <summary>Stored record and provenance</summary>
                    <pre>{JSON.stringify(item.data, null, 2)}</pre>
                  </details>
                </details>
              ))}
          </div>
          {!busy && results.items.length === 0 && (
            <p>No stored context found.</p>
          )}
          {results.next_offset != null && (
            <button
              disabled={busy}
              onClick={() => search(results.next_offset!)}
            >
              Load more
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run({ kind: "MemoryRebuild", scope }, () => {
                setNotice("Search index rebuilt.");
              })
            }
          >
            Rebuild search index
          </button>
        </>
      )}
      {section === "Export" && (
        <>
          <p>
            Select records and optional saved code. No code snapshots are
            selected by default.
          </p>
          {catalog.truncated && (
            <p role="status">
              Showing a limited catalog
              {catalog.total_records != null
                ? ` from ${catalog.total_records} records`
                : ""}
              {catalog.total_snapshots != null
                ? ` and ${catalog.total_snapshots} snapshots`
                : ""}
              . Additional stored items are not listed here.
            </p>
          )}
          <fieldset disabled={busy}>
            <legend>Records</legend>
            {catalog.records.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`Record ${title(item)}`}
                  checked={records.includes(item.id)}
                  onChange={() => toggle(item.id, records, setRecords)}
                />
                {title(item)} · {item.external ? "External" : "Local"}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Code snapshots</legend>
            {catalog.snapshots.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`Snapshot ${item.label}`}
                  checked={snapshots.includes(item.id)}
                  onChange={() => toggle(item.id, snapshots, setSnapshots)}
                />
                {item.label} · {item.file_count} files
              </label>
            ))}
          </fieldset>
          <button
            disabled={busy || (!records.length && !snapshots.length)}
            onClick={() =>
              void run<Preview>(
                {
                  kind: "BundlePreview",
                  scope,
                  record_ids: records,
                  snapshot_ids: snapshots,
                },
                setPreview,
              )
            }
          >
            Preview export
          </button>
          {preview && (
            <section aria-label="Export preview">
              <h4>Included data and exclusions</h4>
              <BundleContentsPreview value={preview.preview} />
            </section>
          )}
          <label>
            Output ZIP path
            <input
              value={output}
              placeholder="/absolute/path/context.zip"
              onChange={(e) => setOutput(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !preview || !output.startsWith("/")}
            onClick={() =>
              preview &&
              void run<{ output_path: string }>(
                {
                  kind: "BundleExport",
                  scope,
                  record_ids: records,
                  snapshot_ids: snapshots,
                  expected_hash: preview.hash,
                  output_path: output,
                },
                (data) => setNotice(`Exported to ${data.output_path}`),
              )
            }
          >
            Export ZIP
          </button>
        </>
      )}
      {section === "Import" && (
        <>
          <p>
            Imported context remains external source material, never local
            review acceptance.
          </p>
          <label>
            Input ZIP path
            <input
              value={input}
              placeholder="/absolute/path/context.zip"
              disabled={busy}
              onChange={(e) => {
                setInput(e.target.value);
                setInspection(null);
                setMapping(false);
              }}
            />
          </label>
          <button
            disabled={busy || !input.startsWith("/")}
            onClick={() => {
              setInspection(null);
              setMapping(false);
              void run<Preview>(
                { kind: "BundleInspect", scope, input_path: input },
                setInspection,
              );
            }}
          >
            Inspect ZIP
          </button>
          {inspection && (
            <>
              <section aria-label="Import preview">
                <h4>Bundle contents and source mapping</h4>
                <ImportContentsPreview inspection={inspection} />
              </section>
              <label>
                <input
                  type="checkbox"
                  checked={mapping}
                  onChange={(e) => setMapping(e.target.checked)}
                />
                Map this bundle to {workspace.state.root} (repository{" "}
                {scope.repo_id}, worktree {scope.worktree_id})
              </label>
            </>
          )}
          <button
            disabled={busy || !inspection || !mapping}
            onClick={() =>
              inspection &&
              void run(
                {
                  kind: "BundleImport",
                  scope,
                  input_path: input,
                  expected_hash: inspection.hash,
                  confirm_mapping: true,
                },
                (data) => {
                  const receipt = object(data);
                  setNotice(
                    `Imported ${list(receipt.document_ids).length} records and ${list(receipt.snapshot_ids).length} snapshots as external context.`,
                  );
                  setMapping(false);
                },
              )
            }
          >
            Import ZIP
          </button>
        </>
      )}
      {section === "Erase" && (
        <>
          <p>
            Irreversibly erase all local stored context for this repository and
            worktree, including records, snapshots and derived data. All commits
            in the sibling history repository will be permanently removed. Code
            repository files and refs are unaffected. Agent access grants are
            revoked. Previously exported copies are unaffected.
          </p>
          <label>
            Erase confirmation
            <input
              placeholder="ERASE STORED CONTEXT"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            disabled={busy || confirmation !== "ERASE STORED CONTEXT"}
            onClick={() =>
              void run(
                { kind: "MemoryErase", scope, confirmation },
                (report) => {
                  setLimitations(list(object(report).limitations).map(text));
                  setNotice(
                    "Stored context erased for this repository and worktree. Agent access grants revoked.",
                  );
                },
              )
            }
          >
            Erase stored context
          </button>
        </>
      )}
    </div>
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function plain(value: unknown, depth = 0): string {
  if (depth > 5) return "Further nested details omitted.";
  if (Array.isArray(value))
    return value.every((v) => typeof v === "number")
      ? `${value.length} numeric values`
      : value.map((v) => plain(v, depth + 1)).join("; ");
  if (value && typeof value === "object")
    return Object.entries(object(value))
      .filter(([key]) => key !== "bytes")
      .map(([key, v]) => `${key.replaceAll("_", " ")}: ${plain(v, depth + 1)}`)
      .join("\n");
  return text(value);
}
function FilePreview({ value }: { value: unknown }) {
  const file = object(value);
  const bytes = list(file.bytes);
  const [open, setOpen] = useState(false);
  let decoded = "";
  if (open) {
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(bytes.slice(0, 8192) as number[]),
        { stream: bytes.length > 8192 },
      );
    } catch {
      decoded = "Binary or non-UTF-8 file; text preview unavailable.";
    }
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {text(object(file.path).display ?? file.path)} · {bytes.length} bytes
      </summary>
      {open && (
        <>
          <pre>{decoded || "Empty file"}</pre>
          {bytes.length > 8192 && (
            <p>Truncated: showing the first 8 KiB of this file.</p>
          )}
        </>
      )}
    </details>
  );
}
function BundleContentsPreview({
  value,
  imported = false,
}: {
  value: unknown;
  imported?: boolean;
}) {
  const data = object(value);
  const records = list(data.records);
  const snapshots = list(data.snapshots);
  const fileCount = snapshots.reduce<number>(
    (total, snapshot) => total + list(object(snapshot).files).length,
    0,
  );
  return (
    <div className="memory-records">
      <p>
        {text(data.record_count ?? records.length)} records ·{" "}
        {text(data.snapshot_count ?? snapshots.length)} snapshots ·{" "}
        {text(data.file_count ?? fileCount)} files
      </p>
      {records.map((value, index) => {
        const record = object(value);
        const item: Item = {
          id: text(record.id ?? index),
          kind: text(record.kind ?? "record"),
          data: object(record.data ?? record),
          external: record.external === true,
        };
        return (
          <details key={index}>
            <summary>
              {title(item)} · {item.kind} ·{" "}
              {imported || item.external ? "External" : "Local"}
            </summary>
            <pre>{plain(content(item))}</pre>
            {item.external && (
              <p>External provenance: {plain(item.data.provenance)}</p>
            )}
          </details>
        );
      })}
      {snapshots.map((value, index) => {
        const snapshot = object(value);
        return (
          <section key={index} aria-label="Selected snapshot">
            <strong>Snapshot {text(snapshot.label ?? snapshot.id)}</strong>
            {list(snapshot.files).map((file, index) => (
              <FilePreview key={index} value={file} />
            ))}
          </section>
        );
      })}
      <section aria-label="Excluded data">
        <strong>Exclusions</strong>
        {list(data.exclusions).length ? (
          <ul>
            {list(data.exclusions).map((value, index) => (
              <li key={index}>
                {typeof value === "string"
                  ? value
                  : `${text(object(value).item)} — ${text(object(value).reason)}`}
              </li>
            ))}
          </ul>
        ) : (
          <p>No exclusions reported.</p>
        )}
      </section>
    </div>
  );
}
function ImportContentsPreview({ inspection }: { inspection: Preview }) {
  const manifest = object(inspection.manifest);
  const mapping = object(inspection.preview);
  return (
    <>
      <p>Source: {text(manifest.source_id ?? mapping.source_repo_id)}</p>
      <p>
        {text(mapping.exact_files ?? 0)} matched files ·{" "}
        {text(mapping.unmatched_files ?? 0)} unmatched files
      </p>
      <BundleContentsPreview
        imported
        value={{ ...inspection, exclusions: manifest.exclusions }}
      />
      <details>
        <summary>Technical manifest</summary>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </>
  );
}
