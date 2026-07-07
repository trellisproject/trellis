// Minimal client-side session: API base URL + bearer token, held in
// localStorage. This is the V1 bridge until human session auth (OAuth/magic
// link, TRL-API-002) exists — the operator pastes the token they got at
// project creation.

const KEY = "trellis.session";

export type Session = { apiUrl: string; token: string };

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function setSession(s: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
}
