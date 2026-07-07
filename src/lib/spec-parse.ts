// Parser for the Trellis spec-format (playbook/docs/spec-format.md).
// Pure and dependency-free so it can run in the server, the CLI, and tests.

import type { AssertionStatus } from "../db/schema.js";

export type Comparator = "gte" | "gt" | "lte" | "lt" | "eq";
export type ParsedMetric = { key: string; comparator: Comparator; target: number; unit: string | null };

export type ParsedAssertion = {
  humanId: string;
  title: string;
  status: AssertionStatus;
  statement: string;
  order: number;
  metric: ParsedMetric | null;
};

export type ParseResult = {
  frontmatter: { project?: string; spec?: string; title?: string };
  bodyMd: string;
  assertions: ParsedAssertion[];
  errors: { line: number; message: string }[];
};

const STATUSES: AssertionStatus[] = [
  "proposed",
  "agreed",
  "implemented",
  "verified",
  "drifted",
  "retired",
];

const ASSERTION_HEADING = /^###\s+([A-Z]+-[A-Z]+-\d{3}):\s+(.+?)\s*$/;
const OTHER_HEADING = /^#{1,3}\s+/;
const STATUS_LINE = /^status:\s*(\S+)\s*$/;
const METRIC_LINE = /^metric:\s*(\S+)\s*(>=|<=|>|<|==)\s*([0-9]+(?:\.[0-9]+)?)\s*(\S+)?\s*$/i;

export function parseSpec(source: string): ParseResult {
  const errors: ParseResult["errors"] = [];
  const lines = source.split("\n");
  let cursor = 0;

  // --- frontmatter ---
  const frontmatter: ParseResult["frontmatter"] = {};
  if (lines[0]?.trim() === "---") {
    let i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") {
      const m = /^(\w+):\s*(.*)$/.exec(lines[i] ?? "");
      if (m) (frontmatter as Record<string, string>)[m[1]!] = m[2]!.trim();
      i++;
    }
    if (i >= lines.length) {
      errors.push({ line: 1, message: "Unterminated frontmatter block" });
    }
    cursor = i + 1;
  }

  const bodyLines = lines.slice(cursor);
  const bodyOffset = cursor;

  const assertions: ParsedAssertion[] = [];
  const seen = new Set<string>();
  let order = 0;
  let i = 0;

  while (i < bodyLines.length) {
    const line = bodyLines[i] ?? "";
    const heading = ASSERTION_HEADING.exec(line);
    if (!heading) {
      i++;
      continue;
    }
    const lineNo = bodyOffset + i + 1;
    const humanId = heading[1]!;
    const title = heading[2]!;

    if (seen.has(humanId)) {
      errors.push({ line: lineNo, message: `Duplicate assertion id ${humanId}` });
    }
    seen.add(humanId);

    // status line: next non-empty line must be `status: X`
    let j = i + 1;
    while (j < bodyLines.length && (bodyLines[j] ?? "").trim() === "") j++;
    const statusMatch = STATUS_LINE.exec(bodyLines[j] ?? "");
    let status: AssertionStatus = "proposed";
    if (!statusMatch) {
      errors.push({ line: lineNo, message: `${humanId}: missing status line` });
    } else if (!STATUSES.includes(statusMatch[1] as AssertionStatus)) {
      errors.push({
        line: bodyOffset + j + 1,
        message: `${humanId}: invalid status "${statusMatch[1]}"`,
      });
    } else {
      status = statusMatch[1] as AssertionStatus;
    }

    // optional metric line, right after status: `metric: <key> <op> <target> [unit]`
    let afterStatus = statusMatch ? j + 1 : i + 1;
    let metric: ParsedMetric | null = null;
    let scan = afterStatus;
    while (scan < bodyLines.length && (bodyLines[scan] ?? "").trim() === "") scan++;
    const metricMatch = METRIC_LINE.exec(bodyLines[scan] ?? "");
    if (metricMatch) {
      const opMap: Record<string, Comparator> = { ">=": "gte", ">": "gt", "<=": "lte", "<": "lt", "==": "eq" };
      metric = { key: metricMatch[1]!, comparator: opMap[metricMatch[2]!]!, target: Number(metricMatch[3]), unit: metricMatch[4] ?? null };
      afterStatus = scan + 1;
    }

    // statement body: from after status (and metric) until the next heading
    const bodyStart = afterStatus;
    let k = bodyStart;
    const statementLines: string[] = [];
    while (k < bodyLines.length) {
      const bl = bodyLines[k] ?? "";
      if (ASSERTION_HEADING.test(bl) || OTHER_HEADING.test(bl)) break;
      statementLines.push(bl);
      k++;
    }
    const statement = statementLines.join("\n").trim();
    if (!statement) {
      errors.push({ line: lineNo, message: `${humanId}: empty statement` });
    }

    assertions.push({ humanId, title, status, statement, order: order++, metric });
    i = k;
  }

  return { frontmatter, bodyMd: bodyLines.join("\n").trim(), assertions, errors };
}
