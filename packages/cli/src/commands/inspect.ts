import pc from "picocolors";
import { loadSystem } from "../lib/loader.js";

interface InspectOptions {
  json: boolean;
  module?: string;
}

function parseArgs(args: string[]): { filePath: string; opts: InspectOptions } {
  const opts: InspectOptions = { json: false };
  let filePath = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--json":
        opts.json = true;
        break;
      case "--module": {
        const val = args[++i];
        if (val) {
          opts.module = val;
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
// Formatters
// ---------------------------------------------------------------------------

function formatFacts(facts: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(pc.bold("Facts:"));

  const entries = Object.entries(facts);
  if (entries.length === 0) {
    lines.push("  (none)");

    return lines.join("\n");
  }

  for (const [key, value] of entries) {
    const formatted = formatValue(value);
    lines.push(`  ${pc.cyan(key)} = ${formatted}`);
  }

  return lines.join("\n");
}

function formatConstraints(
  constraints: Array<{
    id: string;
    active: boolean;
    disabled: boolean;
    priority: number;
    hitCount: number;
    lastActiveAt: number | null;
  }>,
): string {
  const lines: string[] = [];
  lines.push(pc.bold("Constraints:"));

  if (constraints.length === 0) {
    lines.push("  (none)");

    return lines.join("\n");
  }

  for (const c of constraints) {
    const status = c.disabled
      ? pc.dim("disabled")
      : c.active
        ? pc.green("active")
        : pc.dim("inactive");
    const hits = c.hitCount > 0 ? pc.yellow(` (${c.hitCount} hits)`) : "";
    lines.push(
      `  ${pc.cyan(c.id)}  ${status}  priority=${c.priority}${hits}`,
    );
  }

  return lines.join("\n");
}

function formatResolverDefs(
  resolverDefs: Array<{ id: string; requirement: string }>,
  resolvers: Record<string, { state: string; error?: string; duration?: number }>,
): string {
  const lines: string[] = [];
  lines.push(pc.bold("Resolvers:"));

  if (resolverDefs.length === 0) {
    lines.push("  (none)");

    return lines.join("\n");
  }

  for (const def of resolverDefs) {
    const status = resolvers[def.id];
    const stateStr = status
      ? formatResolverState(status.state, status.error, status.duration)
      : pc.dim("idle");
    lines.push(
      `  ${pc.cyan(def.id)} → ${def.requirement}  ${stateStr}`,
    );
  }

  return lines.join("\n");
}

function formatUnmet(
  unmet: Array<{
    id: string;
    requirement: { type: string };
    fromConstraint: string;
  }>,
): string {
  const lines: string[] = [];
  lines.push(pc.bold("Unmet Requirements:"));

  if (unmet.length === 0) {
    lines.push(`  ${pc.green("(all requirements met)")}`);

    return lines.join("\n");
  }

  for (const u of unmet) {
    lines.push(
      `  ${pc.yellow(u.requirement.type)} (id: ${pc.dim(u.id)})  from ${pc.dim(u.fromConstraint)}`,
    );
  }

  return lines.join("\n");
}

function formatInflight(
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>,
): string {
  const lines: string[] = [];
  lines.push(pc.bold("Inflight:"));

  if (inflight.length === 0) {
    lines.push(`  ${pc.green("(none)")}`);

    return lines.join("\n");
  }

  const now = Date.now();
  for (const inf of inflight) {
    const elapsed = now - inf.startedAt;
    lines.push(
      `  ${pc.cyan(inf.resolverId)} → req ${pc.dim(inf.id)}  ${pc.yellow(`${elapsed}ms`)}`,
    );
  }

  return lines.join("\n");
}

function formatResolverState(
  state: string,
  error?: string,
  duration?: number,
): string {
  const dur = duration !== undefined ? ` ${duration}ms` : "";

  switch (state) {
    case "resolved":
      return pc.green(`resolved${dur}`);
    case "errored":
      return pc.red(`errored${dur}${error ? ` — ${error}` : ""}`);
    case "inflight":
      return pc.yellow("inflight");
    case "cancelled":
      return pc.dim("cancelled");
    default:
      return pc.dim(state);
  }
}

function formatValue(value: unknown): string {
  if (value === null) {
    return pc.dim("null");
  }
  if (value === undefined) {
    return pc.dim("undefined");
  }
  if (typeof value === "string") {
    return value.length > 60 ? `"${value.slice(0, 57)}..."` : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }

  return JSON.stringify(value).slice(0, 60);
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function findWarnings(inspection: {
  resolverDefs: Array<{ id: string; requirement: string }>;
  constraints: Array<{ id: string; active: boolean; disabled: boolean }>;
  unmet: Array<{ requirement: { type: string } }>;
}): string[] {
  const warnings: string[] = [];

  // Orphaned resolvers: resolver handles a type no constraint emits
  const constraintTypes = new Set<string>();
  // We can't know constraint requirement types from inspection alone,
  // but we can check unmet requirements
  const unmetTypes = new Set(inspection.unmet.map((u) => u.requirement.type));
  const resolverTypes = new Set(
    inspection.resolverDefs.map((r) => r.requirement),
  );

  // Resolver types not in unmet — might be orphaned (can't be sure without full constraint analysis)
  for (const def of inspection.resolverDefs) {
    if (def.requirement === "(predicate)") {
      continue;
    }
  }

  // Unmet requirements with no matching resolver
  for (const u of inspection.unmet) {
    const hasResolver = inspection.resolverDefs.some(
      (r) =>
        r.requirement === u.requirement.type || r.requirement === "(predicate)",
    );
    if (!hasResolver) {
      warnings.push(
        `No resolver for requirement type "${u.requirement.type}"`,
      );
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function inspectCommand(args: string[]) {
  const { filePath, opts } = parseArgs(args);

  if (!filePath) {
    console.error(
      "Usage: directive inspect <file> [--json] [--module <name>]",
    );
    process.exit(1);
  }

  const system = await loadSystem(filePath);

  if (!system.isRunning) {
    system.start();
  }

  const inspection = system.inspect();

  if (opts.json) {
    // Get facts as plain object
    const factsObj: Record<string, unknown> = {};
    if (system.facts) {
      for (const key of Object.keys(system.facts)) {
        try {
          factsObj[key] = system.facts[key];
        } catch {
          factsObj[key] = "(error reading)";
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          facts: factsObj,
          ...inspection,
        },
        null,
        2,
      ),
    );

    system.stop();

    return;
  }

  // Pretty output
  console.log();
  console.log(pc.bold(pc.cyan("Directive System Inspection")));
  console.log(pc.dim("─".repeat(40)));
  console.log();

  // Facts
  const factsObj: Record<string, unknown> = {};
  if (system.facts) {
    for (const key of Object.keys(system.facts)) {
      try {
        factsObj[key] = system.facts[key];
      } catch {
        factsObj[key] = "(error reading)";
      }
    }
  }
  console.log(formatFacts(factsObj));
  console.log();

  // Constraints
  console.log(formatConstraints(inspection.constraints));
  console.log();

  // Resolvers
  console.log(formatResolverDefs(inspection.resolverDefs, inspection.resolvers));
  console.log();

  // Unmet requirements
  console.log(formatUnmet(inspection.unmet));
  console.log();

  // Inflight
  if (inspection.inflight.length > 0) {
    console.log(formatInflight(inspection.inflight));
    console.log();
  }

  // Warnings
  const warnings = findWarnings(inspection);
  if (warnings.length > 0) {
    console.log(pc.bold(pc.yellow("Warnings:")));
    for (const w of warnings) {
      console.log(`  ${pc.yellow("⚠")} ${w}`);
    }
    console.log();
  }

  system.stop();
}
