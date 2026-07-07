"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type TaskDetail } from "@/lib/api";

export default function TaskPage({ params }: { params: Promise<{ pid: string; tid: string }> }) {
  const { pid, tid } = use(params);
  const [d, setD] = useState<TaskDetail | null>(null);
  const [assertionIds, setAssertionIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const detail = await api.get<TaskDetail>(`/tasks/${tid}`);
      setD(detail);
      // map assertion uuids -> human ids via the specs
      const specs = await api.get<{ specs: { slug: string }[] }>(`/projects/${pid}/specs`);
      const map: Record<string, string> = {};
      for (const s of specs.specs) {
        const sd = await api.get<{ assertions: { id: string; humanId: string }[] }>(`/projects/${pid}/specs/${s.slug}`);
        for (const a of sd.assertions) map[a.id] = a.humanId;
      }
      setAssertionIds(map);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [pid, tid]);

  if (loading) return <div className="content"><div className="empty">Loading…</div></div>;
  if (!d) return <div className="content"><div className="empty">Task not found.</div></div>;

  return (
    <>
      <div className="topbar">
        <Link href={`/p/${pid}/tasks`} className="mutedtext" style={{ fontSize: 13 }}>← Tasks</Link>
        <h1 style={{ marginLeft: 8 }}>{d.task.title}</h1>
        <span className="pill" style={{ textTransform: "capitalize" }}>{d.task.status.replace("_", " ")}</span>
      </div>
      <div className="content">
        <div className="section-label" style={{ marginTop: 0 }}>Linked intent</div>
        <div className="card">
          {d.assertions.length === 0 ? <div className="empty" style={{ padding: 24 }}>No linked assertions.</div> :
            d.assertions.map((aid) => {
              const h = assertionIds[aid];
              return h ? <Link key={aid} href={`/p/${pid}/a/${h}`} className="row" style={{ display: "block" }}><span className="aid">{h}</span></Link>
                : <div key={aid} className="row"><span className="aid">{aid}</span></div>;
            })}
        </div>

        <div className="section-label">Checkpoints — resumable progress</div>
        <div className="card">
          {d.checkpoints.length === 0 ? <div className="empty" style={{ padding: 24 }}>No checkpoints yet.</div> :
            d.checkpoints.map((cp) => (
              <div key={cp.id} className="row between"><span>{cp.note}</span><span className="mutedtext" style={{ fontSize: 12 }}>{new Date(cp.at).toLocaleString()}</span></div>
            ))}
        </div>
      </div>
    </>
  );
}
