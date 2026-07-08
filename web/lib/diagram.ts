import type { DiagramDetail, DiagramNode, NodeStatus } from "./api";

const esc = (s: string) => s.replace(/["\n]/g, " ").slice(0, 80).trim() || " ";

// Shape encodes kind; a node with a child diagram gets the subroutine box to
// signal "drill down", regardless of kind.
function shape(n: DiagramNode): string {
  const l = `"${esc(n.label)}"`;
  if (n.childDiagramKey) return `${n.key}[[${l}]]`;
  switch (n.kind) {
    case "decision": return `${n.key}{${l}}`;
    case "trigger": return `${n.key}([${l}])`;
    case "terminal": return `${n.key}((${l}))`;
    case "subflow": return `${n.key}[[${l}]]`;
    default: return `${n.key}[${l}]`;
  }
}

export function toMermaid(d: DiagramDetail): string {
  const lines = [`flowchart ${d.diagram.direction}`];
  if (d.nodes.length === 0) lines.push('  _empty[" "]:::none');
  for (const n of d.nodes) lines.push(`  ${shape(n)}:::${n.status}`);
  for (const e of d.edges) lines.push(e.label ? `  ${e.fromKey} -->|"${esc(e.label)}"| ${e.toKey}` : `  ${e.fromKey} --> ${e.toKey}`);
  lines.push("classDef verified fill:#14351f,stroke:#4ade80,color:#e6e9ef;");
  lines.push("classDef drifted fill:#3a1414,stroke:#f87171,color:#e6e9ef;");
  lines.push("classDef progress fill:#33290f,stroke:#fbbf24,color:#e6e9ef;");
  lines.push("classDef none fill:#1b2130,stroke:#3a4256,color:#cdd3e0;");
  return lines.join("\n");
}

export const STATUS_COLOR: Record<NodeStatus, string> = { verified: "var(--green)", drifted: "var(--red)", progress: "var(--amber)", none: "var(--muted)" };
export const STATUS_LABEL: Record<NodeStatus, string> = { verified: "verified", drifted: "drifted", progress: "in progress", none: "no spec" };
