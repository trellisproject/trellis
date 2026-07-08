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

export function Mermaid({ chart, onNodeClick, highlight }: { chart: string; onNodeClick?: (key: string) => void; highlight?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onNodeClick);
  cbRef.current = onNodeClick;
  const hlRef = useRef(highlight);
  hlRef.current = highlight;
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
        ref.current.querySelectorAll<SVGGElement>("g.node").forEach((el) => {
          // mermaid node ids look like `flowchart-<key>-<n>`; our keys are alnum.
          const key = el.id.match(/-([A-Za-z0-9_]+)-\d+$/)?.[1];
          if (!key) return;
          if (cbRef.current) { el.style.cursor = "pointer"; el.addEventListener("click", () => cbRef.current?.(key)); }
          if (hlRef.current && key === hlRef.current) {
            el.classList.add("mmd-highlight");
            requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
          }
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Diagram error");
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  if (error) return <pre className="mermaid-error">{error}{"\n\n"}{chart}</pre>;
  return <div className="mermaid-host" ref={ref} />;
}
