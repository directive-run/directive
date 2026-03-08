import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { loadSystem } from "../lib/loader.js";

interface GraphOptions {
  ascii: boolean;
  open: boolean;
  output?: string;
}

function parseArgs(args: string[]): { filePath: string; opts: GraphOptions } {
  const opts: GraphOptions = { ascii: false, open: true };
  let filePath = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--ascii":
        opts.ascii = true;
        break;
      case "--no-open":
        opts.open = false;
        break;
      case "--output": {
        const val = args[++i];
        if (val) {
          opts.output = val;
        }
        break;
      }
      default:
        if (arg && !arg.startsWith("-") && !filePath) {
          filePath = arg;
        }
    }
  }

  return { filePath, opts };
}

// ---------------------------------------------------------------------------
// ASCII graph renderer
// ---------------------------------------------------------------------------

function renderAsciiGraph(inspection: {
  constraints: Array<{
    id: string;
    active: boolean;
    disabled: boolean;
    priority: number;
  }>;
  resolverDefs: Array<{ id: string; requirement: string }>;
  unmet: Array<{
    id: string;
    requirement: { type: string };
    fromConstraint: string;
  }>;
}): string {
  const lines: string[] = [];

  lines.push(pc.bold("Dependency Graph"));
  lines.push(pc.dim("═".repeat(50)));
  lines.push("");

  // Group by flow: constraint → requirement → resolver
  const constraintMap = new Map<
    string,
    { reqTypes: Set<string>; active: boolean; priority: number }
  >();

  for (const c of inspection.constraints) {
    constraintMap.set(c.id, {
      reqTypes: new Set(),
      active: c.active,
      priority: c.priority,
    });
  }

  // Map unmet requirements to constraints
  for (const u of inspection.unmet) {
    const entry = constraintMap.get(u.fromConstraint);
    if (entry) {
      entry.reqTypes.add(u.requirement.type);
    }
  }

  // Map resolvers to requirement types
  const resolversByType = new Map<string, string[]>();
  for (const r of inspection.resolverDefs) {
    if (!resolversByType.has(r.requirement)) {
      resolversByType.set(r.requirement, []);
    }
    resolversByType.get(r.requirement)!.push(r.id);
  }

  // Render constraint flows
  lines.push(pc.bold("Constraints → Requirements → Resolvers"));
  lines.push("");

  for (const [id, info] of constraintMap) {
    const status = info.active ? pc.green("●") : pc.dim("○");
    lines.push(`${status} ${pc.cyan(id)} (priority: ${info.priority})`);

    if (info.reqTypes.size > 0) {
      for (const reqType of info.reqTypes) {
        lines.push(`  └─▶ ${pc.yellow(reqType)}`);

        const resolvers = resolversByType.get(reqType) || [];
        if (resolvers.length > 0) {
          for (const r of resolvers) {
            lines.push(`      └─▶ ${pc.magenta(r)}`);
          }
        } else {
          lines.push(`      └─▶ ${pc.red("(no resolver)")}`);
        }
      }
    } else {
      lines.push(`  └─▶ ${pc.dim("(no active requirements)")}`);
    }

    lines.push("");
  }

  // Orphaned resolvers
  const usedResolvers = new Set<string>();
  for (const resolvers of resolversByType.values()) {
    for (const r of resolvers) {
      usedResolvers.add(r);
    }
  }

  const allResolverIds = inspection.resolverDefs.map((r) => r.id);
  const orphanedCount = allResolverIds.filter(
    (r) => !usedResolvers.has(r),
  ).length;

  if (orphanedCount > 0) {
    lines.push(pc.bold("Standalone Resolvers:"));
    for (const r of inspection.resolverDefs) {
      if (!usedResolvers.has(r.id)) {
        lines.push(
          `  ${pc.magenta(r.id)} handles ${pc.yellow(r.requirement)}`,
        );
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML graph renderer
// ---------------------------------------------------------------------------

function renderHtmlGraph(
  inspection: {
    constraints: Array<{
      id: string;
      active: boolean;
      disabled: boolean;
      priority: number;
      hitCount: number;
    }>;
    resolverDefs: Array<{ id: string; requirement: string }>;
    resolvers: Record<string, { state: string }>;
    unmet: Array<{
      id: string;
      requirement: { type: string };
      fromConstraint: string;
    }>;
  },
  facts: Record<string, unknown>,
): string {
  // Build nodes and edges for a simple SVG visualization
  const nodes: Array<{
    id: string;
    label: string;
    type: "fact" | "constraint" | "requirement" | "resolver";
    x: number;
    y: number;
    color: string;
  }> = [];
  const edges: Array<{ from: string; to: string }> = [];

  const colWidth = 220;
  const rowHeight = 50;
  const startX = 40;
  const startY = 60;

  // Column 1: Facts
  const factKeys = Object.keys(facts);
  for (let i = 0; i < factKeys.length; i++) {
    const key = factKeys[i]!;
    nodes.push({
      id: `fact-${key}`,
      label: key,
      type: "fact",
      x: startX,
      y: startY + i * rowHeight,
      color: "#3b82f6",
    });
  }

  // Column 2: Constraints
  for (let i = 0; i < inspection.constraints.length; i++) {
    const c = inspection.constraints[i]!;
    nodes.push({
      id: `constraint-${c.id}`,
      label: c.id,
      type: "constraint",
      x: startX + colWidth,
      y: startY + i * rowHeight,
      color: c.active ? "#22c55e" : "#6b7280",
    });
  }

  // Column 3: Requirements (from unmet)
  const reqTypes = new Set<string>();
  for (const u of inspection.unmet) {
    reqTypes.add(u.requirement.type);
  }
  let reqIdx = 0;
  for (const reqType of reqTypes) {
    nodes.push({
      id: `req-${reqType}`,
      label: reqType,
      type: "requirement",
      x: startX + colWidth * 2,
      y: startY + reqIdx * rowHeight,
      color: "#eab308",
    });
    reqIdx++;
  }

  // Column 4: Resolvers
  for (let i = 0; i < inspection.resolverDefs.length; i++) {
    const r = inspection.resolverDefs[i]!;
    nodes.push({
      id: `resolver-${r.id}`,
      label: r.id,
      type: "resolver",
      x: startX + colWidth * 3,
      y: startY + i * rowHeight,
      color: "#a855f7",
    });
  }

  // Edges: constraint → requirement
  for (const u of inspection.unmet) {
    edges.push({
      from: `constraint-${u.fromConstraint}`,
      to: `req-${u.requirement.type}`,
    });
  }

  // Edges: requirement → resolver
  for (const r of inspection.resolverDefs) {
    if (reqTypes.has(r.requirement)) {
      edges.push({
        from: `req-${r.requirement}`,
        to: `resolver-${r.id}`,
      });
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const svgWidth = startX + colWidth * 4 + 40;
  const maxY = Math.max(...nodes.map((n) => n.y)) + rowHeight + 20;

  const edgeSvg = edges
    .map((e) => {
      const from = nodeMap.get(e.from);
      const to = nodeMap.get(e.to);
      if (!from || !to) {
        return "";
      }

      return `<line x1="${from.x + 90}" y1="${from.y + 15}" x2="${to.x}" y2="${to.y + 15}" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>`;
    })
    .join("\n    ");

  const nodeSvg = nodes
    .map(
      (n) =>
        `<g>
      <rect x="${n.x}" y="${n.y}" width="180" height="30" rx="6" fill="${n.color}" opacity="0.15" stroke="${n.color}" stroke-width="1.5"/>
      <text x="${n.x + 90}" y="${n.y + 19}" text-anchor="middle" font-size="12" font-family="monospace" fill="${n.color}">${escapeHtml(n.label)}</text>
    </g>`,
    )
    .join("\n    ");

  // Column headers
  const headers = ["Facts", "Constraints", "Requirements", "Resolvers"];
  const headerSvg = headers
    .map(
      (h, i) =>
        `<text x="${startX + i * colWidth + 90}" y="35" text-anchor="middle" font-size="14" font-weight="bold" font-family="system-ui" fill="#e2e8f0">${h}</text>`,
    )
    .join("\n    ");

  return `<!DOCTYPE html>
<html>
<head>
  <title>Directive System Graph</title>
  <style>
    body { margin: 0; background: #0f172a; display: flex; justify-content: center; padding: 20px; }
    svg { max-width: 100%; }
  </style>
</head>
<body>
  <svg width="${svgWidth}" height="${maxY}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
      </marker>
    </defs>
    ${headerSvg}
    ${edgeSvg}
    ${nodeSvg}
  </svg>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function graphCommand(args: string[]) {
  const { filePath, opts } = parseArgs(args);

  if (!filePath) {
    console.error("Usage: directive graph <file> [--ascii] [--no-open] [--output <path>]");
    process.exit(1);
  }

  const system = await loadSystem(filePath);

  if (!system.isRunning) {
    system.start();
  }

  const inspection = system.inspect();

  if (opts.ascii) {
    console.log(renderAsciiGraph(inspection));
    system.stop();

    return;
  }

  // HTML output
  const factsObj: Record<string, unknown> = {};
  if (system.facts) {
    for (const key of Object.keys(system.facts)) {
      try {
        factsObj[key] = system.facts[key];
      } catch {
        factsObj[key] = null;
      }
    }
  }

  const html = renderHtmlGraph(inspection, factsObj);
  const outputPath = opts.output || join(process.cwd(), ".directive-graph.html");

  writeFileSync(outputPath, html, "utf-8");
  console.log(`${pc.green("Generated")} ${pc.dim(outputPath)}`);

  if (opts.open) {
    try {
      const { execFile } = await import("node:child_process");
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      execFile(openCmd, [outputPath]);
      console.log(pc.dim("Opened in browser."));
    } catch {
      console.log(
        pc.dim(`Open ${outputPath} in your browser to view the graph.`),
      );
    }
  }

  system.stop();
}
