import React, { useState } from "react";
import { Dialog } from "../commands/CommandUI";
import { catalogVersion, type ConstructHelp } from "./language-help";
export function ConstructDialog({
  help,
  location,
  onClose,
}: {
  help: ConstructHelp;
  location: string;
  onClose: () => void;
}) {
  const [example, setExample] = useState(false),
    [sources, setSources] = useState(false);
  const entry = help.entry;
  return (
    <Dialog title="Language construct" onClose={onClose}>
      <p className="muted">
        {location} · line {help.line}
      </p>
      {entry ? (
        <>
          <h3>{entry.title}</h3>
          <p>{entry.meaning}</p>
          <p>{entry.consequence}</p>
          <button aria-expanded={example} onClick={() => setExample(!example)}>
            Example
          </button>
          {example && (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              <code>{entry.example}</code>
            </pre>
          )}
          <button aria-expanded={sources} onClick={() => setSources(!sources)}>
            Version and source
          </button>
          {sources && (
            <div>
              <p>
                {entry.language} {entry.since}+ · Project language version is
                unknown; verify compatibility with your project.
              </p>
              <p>
                Reference catalog {catalogVersion} · Syntax context only, not
                compiler validation.
              </p>
              <p style={{ overflowWrap: "anywhere", userSelect: "text" }}>
                {entry.source}
              </p>
            </div>
          )}
        </>
      ) : (
        <p>{help.reason}</p>
      )}
      <p>Author intent: {help.authorIntent}</p>
      <small>
        Language reference only. Recorded decisions and AI check results are
        unchanged.
      </small>
    </Dialog>
  );
}
