"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Spec } from "@/lib/api";

export default function Specs({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ specs: Spec[] }>(`/projects/${pid}/specs`).then((d) => { setSpecs(d.specs); setLoading(false); });
  }, [pid]);
  return (
    <>
      <div className="topbar"><h1>Specs</h1><span className="sub">Structured intent</span></div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : specs.length === 0 ? (
          <div className="card"><div className="empty">No specs ingested yet.</div></div>
        ) : (
          <div className="card">
            {specs.map((s) => (
              <Link key={s.id} href={`/p/${pid}/specs/${s.slug}`} className="row between" style={{ display: "flex" }}>
                <div className="stack"><strong>{s.title}</strong><span className="assertion-id">{s.slug} · v{s.version}</span></div>
                <span className="mutedtext">→</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
