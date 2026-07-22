import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { serve } from "@hono/node-server";
import { app } from "../src/app.js";
import { db } from "../src/db/index.js";
import { assertions } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { resetDb } from "./helpers/db.js";

// End-to-end tests for the CLI adapter (TRL-CORE-017: agent interfaces are thin
// adapters over the one HTTP API). The real `cli/trellis.mjs` runs as a
// subprocess against an in-process server, so we exercise it exactly as an agent
// or CI job would: config loading, token resolution ($TRELLIS_TOKEN > cache >
// join), GET/POST calls, evidence parsing, and error propagation.

const cliPath = fileURLToPath(new URL("../cli/trellis.mjs", import.meta.url));
const spec = (id: string, status: string) =>
  `---\nspec: T-X\ntitle: T\n---\n### ${id}: t\nstatus: ${status}\n\nbody\n`;

let server: ReturnType<typeof serve>;
let baseUrl: string;
const tmpDirs: string[] = [];

function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), "trellis-cli-"));
  tmpDirs.push(d);
  return d;
}

function writeConfig(dir: string, projectId: string, joinCode?: string) {
  const cfg: Record<string, unknown> = { url: baseUrl, project: projectId, name: "cli-test" };
  if (joinCode) cfg.joinCode = joinCode;
  writeFileSync(join(dir, ".trellis.json"), JSON.stringify(cfg));
}

function runCli(
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { TRELLIS_TOKEN, TRELLIS_CONFIG, ...cleanEnv } = process.env;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { cwd: opts.cwd, env: { ...cleanEnv, ...(opts.env ?? {}) } },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

async function bootstrap(): Promise<{ projectId: string; operatorToken: string; joinCode: string }> {
  const res = await fetch(`${baseUrl}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "cli", operator: { displayName: "Op" } }),
  });
  const j = (await res.json()) as any;
  return { projectId: j.project.id, operatorToken: j.token, joinCode: j.joinCode };
}

beforeAll(async () => {
  await new Promise<void>((res) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://localhost:${info.port}`;
      res();
    });
  });
});

afterAll(() => {
  server?.close();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("cli adapter (TRL-CORE-017)", () => {
  it("join self-onboards with the code and caches a member token", async () => {
    const { projectId, joinCode } = await bootstrap();
    const dir = mkdir();
    writeConfig(dir, projectId, joinCode);
    const r = await runCli(["join"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("joined");
    expect(existsSync(join(dir, ".trellis", "token.json"))).toBe(true);
  });

  it("join with a bad code exits non-zero and surfaces the API error", async () => {
    const { projectId } = await bootstrap();
    const dir = mkdir();
    writeConfig(dir, projectId, "join_WRONG");
    const r = await runCli(["join"], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/join code|BAD_JOIN_CODE|403|Invalid/i);
  });

  it("fact --supports posts a verifying fact (evidence parsed from type:ref)", async () => {
    const { projectId, joinCode } = await bootstrap();
    await ingestSpec(projectId, "core", spec("T-X-001", "agreed"), "c1");
    const dir = mkdir();
    writeConfig(dir, projectId, joinCode);
    const r = await runCli(
      ["fact", "--statement", "done via cli", "--supports", "T-X-001", "--evidence", "test:cli.test.ts::x"],
      { cwd: dir },
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/verified.*T-X-001/);
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(a.status).toBe("verified");
  });

  it("fact --contradicts files drift", async () => {
    const { projectId, joinCode } = await bootstrap();
    await ingestSpec(projectId, "core", spec("T-X-001", "agreed"), "c1");
    const dir = mkdir();
    writeConfig(dir, projectId, joinCode);
    const r = await runCli(
      ["fact", "--statement", "reality diverged", "--contradicts", "T-X-001", "--evidence", "file:src/x.ts"],
      { cwd: dir },
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/drift/);
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(a.status).toBe("drifted");
  });

  it("worklist reads the project's intent (GET over the API)", async () => {
    const { projectId, joinCode } = await bootstrap();
    await ingestSpec(projectId, "core", spec("T-X-001", "agreed"), "c1");
    const dir = mkdir();
    writeConfig(dir, projectId, joinCode);
    const r = await runCli(["worklist"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("T-X-001");
  });

  it("$TRELLIS_TOKEN takes precedence over join (no join, no cached token)", async () => {
    const { projectId, operatorToken } = await bootstrap();
    await ingestSpec(projectId, "core", spec("T-X-001", "agreed"), "c1");
    const dir = mkdir();
    writeConfig(dir, projectId); // no joinCode — only the env token can auth
    const r = await runCli(["worklist"], { cwd: dir, env: { TRELLIS_TOKEN: operatorToken } });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("T-X-001");
    expect(existsSync(join(dir, ".trellis", "token.json"))).toBe(false);
  });

  it("missing config exits non-zero with a clear message", async () => {
    const dir = mkdir();
    const r = await runCli(["worklist"], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no config/i);
  });

  it("config missing url/project is rejected", async () => {
    const { projectId } = await bootstrap();
    const dir = mkdir();
    writeFileSync(join(dir, ".trellis.json"), JSON.stringify({ project: projectId }));
    const r = await runCli(["worklist"], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/url and project|must include/i);
  });

  it("effort new --desc sets a description that effort show renders", async () => {
    const { projectId, operatorToken } = await bootstrap();
    const dir = mkdir();
    writeConfig(dir, projectId);
    const env = { TRELLIS_TOKEN: operatorToken };
    const create = await runCli(
      ["effort", "new", "Legacy Migration", "--desc", "Move the legacy book into SuperKey", "--goal", "checklist"],
      { cwd: dir, env },
    );
    expect(create.code).toBe(0);
    const id = create.stdout.match(/created effort (\S+)/)?.[1];
    expect(id).toBeTruthy();
    const show = await runCli(["effort", "show", id!], { cwd: dir, env });
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("Legacy Migration");
    expect(show.stdout).toContain("Move the legacy book into SuperKey");
    expect(show.stdout).toMatch(/goal: checklist/);
  });

  it("effort update --desc changes the description", async () => {
    const { projectId, operatorToken } = await bootstrap();
    const dir = mkdir();
    writeConfig(dir, projectId);
    const env = { TRELLIS_TOKEN: operatorToken };
    const create = await runCli(["effort", "new", "E", "--goal", "open"], { cwd: dir, env });
    const id = create.stdout.match(/created effort (\S+)/)?.[1]!;
    const upd = await runCli(["effort", "update", id, "--desc", "Revised scope statement"], { cwd: dir, env });
    expect(upd.code).toBe(0);
    const show = await runCli(["effort", "show", id], { cwd: dir, env });
    expect(show.stdout).toContain("Revised scope statement");
  });

  it("effort show lists the effort's assertions", async () => {
    const { projectId, operatorToken } = await bootstrap();
    await ingestSpec(projectId, "core", spec("T-X-001", "agreed"), "c1");
    const dir = mkdir();
    writeConfig(dir, projectId);
    const env = { TRELLIS_TOKEN: operatorToken };
    const create = await runCli(["effort", "new", "Anchored", "--assertion", "T-X-001"], { cwd: dir, env });
    const id = create.stdout.match(/created effort (\S+)/)?.[1]!;
    const show = await runCli(["effort", "show", id], { cwd: dir, env });
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("T-X-001");
  });
});
