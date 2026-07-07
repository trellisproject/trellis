"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type AssertionDetail } from "@/lib/api";
import { Badge } from "@/components/Badge";

export default function AssertionHub({ params }: { params: Promise<{ pid: string; humanId: string }> }) {
  const { pid, humanId } = use(params);
  const [d, setD] = useState<AssertionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<AssertionDetail>(`/projects/${pid}/assertions/${humanId}`).then((r) => { setD(r); setLoading(false); }).catch(() => setLoading(false));
  }, [pid, humanId]);

  if (loading) return <div className="content"><div className="empty">Loading…</div></div>;
  if (!d) return <div className="content"><div className="empty">Assertion not found.</div></div>;
  const a = d.assertion;

  return (
    <>
      <div className="topbar">
        <Link href={`/p/${pid}/specs`} className="mutedtext" style={{ fontSize: 13 }}>← Specs</Link>
        <h1 style={{ marginLeft: 8 }}><span className="aid" style={{ marginRight: 10 }}>{a.humanId}</span>{a.title}</h1>
        <Badge status={a.status} />
      </div>
      <div className="content">
        <div className="card"><div className="row">
          <div className="section-label" style={{ marginTop: 0 }}>Statement · read-only, authored in git</div>
          <div>{a.statement}</div>
        </div></div>

        <Section title={`Facts about this assertion (${d.facts.length})`} empty="No observations recorded yet.">
          {d.facts.map((f) => (
            <div key={f.id} className="row">
              <div className="flex"><span className={`pill`} style={{ color: f.relation === "contradicts" ? "var(--red)" : "var(--green)" }}>{f.relation}</span><span>{f.statement}</span>
                <span className="mutedtext" style={{ marginLeft: "auto", fontSize: 12 }}>{new Date(f.observedAt).toLocaleDateString()}</span></div>
              <div className="flex" style={{ marginTop: 6, flexWrap: "wrap" }}>{f.evidence.map((e, i) => <span key={i} className="evidence pill">{e.type}: {e.ref}</span>)}</div>
            </div>
          ))}
        </Section>

        <Section title={`Drift (${d.drifts.length})`} empty="No drift — intent and reality agree.">
          {d.drifts.map((dr) => (
            <div key={dr.id} className="row"><div className="flex"><span className="pill">{dr.kind}</span><span className={`badge ${dr.status === "resolved" ? "verified" : "drifted"}`}>{dr.status}</span><span className="mutedtext" style={{ fontSize: 13 }}>{dr.summary}</span></div></div>
          ))}
        </Section>

        <Section title={`Tasks (${d.tasks.length})`} empty="No linked work.">
          {d.tasks.map((t) => (
            <Link key={t.id} href={`/p/${pid}/t/${t.id}`} className="row between" style={{ display: "flex" }}>
              <span>{t.title}</span><span className="pill" style={{ textTransform: "capitalize" }}>{t.status.replace("_", " ")}</span>
            </Link>
          ))}
        </Section>

        <Section title={`Why it's like this — decisions (${d.decisions.length})`} empty="No decisions yet.">
          {d.decisions.map((dec) => (
            <div key={dec.id} className="row"><div className="flex"><span className="pill">{dec.onType}</span><strong style={{ textTransform: "capitalize" }}>{dec.choice}</strong><span className="mutedtext" style={{ marginLeft: "auto", fontSize: 12 }}>{new Date(dec.at).toLocaleDateString()}</span></div><div style={{ marginTop: 6 }}>{dec.rationale}</div></div>
          ))}
        </Section>

        <Section title="Lifecycle history" empty="">
          {d.statusHistory.map((h) => (
            <div key={h.id} className="row between"><div className="flex"><Badge status={h.status} />{h.note && <span className="mutedtext" style={{ fontSize: 12 }}>{h.note}</span>}</div><span className="mutedtext" style={{ fontSize: 12 }}>{new Date(h.at).toLocaleString()}</span></div>
          ))}
        </Section>
      </div>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((x) => x);
  return (
    <>
      <div className="section-label">{title}</div>
      <div className="card">{hasContent ? children : <div className="empty" style={{ padding: 24 }}>{empty}</div>}</div>
    </>
  );
}
