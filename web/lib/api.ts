"use client";
import { getSession } from "./store";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = getSession();
  if (!s) throw new Error("Not connected");
  const res = await fetch(`${s.apiUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${s.token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || `${res.status}`);
  return json as T;
}

export const api = {
  get: <T,>(p: string) => call<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => call<T>("POST", p, b),
  patch: <T,>(p: string, b?: unknown) => call<T>("PATCH", p, b),
};

// ---- shared response types (mirror the server's JSON shapes) ----
export type AssertionStatus = "proposed" | "agreed" | "implemented" | "verified" | "drifted" | "retired";
export type Assertion = { id: string; humanId: string; title: string; statement: string; status: AssertionStatus };
export type Spec = { id: string; slug: string; title: string; version: number };
export type Drift = { id: string; kind: "reality" | "contradiction"; assertionId: string; assertionBId: string | null; status: string; summary: string };
export type Challenge = { id: string; onDecisionId: string; rationale: string; status: string };
export type Milestone = { id: string; title: string; targetDate: string | null; progress: { verified: number; total: number } };
export type Decision = { id: string; onType: string; onId: string; choice: string; rationale: string; at: string };
export type Fact = { id: string; key: string; statement: string; observerId: string; evidence: { type: string; ref: string }[]; observedAt: string };
export type Task = { id: string; title: string; status: string; ownerId: string | null };
