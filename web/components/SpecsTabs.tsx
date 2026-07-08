"use client";
import Link from "next/link";

// Specs and Map are two views of the same intent — a tab header, not two
// sidebar items.
export function SpecsTabs({ pid, current }: { pid: string; current: "specs" | "map" }) {
  return (
    <div className="subtabs">
      <Link href={`/p/${pid}/specs`} className={current === "specs" ? "active" : ""}>Specs</Link>
      <Link href={`/p/${pid}/map`} className={current === "map" ? "active" : ""}>Map</Link>
    </div>
  );
}
