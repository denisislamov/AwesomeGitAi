import React from "react";
import type { Workspace } from "../../workspace";
import { SymbolText } from "../relations/RelationsHover";

// A deliberately small, non-HTML prose format: paragraphs, lists, headings and code.
// Render recorded text through React escaping; never execute embedded markup.
function Inline({ text, workspace }: { text: string; workspace: Workspace }) {
  return (
    <>
      {text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i}>
            <SymbolText workspace={workspace} text={part.slice(1, -1)} />
          </code>
        ) : part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>
            <SymbolText workspace={workspace} text={part.slice(2, -2)} />
          </strong>
        ) : (
          <SymbolText key={i} workspace={workspace} text={part} />
        ),
      )}
    </>
  );
}
const listItem = (line: string) =>
  line.match(/^\s*(?:(\d+)[.)]|([-*•]))\s+(.+)$/);
const blockStart = (line: string) =>
  /^\s*$|^```|^#{1,6}\s/.test(line) || !!listItem(line);
export function ExplanationProse({
  text,
  workspace,
}: {
  text: string;
  workspace: Workspace;
}) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const key = i;
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    if (/^```/.test(lines[i])) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(
        <pre key={key}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = lines[i].match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      blocks.push(
        <h4 key={key}>
          <Inline workspace={workspace} text={heading[1]} />
        </h4>,
      );
      i++;
      continue;
    }
    const first = listItem(lines[i]);
    if (first) {
      const ordered = !!first[1];
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const item = listItem(lines[i]);
        if (!item || !!item[1] !== ordered) break;
        const itemKey = i++;
        let value = item[3];
        while (
          i < lines.length &&
          /^\s+\S/.test(lines[i]) &&
          !blockStart(lines[i])
        )
          value += "\n" + lines[i++].trim();
        items.push(
          <li key={itemKey}>
            <Inline workspace={workspace} text={value} />
          </li>,
        );
      }
      blocks.push(
        ordered ? (
          <ol key={key} start={Number(first[1])}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        ),
      );
      continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && !blockStart(lines[i]))
      paragraph.push(lines[i++]);
    blocks.push(
      <p key={key}>
        <Inline workspace={workspace} text={paragraph.join("\n")} />
      </p>,
    );
  }
  return <div className="explanation-prose">{blocks}</div>;
}
