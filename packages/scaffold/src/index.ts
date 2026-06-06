/**
 * `@directive-run/scaffold` — pure source-string generators for
 * Directive modules and orchestrators.
 *
 * Consumed by:
 *
 * - `@directive-run/cli` (its `directive new <name>` command writes
 *   the returned string to disk).
 * - `@directive-run/mcp` (its `generate_module` MCP tool returns the
 *   string to the AI client without ever touching disk).
 *
 * This package is the single source of truth for what a Directive
 * module skeleton looks like. Zero runtime dependencies; pure
 * functions in / strings out.
 */

/** Valid sections a generated module can include. */
export const MODULE_SECTIONS = [
  "derive",
  "events",
  "constraints",
  "resolvers",
  "effects",
] as const;

export type ModuleSection = (typeof MODULE_SECTIONS)[number];

/** Kinds the scaffold can generate. */
export const SCAFFOLD_KINDS = ["module", "orchestrator"] as const;
export type ScaffoldKind = (typeof SCAFFOLD_KINDS)[number];

/** Canonical name validator. Mirrors the CLI's existing check. */
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Validate a module / orchestrator name. Returns `true` if the name
 * is acceptable, or a human-readable error string explaining why
 * not. Never throws.
 */
export function validateModuleName(name: string): true | string {
  if (typeof name !== "string" || name.length === 0) {
    return "name must be a non-empty string";
  }
  if (name.length > 64) {
    return "name must be 64 characters or fewer";
  }
  if (!NAME_RE.test(name)) {
    return "name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens";
  }
  return true;
}

function assertValidName(name: string): void {
  const ok = validateModuleName(name);
  if (ok !== true) {
    throw new Error(`Invalid name "${name}": ${ok}`);
  }
}

/**
 * Convert a kebab-case name to camelCase for the exported binding.
 *
 * @example
 *   toCamelCase("traffic-light")  // "trafficLight"
 */
export function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => (c as string).toUpperCase());
}

/**
 * Generate the suggested file names for a scaffolded artifact.
 *
 * @example
 *   suggestFileNames("traffic-light", "module")
 *   // { sourceFileName: "traffic-light.ts", testFileName: "traffic-light.test.ts" }
 */
export function suggestFileNames(
  name: string,
  _kind: ScaffoldKind,
): { sourceFileName: string; testFileName: string } {
  assertValidName(name);
  return {
    sourceFileName: `${name}.ts`,
    testFileName: `${name}.test.ts`,
  };
}

/**
 * Packages a generated artifact needs the consumer to install before
 * the source compiles + runs. Stable order, no duplicates.
 */
export function requiredPackages(kind: ScaffoldKind): string[] {
  if (kind === "orchestrator") {
    return ["@directive-run/core", "@directive-run/ai"];
  }
  return ["@directive-run/core"];
}

/**
 * Paired output returned by every scaffold generator: the library
 * module the consumer was asking for, PLUS a runnable driver that
 * wraps it in `createSystem` + lifecycle calls. The MCP `playground_link`
 * tool ships both as separate files (`src/<name>.ts` + `src/main.ts`) so
 * StackBlitz boots a project that actually logs facts to the terminal
 * instead of an empty `export` statement.
 *
 * When the module source already contains a `createSystem(...)` call,
 * the generator skips emitting a runner and returns `runnerSource: null`
 * with `runnable: true`. The MCP tool then ships a single-file playground.
 */
export interface GeneratedScaffold {
  /** The module / library source — the artifact the consumer originally asked for. */
  moduleSource: string;
  /**
   * A driver that imports `moduleSource`, builds a system, starts it,
   * settles, logs facts. Null when `moduleSource` is already runnable.
   */
  runnerSource: string | null;
  /** Conventional filenames so the consumer can drop the strings on disk. */
  suggestedFilenames: { module: string; runner: string };
  /**
   * True when `moduleSource` already calls `createSystem` — the runner
   * is redundant and was not generated.
   */
  runnable: boolean;
}

// We say a source is "already runnable" only when it calls `.start()`
// on its system — exporting a system constant via `createSystem(...)`
// alone is library shape (no driver, no dispatch, no log). The
// orchestrator template, for example, has a `createSystem` export but
// still needs the paired runner to actually log anything.
const RUNNABLE_MARKERS = /system\.start\s*\(/;

/**
 * Pull `export const <bindingName> = createModule("<kebabName>", ...)`
 * out of a module source. Returns null when the regex doesn't match;
 * callers fall back to a generic runner template.
 */
function extractModuleBinding(
  source: string,
): { bindingName: string; kebabName: string } | null {
  const match = source.match(
    /export\s+const\s+(\w+)\s*=\s*createModule\(\s*["']([^"']+)["']/,
  );
  if (!match) {
    return null;
  }
  return { bindingName: match[1]!, kebabName: match[2]! };
}

/**
 * Pull event keys out of a `events: { … }` block. Order is preserved.
 * Returns [] when no events block is present — the runner then just
 * logs initial + settled facts and quits.
 */
function extractEventKeys(source: string): string[] {
  // Find the events: { ... } block at the top of the schema OR inside
  // createModule({ ... events: { ... } }). The simplest robust pass is
  // to find any `events: {` then capture keys until the matching `}`.
  const eventsBlockStart = source.search(/\bevents\s*:\s*\{/);
  if (eventsBlockStart === -1) {
    return [];
  }
  const openBrace = source.indexOf("{", eventsBlockStart);
  if (openBrace === -1) {
    return [];
  }
  // Walk forward, brace-balanced, until the matching close.
  let depth = 0;
  let i = openBrace;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    i += 1;
  }
  const block = source.slice(openBrace + 1, i);
  // Pull top-level keys (depth-0 identifiers at start of line, before `:`).
  const keys: string[] = [];
  let lineStart = 0;
  let braceDepth = 0;
  for (let j = 0; j < block.length; j++) {
    const ch = block[j];
    if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      braceDepth -= 1;
    } else if (ch === "\n") {
      const line = block.slice(lineStart, j).trim();
      lineStart = j + 1;
      if (braceDepth !== 0) {
        continue;
      }
      const keyMatch = line.match(/^(\w+)\s*:/);
      if (keyMatch) {
        keys.push(keyMatch[1]!);
      }
    }
  }
  return keys;
}

/**
 * Emit the runnable driver. Imports the module by its detected binding
 * name from `./<kebabName>.js` (the conventional ESM extension StackBlitz
 * + tsx both resolve), instantiates a system, starts it, dispatches each
 * detected event with an empty payload (so users see how the event
 * surface is wired — TS errors guide them to fill in real shapes), then
 * settles and logs.
 *
 * When the source has no detectable binding, returns a generic template
 * the user can hand-edit. Detection failure is rare but should never
 * crash the generator.
 */
export function generateRunner(moduleSource: string): string {
  if (RUNNABLE_MARKERS.test(moduleSource)) {
    // Caller should have skipped this; emit a stub so a stray call
    // still produces compileable output.
    return [
      "// Module source already creates its own system — no runner emitted.",
      "// See the module file for the runnable entry point.",
      "",
    ].join("\n");
  }

  const binding = extractModuleBinding(moduleSource);
  const events = extractEventKeys(moduleSource);

  const bindingName = binding?.bindingName ?? "myModule";
  const kebabName = binding?.kebabName ?? "module";

  const lines: string[] = [];
  lines.push(`import { createSystem } from "@directive-run/core";`);
  lines.push(`import { ${bindingName} } from "./${kebabName}.js";`);
  lines.push("");
  lines.push(`const system = createSystem({ module: ${bindingName} });`);
  lines.push("system.start();");
  lines.push("");
  lines.push(`console.log("[start] facts:", system.facts);`);
  lines.push("");

  if (events.length > 0) {
    lines.push("// Dispatch each detected event with an empty payload so you");
    lines.push("// can see the wiring. Fill in real payloads to drive the");
    lines.push("// module from the StackBlitz terminal.");
    for (const eventName of events) {
      lines.push(
        `// @ts-expect-error — fill in the real payload shape for "${eventName}"`,
      );
      lines.push(`system.events.${eventName}({});`);
    }
    lines.push("");
  } else {
    lines.push("// No events detected in the module — extend this file to");
    lines.push("// dispatch requirements or mutate facts directly.");
    lines.push("");
  }

  lines.push("// Wait for resolvers, async constraints, and effects to drain.");
  lines.push("await system.settle();");
  lines.push("");
  lines.push(`console.log("[settled] facts:", system.facts);`);
  lines.push("system.destroy();");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate a Directive module source file from a kebab-case name and
 * a list of sections to include. Returns paired output: the library
 * `moduleSource` PLUS a `runnerSource` driver that wraps it in
 * `createSystem` + `start` + dispatch + settle + log, so a downstream
 * consumer (the MCP `playground_link` tool, the CLI, a docs example)
 * can ship both files into a real running project.
 *
 * `sections` defaults to every supported section.
 */
export function generateModule(
  name: string,
  sections: readonly ModuleSection[] = MODULE_SECTIONS,
): GeneratedScaffold {
  assertValidName(name);

  const camelName = toCamelCase(name);
  const includeDerive = sections.includes("derive");
  const includeEvents = sections.includes("events");
  const includeConstraints = sections.includes("constraints");
  const includeResolvers = sections.includes("resolvers");
  const includeEffects = sections.includes("effects");

  const imports = ["type ModuleSchema", "createModule", "t"];

  let code = `import { ${imports.join(", ")} } from "@directive-run/core";\n\n`;

  // Schema
  code += "const schema = {\n";
  code += "  facts: {\n";
  code += "    // Add your facts here\n";
  code += "    status: t.string(),\n";
  code += "  },\n";

  if (includeDerive) {
    code += "  derivations: {\n";
    code += "    // Add derivation types here\n";
    code += "    isReady: t.boolean(),\n";
    code += "  },\n";
  }

  if (includeEvents) {
    code += "  events: {\n";
    code += "    // Add event shapes here\n";
    code += "    setStatus: { value: t.string() },\n";
    code += "  },\n";
  }

  if (includeConstraints || includeResolvers) {
    code += "  requirements: {\n";
    code += "    // Add requirement shapes here\n";
    code += "    PROCESS: { input: t.string() },\n";
    code += "  },\n";
  }

  code += "} satisfies ModuleSchema;\n\n";

  // Module
  code += `export const ${camelName} = createModule("${name}", {\n`;
  code += "  schema,\n\n";

  code += "  init: (facts) => {\n";
  code += `    facts.status = "idle";\n`;
  code += "  },\n";

  if (includeDerive) {
    code += "\n  derive: {\n";
    code += `    isReady: (facts) => facts.status === "ready",\n`;
    code += "  },\n";
  }

  if (includeEvents) {
    code += "\n  events: {\n";
    code += "    setStatus: (facts, { value }) => {\n";
    code += "      facts.status = value;\n";
    code += "    },\n";
    code += "  },\n";
  }

  if (includeConstraints) {
    code += "\n  constraints: {\n";
    code += "    needsProcessing: {\n";
    code += "      priority: 100,\n";
    code += `      when: (facts) => facts.status === "pending",\n`;
    code += "      require: (facts) => ({\n";
    code += `        type: "PROCESS",\n`;
    code += "        input: facts.status,\n";
    code += "      }),\n";
    code += "    },\n";
    code += "  },\n";
  }

  if (includeResolvers) {
    code += "\n  resolvers: {\n";
    code += "    process: {\n";
    code += `      requirement: "PROCESS",\n`;
    code += "      resolve: async (req, context) => {\n";
    code += "        // Implement resolution logic here\n";
    code += `        context.facts.status = "done";\n`;
    code += "      },\n";
    code += "    },\n";
    code += "  },\n";
  }

  if (includeEffects) {
    code += "\n  effects: {\n";
    code += "    logChange: {\n";
    code += `      deps: ["status"],\n`;
    code += "      run: (facts, prev) => {\n";
    code += "        if (prev && prev.status !== facts.status) {\n";
    code +=
      "          console.log(`Status: ${prev.status} → ${facts.status}`);\n";
    code += "        }\n";
    code += "      },\n";
    code += "    },\n";
    code += "  },\n";
  }

  code += "});\n";

  const runnable = RUNNABLE_MARKERS.test(code);
  return {
    moduleSource: code,
    runnerSource: runnable ? null : generateRunner(code),
    suggestedFilenames: { module: `${name}.ts`, runner: "main.ts" },
    runnable,
  };
}

/**
 * Generate a Directive AI-orchestrator module source file from a
 * kebab-case name. Returns paired output (see {@link generateModule}).
 *
 * The generated module includes an `AgentStatus` type, full schema
 * with input/output/status/error/tokens facts, derivations, events,
 * a single `RUN_AGENT` requirement and resolver, plus commented-out
 * memory + orchestrator configuration the consumer fills in.
 */
export function generateOrchestrator(name: string): GeneratedScaffold {
  assertValidName(name);

  const camelName = toCamelCase(name);

  const moduleSource = `import { type ModuleSchema, createModule, createSystem, t } from "@directive-run/core";
import {
  createAgentOrchestrator,
  createAgentMemory,
  createSlidingWindowStrategy,
} from "@directive-run/ai";

// ============================================================================
// Types
// ============================================================================

type AgentStatus = "idle" | "thinking" | "done" | "error";

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    input: t.string(),
    output: t.string(),
    status: t.string<AgentStatus>(),
    error: t.string(),
    totalTokens: t.number(),
  },
  derivations: {
    isThinking: t.boolean(),
    hasOutput: t.boolean(),
  },
  events: {
    setInput: { value: t.string() },
    requestRun: {},
    reset: {},
  },
  requirements: {
    RUN_AGENT: { input: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const ${camelName} = createModule("${name}", {
  schema,

  init: (facts) => {
    facts.input = "";
    facts.output = "";
    facts.status = "idle";
    facts.error = "";
    facts.totalTokens = 0;
  },

  derive: {
    isThinking: (facts) => facts.status === "thinking",
    hasOutput: (facts) => facts.output !== "",
  },

  events: {
    setInput: (facts, { value }) => {
      facts.input = value;
    },
    requestRun: (facts) => {
      facts.status = "thinking";
      facts.output = "";
      facts.error = "";
    },
    reset: (facts) => {
      facts.input = "";
      facts.output = "";
      facts.status = "idle";
      facts.error = "";
      facts.totalTokens = 0;
    },
  },

  constraints: {
    needsRun: {
      priority: 100,
      when: (facts) => facts.status === "thinking",
      require: (facts) => ({
        type: "RUN_AGENT",
        input: facts.input,
      }),
    },
  },

  resolvers: {
    runAgent: {
      requirement: "RUN_AGENT",
      timeout: 30000,
      resolve: async (req, context) => {
        // TODO: Replace with your agent runner
        const result = \`Echo: \${req.input}\`;

        context.facts.output = result;
        context.facts.status = "done";
      },
    },
  },
});

// ============================================================================
// AI Features
// ============================================================================

export const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy(),
  strategyConfig: { maxMessages: 30, preserveRecentCount: 6 },
  autoManage: true,
});

// TODO: Add your agent runner and configure the orchestrator
// export const orchestrator = createAgentOrchestrator({
//   runner: yourAgentRunner,
//   maxTokenBudget: 50000,
//   memory,
//   guardrails: {
//     input: [],
//     output: [],
//   },
// });

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: ${camelName},
});
`;

  const runnable = RUNNABLE_MARKERS.test(moduleSource);
  return {
    moduleSource,
    runnerSource: runnable ? null : generateRunner(moduleSource),
    suggestedFilenames: { module: `${name}.ts`, runner: "main.ts" },
    runnable,
  };
}
