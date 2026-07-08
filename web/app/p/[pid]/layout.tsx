"use client";
import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { use } from "react";
import { api } from "@/lib/api";
import { getSession, clearSession } from "@/lib/store";

const NAV = [
  { seg: "worklist", label: "Worklist" },
  { seg: "requests", label: "Requests" },
  { seg: "specs", label: "Specs" },
  { seg: "roadmap", label: "Roadmap" },
  { seg: "facts", label: "Facts" },
  { seg: "history", label: "History" },
  { seg: "tasks", label: "Tasks" },
  { seg: "settings", label: "Settings" },
];

export default function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const pathname = usePathname();
  const router = useRouter();
  const [name, setName] = useState("");
  const [triageCount, setTriageCount] = useState<number | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.push("/");
      return;
    }
    api.get<{ project: { name: string } }>(`/projects/${pid}`).then((d) => setName(d.project.name)).catch(() => router.push("/"));
    api
      .get<{ counts: { decide: number } }>(`/projects/${pid}/worklist`)
      .then((d) => setTriageCount(d.counts.decide))
      .catch(() => {});
  }, [pid, router]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="dot" /> Trellis</div>
        <nav className="nav">
          {NAV.map((n) => {
            const active = pathname.includes(`/${n.seg}`) || (n.seg === "specs" && pathname.includes(`/map`));
            return (
              <Link key={n.seg} href={`/p/${pid}/${n.seg}`} className={active ? "active" : ""}>
                {n.label}
                {n.seg === "worklist" && triageCount != null && triageCount > 0 && (
                  <span className="count alert">{triageCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div style={{ position: "absolute", bottom: 16, left: 14, right: 14 }}>
          <div className="mutedtext" style={{ fontSize: 12, padding: "0 8px 8px" }}>{name}</div>
          <button className="btn" style={{ width: "100%" }} onClick={() => { clearSession(); router.push("/"); }}>Disconnect</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
