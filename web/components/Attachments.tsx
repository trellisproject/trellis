"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Attachment } from "@/lib/api";

const fmtSize = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Supporting assets (designs, mockups, docs) on an effort/assertion/task.
export function Attachments({ pid, targetType, targetId }: { pid: string; targetType: string; targetId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const r = await api.get<{ attachments: Attachment[] }>(`/projects/${pid}/attachments?target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`);
      setItems(r.attachments);
    } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, [pid, targetType, targetId]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      await api.upload(`/projects/${pid}/attachments?filename=${encodeURIComponent(file.name)}&target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`, file);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="row">
      <div className="flex" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        {items.map((a) => {
          const isImg = a.contentType?.startsWith("image/");
          return (
            <div key={a.id} className="attach">
              <a href={a.url} target="_blank" rel="noreferrer" title={a.filename}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {isImg ? <img src={a.url} alt={a.filename} /> : <div className="attach-file">{(a.filename.split(".").pop() || "file").toUpperCase()}</div>}
              </a>
              <div className="between" style={{ gap: 6 }}>
                <span className="mutedtext" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${a.filename} · ${fmtSize(a.size)}`}>{a.filename}</span>
                <button className="attach-x" onClick={async () => { await api.del(`/projects/${pid}/attachments/${a.id}`); load(); }} title="Remove">×</button>
              </div>
            </div>
          );
        })}
        <button className="attach-add" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "uploading…" : "+ Attach"}</button>
      </div>
      <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
