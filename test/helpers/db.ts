import { sql } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { projects, principals, memberships, delegations, agentTokens } from "../../src/db/schema.js";
import { hashToken } from "../../src/lib/tokens.js";

// Mint a token for a principal and return an Authorization header for it.
export async function authFor(projectId: string, principalId: string): Promise<Record<string, string>> {
  const raw = `trk_test_${principalId}`;
  await db.insert(agentTokens).values({ projectId, principalId, tokenHash: hashToken(raw) });
  return { Authorization: `Bearer ${raw}` };
}

// Truncate every table between tests for isolation.
export async function resetDb(): Promise<void> {
  const rows = (await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  )) as unknown as { tablename: string }[];
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));
  }
}

// Insert a project with a first operator; returns ids used across tests.
export async function makeProject(name = "test"): Promise<{ projectId: string; operatorId: string }> {
  const project = (await db.insert(projects).values({ name }).returning())[0]!;
  const operator = (
    await db.insert(principals).values({ kind: "human", displayName: "Op" }).returning()
  )[0]!;
  await db
    .insert(memberships)
    .values({ projectId: project.id, principalId: operator.id, role: "operator" });
  return { projectId: project.id, operatorId: operator.id };
}

export async function addMember(
  projectId: string,
  kind: "human" | "agent",
  role: "operator" | "member",
  name: string = kind,
): Promise<string> {
  const p = (await db.insert(principals).values({ kind, displayName: name }).returning())[0]!;
  await db.insert(memberships).values({ projectId, principalId: p.id, role });
  return p.id;
}

export async function grantDelegation(
  projectId: string,
  agentPrincipalId: string,
  grantedById: string,
  decisionClasses: string[],
): Promise<string> {
  const d = (
    await db
      .insert(delegations)
      .values({ projectId, agentPrincipalId, grantedById, policy: "test", decisionClasses })
      .returning()
  )[0]!;
  return d.id;
}
