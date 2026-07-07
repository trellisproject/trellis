"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, metricLabel, type AssertionDetail } from "@/lib/api";
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
          <div className="section-label" style={{ marginTop: 0 }}>Statement · authored in Trellis, mirrored to git · edit on the spec page</div>
          <div>{a.statement}</div>
        </div></div>

        {a.metricKey && (
          <>
            <div className="section-label">Metric — target {metricLabel(a)}</div>
            <div className="card"><div className="row">
              {d.measurements.length === 0 ? (
                <div className="mutedtext" style={{ fontSize: 13 }}>No measurements yet. A checker posts benchmark facts; the server compares each against the target.</div>
              ) : (
                <>
                  <div className="flex" style={{ alignItems: "baseline", marginBottom: 10 }}>
                    <span style={{ fontSize: 28, fontWeight: 700 }}>{d.measurements[0]!.value}{a.metricUnit ?? ""}</span>
                    <span className="mutedtext" style={{ fontSize: 13 }}>latest · {new Date(d.measurements[0]!.at).toLocaleDateString()}</span>
                    <Badge status={a.status} />
                  </div>
                  <Sparkline points={d.measurements.map((m) => m.value).reverse()} target={a.metricTarget ?? undefined} />
                  <div className="flex" style={{ marginTop: 8, flexWrap: "wrap" }}>
                    {d.measurements.map((m, i) => <span key={i} className="evidence pill">{m.value}{a.metricUnit ?? ""}</span>)}
                  </div>
                </>
              )}
            </div></div>
          </>
        )}

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

function Sparkline({ points, target }: { points: number[]; target?: number }) {
  if (points.length < 2) return null;
  const w = 320, h = 48, pad = 4;
  const all = target != null ? [...points, target] : points;
  const min = Math.min(...all), max = Math.max(...all);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const met = target == null || last >= target;
  return (
    <svg width={w} height={h} style={{ maxWidth: "100%" }}>
      {target != null && <line x1={pad} x2={w - pad} y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth="1" />}
      <path d={path} fill="none" stroke={met ? "var(--green)" : "var(--red)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill={met ? "var(--green)" : "var(--red)"} />
    </svg>
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
