"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Attachment } from "@/lib/api";

const fmtSize = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Supporting assets (designs, mockups, docs) on an effort/assertion/task.
// Files live in a PRIVATE Blob store; bytes are fetched through the API with
// the caller's bearer token and rendered via local object URLs — never a
// public URL. Image thumbnails are prefetched; other files download on click.
export function Attachments({ pid, targetType, targetId }: { pid: string; targetType: string; targetId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  function revokeAll() { urlsRef.current.forEach(URL.revokeObjectURL); urlsRef.current = []; }

  async function load() {
    try {
      const r = await api.get<{ attachments: Attachment[] }>(`/projects/${pid}/attachments?target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`);
      setItems(r.attachments);
      revokeAll();
      const map: Record<string, string> = {};
      await Promise.all(
        r.attachments.filter((a) => a.contentType?.startsWith("image/")).map(async (a) => {
          try { const u = await api.blob(`/projects/${pid}/attachments/${a.id}/content`); map[a.id] = u; urlsRef.current.push(u); } catch { /* skip */ }
        }),
      );
      setThumbs(map);
    } catch { /* ignore */ }
  }
  useEffect(() => { load(); return revokeAll; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pid, targetType, targetId]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      await api.upload(`/projects/${pid}/attachments?filename=${encodeURIComponent(file.name)}&target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`, file);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function open(a: Attachment) {
    try {
      const cached = thumbs[a.id];
      const u = cached ?? (await api.blob(`/projects/${pid}/attachments/${a.id}/content`));
      const link = document.createElement("a");
      link.href = u;
      if (a.contentType?.startsWith("image/")) { link.target = "_blank"; link.rel = "noreferrer"; } else { link.download = a.filename; }
      document.body.appendChild(link); link.click(); link.remove();
      if (!cached) setTimeout(() => URL.revokeObjectURL(u), 15000);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open file"); }
  }

  return (
    <div className="row">
      <div className="flex" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        {items.map((a) => {
          const isImg = a.contentType?.startsWith("image/");
          return (
            <div key={a.id} className="attach">
              <button className="attach-open" onClick={() => open(a)} title={a.filename}>
                {isImg && thumbs[a.id]
                  ? <img src={thumbs[a.id]} alt={a.filename} />
                  : <div className="attach-file">{isImg ? "🖼" : (a.filename.split(".").pop() || "file").toUpperCase()}</div>}
              </button>
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
