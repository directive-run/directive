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
 * Generate a Directive module source file from a kebab-case name and
 * a list of sections to include. Returns the source as a string;
 * does not touch the filesystem.
 *
 * `sections` defaults to every supported section.
 */
export function generateModule(
  name: string,
  sections: readonly ModuleSection[] = MODULE_SECTIONS,
): string {
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

  return code;
}

/**
 * Generate a Directive AI-orchestrator module source file from a
 * kebab-case name. Returns the source as a string; does not touch
 * the filesystem.
 *
 * The generated module includes an `AgentStatus` type, full schema
 * with input/output/status/error/tokens facts, derivations, events,
 * a single `RUN_AGENT` requirement and resolver, plus commented-out
 * memory + orchestrator configuration the consumer fills in.
 */
export function generateOrchestrator(name: string): string {
  assertValidName(name);

  const camelName = toCamelCase(name);

  return `import { type ModuleSchema, createModule, createSystem, t } from "@directive-run/core";
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
}
