import * as p from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import pc from "picocolors";

interface NewOptions {
  with: string[];
  minimal: boolean;
  dir: string;
}

function parseArgs(args: string[]): NewOptions {
  const opts: NewOptions = {
    with: [],
    minimal: false,
    dir: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--with": {
        const val = args[++i];
        if (val) {
          opts.with = val.split(",").map((s) => s.trim());
        }
        break;
      }
      case "--minimal":
        opts.minimal = true;
        break;
      case "--dir": {
        const val = args[++i];
        if (val) {
          opts.dir = val;
        }
        break;
      }
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Module generator
// ---------------------------------------------------------------------------

type Section = "derive" | "events" | "constraints" | "resolvers" | "effects";

const ALL_SECTIONS: Section[] = [
  "derive",
  "events",
  "constraints",
  "resolvers",
  "effects",
];

function generateModule(
  name: string,
  sections: Section[],
): string {
  const camelName = toCamelCase(name);
  const hasConstraints = sections.includes("constraints");
  const hasResolvers = sections.includes("resolvers");

  const imports = ["type ModuleSchema", "createModule", "t"];

  let code = `import { ${imports.join(", ")} } from "@directive-run/core";\n\n`;

  // Schema
  code += `const schema = {\n`;
  code += `  facts: {\n`;
  code += `    // Add your facts here\n`;
  code += `    status: t.string(),\n`;
  code += `  },\n`;

  if (sections.includes("derive")) {
    code += `  derivations: {\n`;
    code += `    // Add derivation types here\n`;
    code += `    isReady: t.boolean(),\n`;
    code += `  },\n`;
  }

  if (sections.includes("events")) {
    code += `  events: {\n`;
    code += `    // Add event shapes here\n`;
    code += `    setStatus: { value: t.string() },\n`;
    code += `  },\n`;
  }

  if (hasConstraints || hasResolvers) {
    code += `  requirements: {\n`;
    code += `    // Add requirement shapes here\n`;
    code += `    PROCESS: { input: t.string() },\n`;
    code += `  },\n`;
  }

  code += `} satisfies ModuleSchema;\n\n`;

  // Module
  code += `export const ${camelName} = createModule("${name}", {\n`;
  code += `  schema,\n\n`;

  code += `  init: (facts) => {\n`;
  code += `    facts.status = "idle";\n`;
  code += `  },\n`;

  if (sections.includes("derive")) {
    code += `\n  derive: {\n`;
    code += `    isReady: (facts) => facts.status === "ready",\n`;
    code += `  },\n`;
  }

  if (sections.includes("events")) {
    code += `\n  events: {\n`;
    code += `    setStatus: (facts, { value }) => {\n`;
    code += `      facts.status = value;\n`;
    code += `    },\n`;
    code += `  },\n`;
  }

  if (hasConstraints) {
    code += `\n  constraints: {\n`;
    code += `    needsProcessing: {\n`;
    code += `      priority: 100,\n`;
    code += `      when: (facts) => facts.status === "pending",\n`;
    code += `      require: (facts) => ({\n`;
    code += `        type: "PROCESS",\n`;
    code += `        input: facts.status,\n`;
    code += `      }),\n`;
    code += `    },\n`;
    code += `  },\n`;
  }

  if (hasResolvers) {
    code += `\n  resolvers: {\n`;
    code += `    process: {\n`;
    code += `      requirement: "PROCESS",\n`;
    code += `      resolve: async (req, context) => {\n`;
    code += `        // Implement resolution logic here\n`;
    code += `        context.facts.status = "done";\n`;
    code += `      },\n`;
    code += `    },\n`;
    code += `  },\n`;
  }

  if (sections.includes("effects")) {
    code += `\n  effects: {\n`;
    code += `    logChange: {\n`;
    code += `      deps: ["status"],\n`;
    code += `      run: (facts, prev) => {\n`;
    code += `        if (prev && prev.status !== facts.status) {\n`;
    code += `          console.log(\`Status: \${prev.status} → \${facts.status}\`);\n`;
    code += `        }\n`;
    code += `      },\n`;
    code += `    },\n`;
    code += `  },\n`;
  }

  code += `});\n`;

  return code;
}

// ---------------------------------------------------------------------------
// Orchestrator generator
// ---------------------------------------------------------------------------

function generateOrchestrator(name: string): string {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function writeFile(filePath: string, content: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf-8");
}

function findModulesDir(dir: string): string {
  return join(dir, "src");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function newModuleCommand(name: string, args: string[]) {
  const opts = parseArgs(args);

  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      `Invalid module name: ${name || "(none)"}\n` +
        "Must start with a letter, use lowercase letters, numbers, and hyphens.",
    );
    process.exit(1);
  }

  let sections: Section[];

  if (opts.minimal) {
    sections = [];
  } else if (opts.with.length > 0) {
    sections = opts.with.filter((s) =>
      ALL_SECTIONS.includes(s as Section),
    ) as Section[];
  } else {
    sections = ALL_SECTIONS;
  }

  const targetDir = findModulesDir(opts.dir);
  const filePath = join(targetDir, `${name}.ts`);

  if (existsSync(filePath)) {
    console.error(`File already exists: ${relative(opts.dir, filePath)}`);
    process.exit(1);
  }

  const content = generateModule(name, sections);
  writeFile(filePath, content);

  const rel = relative(opts.dir, filePath);
  console.log(`${pc.green("Created")} ${pc.dim(rel)}`);

  if (sections.length === 0) {
    console.log(pc.dim("  Minimal module (schema + init only)"));
  } else {
    console.log(pc.dim(`  Sections: ${sections.join(", ")}`));
  }
}

export async function newOrchestratorCommand(name: string, args: string[]) {
  const opts = parseArgs(args);

  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      `Invalid orchestrator name: ${name || "(none)"}\n` +
        "Must start with a letter, use lowercase letters, numbers, and hyphens.",
    );
    process.exit(1);
  }

  const targetDir = findModulesDir(opts.dir);
  const filePath = join(targetDir, `${name}.ts`);

  if (existsSync(filePath)) {
    console.error(`File already exists: ${relative(opts.dir, filePath)}`);
    process.exit(1);
  }

  const content = generateOrchestrator(name);
  writeFile(filePath, content);

  const rel = relative(opts.dir, filePath);
  console.log(`${pc.green("Created")} ${pc.dim(rel)}`);
  console.log(pc.dim("  AI orchestrator with memory, guardrails, and streaming"));
}
