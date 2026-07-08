"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Flip the `[ ]` <-> `[x]` on the given 0-based source line (for a clicked checkbox).
function toggleTaskLine(src: string, i: number): string {
  const lines = src.split("\n");
  if (lines[i] == null) return src;
  lines[i] = lines[i].replace(/^(\s*[-*+]\s+)\[([ xX])\]/, (_m, p: string, c: string) => `${p}[${c === " " ? "x" : " "}]`);
  return lines.join("\n");
}

export function Markdown({ source, onToggle }: { source: string; onToggle?: (lineIndex: number) => void }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          input: ({ node, ...props }) => {
            if (props.type !== "checkbox") return <input {...props} />;
            const line = (node as { position?: { start?: { line?: number } } })?.position?.start?.line;
            return <input type="checkbox" checked={!!props.checked} disabled={!onToggle} onChange={() => onToggle && line && onToggle(line - 1)} />;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// Rendered by default (with clickable checklists); Edit reveals the markdown source.
export function DescriptionEditor({ value, onSave, placeholder }: { value: string; onSave: (v: string) => Promise<void> | void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <div>
        <textarea className="input" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} autoFocus />
        <div className="flex" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={async () => { await onSave(draft); setEditing(false); }}>Save</button>
          <button className="btn ghost" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>
          <span className="mutedtext" style={{ fontSize: 12, marginLeft: "auto" }}>Markdown · # heading · - list · - [ ] checklist · [link](url)</span>
        </div>
      </div>
    );
  }
  return (
    <div>
      {value.trim()
        ? <Markdown source={value} onToggle={(i) => onSave(toggleTaskLine(value, i))} />
        : <div className="mutedtext" style={{ fontSize: 13 }}>{placeholder ?? "No description yet."}</div>}
      <button className="btn ghost" style={{ fontSize: 13, marginTop: 10 }} onClick={() => setEditing(true)}>{value.trim() ? "Edit" : "Add description"}</button>
    </div>
  );
}
