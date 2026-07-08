"use client";
import { useEffect, useRef, useState } from "react";

// Lazy-load mermaid once; it's heavy, so keep it out of the main bundle.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        flowchart: { curve: "basis", htmlLabels: true, useMaxWidth: true },
        themeVariables: {
          background: "#0b0d10",
          primaryColor: "#1b2130",
          primaryTextColor: "#e6e9ef",
          primaryBorderColor: "#262d3b",
          lineColor: "#5b647a",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: "14px",
        },
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

let idCounter = 0;

export function Mermaid({ chart, onNodeClick }: { chart: string; onNodeClick?: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onNodeClick);
  cbRef.current = onNodeClick;
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(`mmd-${++idCounter}`, chart);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setError("");
        if (cbRef.current) {
          ref.current.querySelectorAll<SVGGElement>("g.node").forEach((el) => {
            // mermaid node ids look like `flowchart-<key>-<n>`; our keys are alnum.
            const key = el.id.match(/-([A-Za-z0-9_]+)-\d+$/)?.[1];
            if (!key) return;
            el.style.cursor = "pointer";
            el.addEventListener("click", () => cbRef.current?.(key));
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Diagram error");
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  if (error) return <pre className="mermaid-error">{error}{"\n\n"}{chart}</pre>;
  return <div className="mermaid-host" ref={ref} />;
}
