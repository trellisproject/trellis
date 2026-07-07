"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Task } from "@/lib/api";

export default function Tasks({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ tasks: Task[] }>(`/projects/${pid}/tasks`).then((d) => { setTasks(d.tasks); setLoading(false); });
  }, [pid]);
  return (
    <>
      <div className="topbar"><h1>Tasks</h1><span className="sub">Work, linked to intent</span></div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : tasks.length === 0 ? (
          <div className="card"><div className="empty">No tasks.</div></div>
        ) : (
          <div className="card">
            {tasks.map((t) => (
              <Link key={t.id} href={`/p/${pid}/t/${t.id}`} className="row between" style={{ display: "flex" }}>
                <span>{t.title}</span>
                <div className="flex"><span className="pill" style={{ textTransform: "capitalize" }}>{t.status.replace("_", " ")}</span><span className="mutedtext">→</span></div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
