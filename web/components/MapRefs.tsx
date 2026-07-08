"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Ref = { assertionHumanId: string; nodeKey: string; nodeLabel: string; diagramKey: string; diagramTitle: string };

// "On the map" — where this assertion (or a spec's assertions) appears. Links
// deep into the map at the exact node. `query` is e.g. "assertion=SK-001" or
// "spec=data-validation".
export function MapRefs({ pid, query, showAssertion }: { pid: string; query: string; showAssertion?: boolean }) {
  const [refs, setRefs] = useState<Ref[] | null>(null);
  useEffect(() => { api.get<{ refs: Ref[] }>(`/projects/${pid}/map-refs?${query}`).then((r) => setRefs(r.refs)).catch(() => setRefs([])); }, [pid, query]);
  if (!refs || refs.length === 0) return null;
  return (
    <>
      <div className="section-label">On the map</div>
      <div className="card">
        {refs.map((r) => (
          <Link key={r.diagramKey + r.nodeKey} href={`/p/${pid}/map/${r.diagramKey}?node=${r.nodeKey}`} className="row between" style={{ display: "flex" }}>
            <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong>{r.nodeLabel}</strong>{showAssertion && <span className="mutedtext"> · {r.assertionHumanId}</span>} <span className="mutedtext">in {r.diagramTitle}</span>
            </span>
            <span className="mutedtext">→</span>
          </Link>
        ))}
      </div>
    </>
  );
}
