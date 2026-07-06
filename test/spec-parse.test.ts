import { describe, it, expect } from "vitest";
import { parseSpec } from "../src/lib/spec-parse.js";

const SAMPLE = `---
project: trellis
spec: TRL-CORE
title: Trellis Core
---

# Trellis Core

Narrative that is not tracked.

### TRL-CORE-001: Project is the only scope
status: agreed

Every spec, assertion, fact, drift, and task belongs to exactly one
project.

### TRL-CORE-002: Assertion IDs are immutable
status: proposed

Assertion IDs are never renumbered or reused.
`;

describe("parseSpec", () => {
  it("extracts frontmatter", () => {
    const r = parseSpec(SAMPLE);
    expect(r.frontmatter.spec).toBe("TRL-CORE");
    expect(r.frontmatter.title).toBe("Trellis Core");
  });

  it("parses assertions with id, title, status, statement", () => {
    const r = parseSpec(SAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.assertions).toHaveLength(2);
    expect(r.assertions[0]).toMatchObject({
      humanId: "TRL-CORE-001",
      title: "Project is the only scope",
      status: "agreed",
      order: 0,
    });
    expect(r.assertions[0]!.statement).toContain("belongs to exactly one");
    expect(r.assertions[1]!.status).toBe("proposed");
  });

  it("flags a missing status line", () => {
    const bad = `### TRL-X-001: No status\n\nBody without a status line.\n`;
    const r = parseSpec(bad);
    expect(r.errors.some((e) => /missing status/.test(e.message))).toBe(true);
  });

  it("flags an invalid status value", () => {
    const bad = `### TRL-X-001: Bad status\nstatus: nonsense\n\nBody.\n`;
    const r = parseSpec(bad);
    expect(r.errors.some((e) => /invalid status/.test(e.message))).toBe(true);
  });

  it("flags a duplicate id", () => {
    const dup = SAMPLE + `\n### TRL-CORE-001: Dupe\nstatus: agreed\n\nBody.\n`;
    const r = parseSpec(dup);
    expect(r.errors.some((e) => /Duplicate assertion id/.test(e.message))).toBe(true);
  });
});
