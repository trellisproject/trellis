"use client";
import { use, useEffect, useState } from "react";
import { api, type Assertion, type Spec } from "@/lib/api";
import { Badge } from "@/components/Badge";

export default function SpecDetail({ params }: { params: Promise<{ pid: string; slug: string }> }) {
  const { pid, slug } = use(params);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ spec: Spec; assertions: Assertion[] }>(`/projects/${pid}/specs/${slug}`).then((d) => {
      setSpec(d.spec); setAssertions(d.assertions); setLoading(false);
    });
  }, [pid, slug]);

  return (
    <>
      <div className="topbar"><h1>{spec?.title ?? slug}</h1><span className="sub">{assertions.length} assertions · statements are read-only (authored in git)</span></div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : (
          <div className="card">
            {assertions.map((a) => (
              <div key={a.id} className="row" style={{ borderLeft: a.status === "drifted" ? "3px solid var(--red)" : "3px solid transparent" }}>
                <div className="between">
                  <div className="flex"><span className="assertion-id">{a.humanId}</span><strong>{a.title}</strong></div>
                  <Badge status={a.status} />
                </div>
                <div className="mutedtext" style={{ fontSize: 13, marginTop: 6 }}>{a.statement}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
