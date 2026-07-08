"use client";
import { Fragment, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type Worklist, type WorklistItem, type Priority, type Effort, type Member } from "@/lib/api";
import { AssertionPickerModal } from "@/components/AssertionPickerModal";

const BUCKETS: { key: string; label: string; blurb: string }[] = [
  { key: "decide", label: "Decide", blurb: "A judgment is owed — drifts, challenges, new requests" },
  { key: "specify", label: "Specify", blurb: "Accepted requests to turn into intent" },
  { key: "agree", label: "Agree", blurb: "Proposed assertions to review" },
  { key: "build", label: "Reconcile", blurb: "Agreed intent, not yet confirmed by a fact — build it, or check the code that already ships it" },
  { key: "do", label: "Do", blurb: "Open tasks — the work itself, including standalone operational tasks" },
  { key: "verify", label: "Verify", blurb: "Built, awaiting a verifying fact" },
];

type Action =
  | { type: "resolve-drift"; item: WorklistItem }
  | { type: "resolve-challenge"; item: WorklistItem }
  | { type: "decide-request"; item: WorklistItem }
  | { type: "agree"; item: WorklistItem }
  | { type: "create-task"; item: WorklistItem }
  | { type: "link-assertions"; item: WorklistItem };

export default function WorklistPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const router = useRouter();
  const [wl, setWl] = useState<Worklist | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [efforts, setEfforts] = useState<Effort[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [scope, setScope] = useState<string>("all"); // "all" | "effort:<id>" | "owner:<id>"

  async function load() {
    const q = scope.startsWith("effort:") ? `?effort=${scope.slice(7)}` : scope.startsWith("owner:") ? `?owner=${scope.slice(6)}` : "";
    setWl(await api.get<Worklist>(`/projects/${pid}/worklist${q}`));
  }
  useEffect(() => { load(); }, [pid, scope]);
  useEffect(() => {
    api.get<{ efforts: Effort[] }>(`/projects/${pid}/efforts`).then((d) => setEfforts(d.efforts)).catch(() => {});
    api.get<{ members: Member[] }>(`/projects/${pid}/members`).then((d) => setMembers(d.members)).catch(() => {});
  }, [pid]);

  function onAct(item: WorklistItem) {
    if (item.bucket === "decide" && item.kind === "drift") return setAction({ type: "resolve-drift", item });
    if (item.bucket === "decide" && item.kind === "challenge") return setAction({ type: "resolve-challenge", item });
    if (item.bucket === "decide" && item.kind === "request") return setAction({ type: "decide-request", item });
    if (item.bucket === "agree") return setAction({ type: "agree", item });
    if (item.bucket === "build") return setAction({ type: "create-task", item });
    if (item.bucket === "specify") return setAction({ type: "link-assertions", item });
    if (item.bucket === "do") return router.push(`/p/${pid}/t/${item.id}`);
    if (item.bucket === "verify") return router.push(`/p/${pid}/a/${item.ref}`);
  }

  async function setPriority(item: WorklistItem, priority: Priority) {
    const path = item.kind === "drift" ? `/projects/${pid}/drifts/${item.id}` : item.kind === "request" ? `/projects/${pid}/requests/${item.id}` : null;
    if (!path) return;
    await api.patch(path, { priority });
    load();
  }

  const total = wl ? Object.values(wl.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <div className="topbar">
        <h1>Worklist</h1>
        <span className="sub">{total === 0 ? "All clear." : `${total} item${total === 1 ? "" : "s"}, highest priority first`}</span>
        <select className="mini-select" style={{ marginLeft: "auto" }} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All work</option>
          {efforts.length > 0 && <optgroup label="By effort">{efforts.map((e) => <option key={e.id} value={`effort:${e.id}`}>{e.status === "active" ? "★ " : ""}{e.dueSoon ? "⏰ " : ""}{e.title}</option>)}</optgroup>}
          {members.length > 0 && <optgroup label="By owner">{members.map((m) => <option key={m.principalId} value={`owner:${m.principalId}`}>{m.name}</option>)}</optgroup>}
        </select>
      </div>
      <div className="content">
        {!wl ? <div className="empty">Loading…</div> : BUCKETS.map((b) => {
          const items = wl.buckets[b.key] ?? [];
          if (items.length === 0) return null;
          return (
            <Fragment key={b.key}>
              <div className="section-label">{b.label} · {items.length}<span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8, opacity: 0.7 }}>{b.blurb}</span></div>
              <div className="card">
                {items.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="row between">
                    {item.kind === "task" || item.kind === "assertion" || item.assertionRef ? (
                      <Link href={item.kind === "task" ? `/p/${pid}/t/${item.id}` : `/p/${pid}/a/${item.kind === "assertion" ? item.ref : item.assertionRef}`} className="flex" style={{ minWidth: 0 }} title="Open detail">
                        <PriorityDot p={item.priority} />
                        <span className="aid">{item.ref}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                      </Link>
                    ) : (
                      <div className="flex" style={{ minWidth: 0 }}>
                        <PriorityDot p={item.priority} />
                        <span className="aid">{item.ref}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                      </div>
                    )}
                    <div className="flex">
                      {item.dueInDays != null && item.dueInDays <= 7 && (
                        <span className="pill" title={item.commitment ? "client commitment" : "due soon"} style={{ color: item.commitment ? "var(--red)" : "var(--muted)", borderColor: item.commitment ? "var(--red)" : undefined, whiteSpace: "nowrap" }}>
                          {item.commitment ? "⏰ " : ""}{item.dueInDays <= 0 ? "due now" : `due ${item.dueInDays}d`}
                        </span>
                      )}
                      {item.owner && <span className="mutedtext" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{item.owner}</span>}
                      {(item.kind === "drift" || item.kind === "request") && (
                        <select className="mini-select" value={item.priority} onChange={(e) => setPriority(item, e.target.value as Priority)} title="Priority">
                          <option value="now">now</option>
                          <option value="normal">normal</option>
                          <option value="later">later</option>
                        </select>
                      )}
                      <button className="btn" onClick={() => onAct(item)}>{item.action}</button>
                    </div>
                  </div>
                ))}
              </div>
            </Fragment>
          );
        })}
        {wl && total === 0 && <div className="card"><div className="empty">Nothing needs action. Intent and reality agree, and everything agreed is built and verified. ✓</div></div>}
      </div>
      {action?.type === "link-assertions" ? (
        <AssertionPickerModal
          pid={pid}
          title="Link assertions to this request"
          subtitle="Attach intent that already exists in a spec. New intent is authored in the spec file (derived from this request) and ingested."
          excludeHumanIds={[]}
          submitLabel="Link"
          onClose={() => setAction(null)}
          onSubmit={async (sel) => { await api.post(`/projects/${pid}/requests/${action.item.id}/assertions`, { assertions: sel }); load(); }}
        />
      ) : action ? (
        <ActionModal pid={pid} action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
      ) : null}
    </>
  );
}

function PriorityDot({ p }: { p: Priority }) {
  const color = p === "now" ? "var(--red)" : p === "later" ? "var(--muted)" : "var(--border)";
  return <span title={p} style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
}

type ModalAction = Exclude<Action, { type: "link-assertions" }>;

const CONFIG: Record<ModalAction["type"], { title: (i: WorklistItem) => string; choices: string[]; choiceKey: string; endpoint: (pid: string, i: WorklistItem) => string; needsTitle?: boolean }> = {
  "resolve-drift": { title: (i) => `Resolve drift: ${i.title}`, choices: ["fix", "amend", "accept"], choiceKey: "choice", endpoint: (pid, i) => `/projects/${pid}/drifts/${i.id}/resolve` },
  "resolve-challenge": { title: (i) => `Resolve challenge`, choices: ["uphold", "supersede"], choiceKey: "choice", endpoint: (pid, i) => `/projects/${pid}/challenges/${i.id}/resolve` },
  "decide-request": { title: (i) => `Decide: ${i.title}`, choices: ["accept", "decline"], choiceKey: "choice", endpoint: (pid, i) => `/projects/${pid}/requests/${i.id}/decide` },
  "agree": { title: (i) => `Agree ${i.ref}`, choices: [], choiceKey: "choice", endpoint: (pid, i) => `/projects/${pid}/assertions/${i.ref}/agree` },
  "create-task": { title: (i) => `Create a build task for ${i.ref}`, choices: [], choiceKey: "choice", endpoint: (pid, i) => `/projects/${pid}/tasks`, needsTitle: true },
};

function ActionModal({ pid, action, onClose, onDone }: { pid: string; action: ModalAction; onClose: () => void; onDone: () => void }) {
  const cfg = CONFIG[action.type];
  const [choice, setChoice] = useState(cfg.choices[0] ?? "");
  const [rationale, setRationale] = useState("");
  const [taskTitle, setTaskTitle] = useState(cfg.needsTitle ? `Build ${action.item.ref}: ${action.item.title}` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      if (action.type === "create-task") {
        await api.post(cfg.endpoint(pid, action.item), { title: taskTitle, assertions: [action.item.ref] });
      } else {
        const body: Record<string, unknown> = { rationale };
        if (cfg.choices.length) body[cfg.choiceKey] = choice;
        await api.post(cfg.endpoint(pid, action.item), body);
      }
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  const canSubmit = action.type === "create-task" ? taskTitle.trim().length > 0 : rationale.trim().length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>{cfg.title(action.item)}</h3>
      <div className="mutedtext" style={{ fontSize: 13, marginTop: -4, marginBottom: 12 }}>{action.item.title}{action.item.kind === "assertion" && <> · <a href={`/p/${pid}/a/${action.item.ref}`} target="_blank" rel="noreferrer">open detail ↗</a></>}</div>
      {action.type === "create-task" ? (
        <>
          <label>Task title</label>
          <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
        </>
      ) : (
        <>
          {cfg.choices.length > 0 && (
            <>
              <label>Choice</label>
              <div className="flex">{cfg.choices.map((ch) => <button key={ch} className={`btn ${choice === ch ? "primary" : "ghost"}`} onClick={() => setChoice(ch)} style={{ textTransform: "capitalize" }}>{ch}</button>)}</div>
            </>
          )}
          <label>Rationale (required — the decision record)</label>
          <textarea className="input" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why?" />
        </>
      )}
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !canSubmit}>{busy ? "Working…" : "Confirm"}</button>
      </div>
    </div></div>
  );
}
