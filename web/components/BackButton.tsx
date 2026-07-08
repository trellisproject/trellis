"use client";
import { useRouter } from "next/navigation";

// Returns to wherever you actually came from (worklist, roadmap, specs, …)
// rather than a hardcoded destination. Browser back restores scroll position.
// Falls back to a sensible route on a direct landing (no in-app history).
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => (typeof window !== "undefined" && window.history.length > 1 ? router.back() : router.push(fallback))}
      className="mutedtext"
      style={{ fontSize: 13, background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
    >
      ← Back
    </button>
  );
}
