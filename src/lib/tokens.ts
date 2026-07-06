import { createHash, randomBytes } from "node:crypto";

// TRL-API-001: tokens are stored only as a SHA-256 hash.
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateToken(): string {
  return `trk_${randomBytes(24).toString("base64url")}`;
}
