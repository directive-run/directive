import * as p from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import pc from "picocolors";
import { CLI_NAME } from "../lib/constants.js";

interface InitOptions {
  template?: string;
  dir: string;
  noInteractive: boolean;
}

function parseArgs(args: string[]): InitOptions {
  const opts: InitOptions = {
    dir: process.cwd(),
    noInteractive: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--template": {
        const val = args[++i];
        if (val) {
          opts.template = val;
        }
        break;
      }
      case "--dir": {
        const val = args[++i];
        if (val) {
          opts.dir = val;
        }
        break;
      }
      case "--no-interactive":
        opts.noInteractive = true;
        break;
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(join(dir, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

function installCmd(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm add ${pkg}`;
    case "yarn":
      return `yarn add ${pkg}`;
    case "bun":
      return `bun add ${pkg}`;
    default:
      return `npm install ${pkg}`;
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type TemplateId = "counter" | "auth-flow" | "ai-orchestrator";

interface TemplateConfig {
  id: TemplateId;
  label: string;
  hint: string;
  files: Array<{ path: string; content: string }>;
  deps: string[];
}

function getTemplates(moduleName: string): Record<TemplateId, TemplateConfig> {
  return {
    counter: {
      id: "counter",
      label: "Counter (minimal)",
      hint: "schema + init + derive + events — simplest starting point",
      files: [
        {
          path: `src/${moduleName}.ts`,
          content: generateCounterModule(moduleName),
        },
        {
          path: "src/main.ts",
          content: generateCounterMain(moduleName),
        },
      ],
      deps: ["@directive-run/core"],
    },
    "auth-flow": {
      id: "auth-flow",
      label: "Auth flow (constraints + resolvers)",
      hint: "login flow with constraints, resolvers, retry, and effects",
      files: [
        {
          path: `src/${moduleName}.ts`,
          content: generateAuthModule(moduleName),
        },
        {
          path: "src/main.ts",
          content: generateAuthMain(moduleName),
        },
      ],
      deps: ["@directive-run/core"],
    },
    "ai-orchestrator": {
      id: "ai-orchestrator",
      label: "AI orchestrator",
      hint: "agent orchestrator with guardrails and streaming",
      files: [
        {
          path: `src/${moduleName}.ts`,
          content: generateAIModule(moduleName),
        },
        {
          path: "src/main.ts",
          content: generateAIMain(moduleName),
        },
      ],
      deps: ["@directive-run/core", "@directive-run/ai"],
    },
  };
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function generateCounterModule(name: string): string {
  const camelName = toCamelCase(name);

  return `import { type ModuleSchema, createModule, t } from "@directive-run/core";

const schema = {
  facts: {
    count: t.number(),
    label: t.string(),
  },
  derivations: {
    isEven: t.boolean(),
    display: t.string(),
  },
  events: {
    increment: {},
    decrement: {},
    reset: {},
    setLabel: { value: t.string() },
  },
} satisfies ModuleSchema;

export const ${camelName} = createModule("${name}", {
  schema,

  init: (facts) => {
    facts.count = 0;
    facts.label = "${name}";
  },

  derive: {
    isEven: (facts) => facts.count % 2 === 0,
    display: (facts) => \`\${facts.label}: \${facts.count}\`,
  },

  events: {
    increment: (facts) => {
      facts.count++;
    },
    decrement: (facts) => {
      facts.count--;
    },
    reset: (facts) => {
      facts.count = 0;
    },
    setLabel: (facts, { value }) => {
      facts.label = value;
    },
  },
});
`;
}

function generateCounterMain(name: string): string {
  const camelName = toCamelCase(name);

  return `import { createSystem } from "@directive-run/core";
import { ${camelName} } from "./${name}.js";

const system = createSystem({
  module: ${camelName},
});

system.start();

// Read facts and derivations
console.log("count:", system.facts.count);
console.log("display:", system.read("display"));

// Dispatch events
system.events.increment();
console.log("after increment:", system.facts.count);

// Subscribe to changes
system.subscribe(["count"], () => {
  console.log("count changed:", system.facts.count);
});

system.events.increment();
system.events.increment();

export default system;
`;
}

function generateAuthModule(name: string): string {
  const camelName = toCamelCase(name);

  return `import { type ModuleSchema, createModule, t } from "@directive-run/core";

type AuthStatus = "idle" | "authenticating" | "authenticated" | "expired";

const schema = {
  facts: {
    email: t.string(),
    password: t.string(),
    token: t.string(),
    status: t.string<AuthStatus>(),
    error: t.string(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
    canLogin: t.boolean(),
  },
  events: {
    setEmail: { value: t.string() },
    setPassword: { value: t.string() },
    requestLogin: {},
    logout: {},
  },
  requirements: {
    LOGIN: { email: t.string(), password: t.string() },
  },
} satisfies ModuleSchema;

export const ${camelName} = createModule("${name}", {
  schema,

  init: (facts) => {
    facts.email = "";
    facts.password = "";
    facts.token = "";
    facts.status = "idle";
    facts.error = "";
  },

  derive: {
    isAuthenticated: (facts) => facts.status === "authenticated",
    canLogin: (facts) => {
      return (
        facts.email.trim() !== "" &&
        facts.password.trim() !== "" &&
        (facts.status === "idle" || facts.status === "expired")
      );
    },
  },

  events: {
    setEmail: (facts, { value }) => {
      facts.email = value;
    },
    setPassword: (facts, { value }) => {
      facts.password = value;
    },
    requestLogin: (facts) => {
      facts.status = "authenticating";
      facts.error = "";
    },
    logout: (facts) => {
      facts.token = "";
      facts.status = "idle";
    },
  },

  constraints: {
    needsLogin: {
      priority: 100,
      when: (facts) => facts.status === "authenticating",
      require: (facts) => ({
        type: "LOGIN",
        email: facts.email,
        password: facts.password,
      }),
    },
  },

  resolvers: {
    login: {
      requirement: "LOGIN",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        // Replace with real auth API call
        await new Promise((resolve) => setTimeout(resolve, 500));

        const token = \`token_\${Date.now()}\`;
        context.facts.token = token;
        context.facts.status = "authenticated";
      },
    },
  },

  effects: {
    logStatusChange: {
      deps: ["status"],
      run: (facts, prev) => {
        if (prev && prev.status !== facts.status) {
          console.log(\`Auth status: \${prev.status} → \${facts.status}\`);
        }
      },
    },
  },
});
`;
}

function generateAuthMain(name: string): string {
  const camelName = toCamelCase(name);

  return `import { createSystem } from "@directive-run/core";
import { ${camelName} } from "./${name}.js";

const system = createSystem({
  module: ${camelName},
});

system.start();

// Set credentials and login
system.events.setEmail({ value: "user@example.com" });
system.events.setPassword({ value: "password123" });
system.events.requestLogin();

// Wait for auth to complete
await system.settle();

console.log("authenticated:", system.read("isAuthenticated"));
console.log("token:", system.facts.token);

export default system;
`;
}

function generateAIModule(name: string): string {
  const camelName = toCamelCase(name);

  return `import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  createAgentOrchestrator,
  createAgentMemory,
  createSlidingWindowStrategy,
} from "@directive-run/ai";

// ============================================================================
// Module — state management
// ============================================================================

type AgentStatus = "idle" | "thinking" | "done" | "error";

const schema = {
  facts: {
    input: t.string(),
    output: t.string(),
    status: t.string<AgentStatus>(),
    error: t.string(),
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

export const ${camelName} = createModule("${name}", {
  schema,

  init: (facts) => {
    facts.input = "";
    facts.output = "";
    facts.status = "idle";
    facts.error = "";
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
        // Replace with your agent runner (e.g., Anthropic, OpenAI)
        const result = \`Echo: \${req.input}\`;

        context.facts.output = result;
        context.facts.status = "done";
      },
    },
  },
});

// ============================================================================
// Orchestrator — optional AI features
// ============================================================================

export const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy(),
  strategyConfig: { maxMessages: 30, preserveRecentCount: 6 },
  autoManage: true,
});

// Uncomment to add orchestrator features:
// export const orchestrator = createAgentOrchestrator({
//   runner: yourAgentRunner,
//   maxTokenBudget: 50000,
//   memory,
// });
`;
}

function generateAIMain(name: string): string {
  const camelName = toCamelCase(name);

  return `import { createSystem } from "@directive-run/core";
import { ${camelName} } from "./${name}.js";

const system = createSystem({
  module: ${camelName},
});

system.start();

// Set input and run
system.events.setInput({ value: "Hello, world!" });
system.events.requestRun();

// Wait for completion
await system.settle();

console.log("output:", system.facts.output);

export default system;
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

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function initCommand(args: string[]) {
  const opts = parseArgs(args);

  p.intro(pc.bgCyan(pc.black(" directive init ")));

  // Step 1: Project name
  let moduleName: string;

  if (opts.noInteractive) {
    moduleName = "my-module";
  } else {
    const nameResult = await p.text({
      message: "Module name:",
      placeholder: "my-module",
      defaultValue: "my-module",
      validate: (val) => {
        if (!/^[a-z][a-z0-9-]*$/.test(val)) {
          return "Must start with a letter, use lowercase letters, numbers, and hyphens";
        }
      },
    });

    if (p.isCancel(nameResult)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    moduleName = nameResult;
  }

  // Step 2: Template selection
  let templateId: TemplateId;

  if (opts.template) {
    const templates = getTemplates(moduleName);
    if (!(opts.template in templates)) {
      p.log.error(
        `Unknown template: ${opts.template}. Available: ${Object.keys(templates).join(", ")}`,
      );
      process.exit(1);
    }
    templateId = opts.template as TemplateId;
  } else if (opts.noInteractive) {
    templateId = "counter";
  } else {
    const templates = getTemplates(moduleName);
    const choice = await p.select({
      message: "Project template:",
      options: Object.values(templates).map((t) => ({
        value: t.id,
        label: t.label,
        hint: t.hint,
      })),
    });

    if (p.isCancel(choice)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    templateId = choice as TemplateId;
  }

  const templates = getTemplates(moduleName);
  const template = templates[templateId];

  // Step 3: Detect package manager
  const pm = detectPackageManager(opts.dir);
  p.log.info(`Package manager: ${pc.cyan(pm)}`);

  // Step 4: Write files
  const s = p.spinner();
  s.start("Creating project files...");

  let created = 0;
  let skipped = 0;

  for (const file of template.files) {
    const filePath = join(opts.dir, file.path);

    if (existsSync(filePath)) {
      skipped++;
      continue;
    }

    writeFile(filePath, file.content);
    created++;
  }

  s.stop("Project files created.");

  for (const file of template.files) {
    const filePath = join(opts.dir, file.path);
    const rel = relative(opts.dir, filePath);

    if (existsSync(filePath)) {
      p.log.success(`${pc.green("Created")} ${pc.dim(rel)}`);
    }
  }

  if (skipped > 0) {
    p.log.warn(`Skipped ${skipped} file(s) that already exist.`);
  }

  // Step 5: Show next steps
  const depsCmd = installCmd(pm, template.deps.join(" "));

  p.outro(
    `Next steps:\n` +
      `  ${pc.cyan(depsCmd)}\n` +
      `  ${pc.cyan(`${CLI_NAME} ai-rules init`)}\n` +
      `  ${pc.dim("Start building!")}`,
  );
}
