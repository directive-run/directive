/**
 * Build a Model Context Protocol server that exposes Directive to MCP
 * clients. Transport-agnostic — call `createDirectiveServer()` to get a
 * configured `McpServer`, then connect it to a stdio transport (local
 * clients) or an SSE transport (hosted at `mcp.directive.run`).
 *
 * This is the SERVER side of the protocol. For the CLIENT side —
 * Directive AI agents calling out to external MCP servers — see
 * `@directive-run/ai/mcp` (`createMCPAdapter`).
 *
 * Current tool surface (knowledge + skill bundles):
 *
 * - `list_knowledge` — every knowledge file name (core + AI + skeleton).
 * - `get_knowledge` — read one knowledge file by name.
 * - `list_examples` — every example file name.
 * - `get_example` — read one example by name.
 * - `search_knowledge` — case-insensitive substring search across all
 *   knowledge files, returning the file name + matching lines.
 * - `list_skills` — every Claude Code skill bundled in the plugin.
 * - `get_skill` — read one skill's `SKILL.md` plus its supporting
 *   files as a single concatenated document.
 *
 * The package is the umbrella for "Directive as an MCP server" — future
 * additions can expose runtime introspection, system state, CLI
 * commands, and debug snapshots through the same binary.
 */

import { createHash } from "node:crypto";
import { getAllSkills, getSkill } from "@directive-run/claude-plugin";
import {
  MIGRATION_SOURCES,
  type MigrationSourceId,
  getAllExamples,
  getAllKnowledge,
  getAntiPatternById,
  getAntiPatterns,
  getCompositionsFor,
  getExample,
  getKnowledge,
  getMigrationPattern,
  getReverseCompositionsFor,
} from "@directive-run/knowledge";
import {
  MODULE_SECTIONS,
  type ModuleSection,
  generateModule,
  generateOrchestrator,
  requiredPackages,
  suggestFileNames,
  validateModuleName,
} from "@directive-run/scaffold";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PACKAGE_REGISTRY_BUILT_AT } from "./generated/package-registry.js";
import {
  LintRunnerError,
  applyFixInWorker,
  runLintInWorker,
} from "./lint-runner.js";
import { getPackageInfo, listPackages } from "./packages.js";
import {
  MAX_PLAYGROUND_SOURCE_BYTES,
  PlaygroundLinkError,
  buildPlaygroundLink,
} from "./playground.js";
import { SandboxRunnerError, runInSandboxTool } from "./sandbox-runner.js";

// Injected at build time by tsup's `define` from package.json so the
// MCP handshake + get_server_info always match the published version.
// In dev (tsx, no build) falls back to a sentinel so handshakes don't
// claim a real version.
const PKG_VERSION = process.env.DIRECTIVE_MCP_VERSION ?? "0.0.0-dev";
const MAX_SEARCH_RESULTS = 50;
const MAX_LINE_PREVIEW = 200;
const MAX_QUERY_LENGTH = 512;

function formatLinePreview(line: string): string {
  return line.length > MAX_LINE_PREVIEW
    ? `${line.slice(0, MAX_LINE_PREVIEW)}…`
    : line;
}

function collectSearchHits(
  query: string,
  corpus: ReadonlyMap<string, string>,
  fileExtension: string,
): string[] {
  const lowered = query.toLowerCase();
  const hits: string[] = [];

  for (const [name, content] of corpus) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.toLowerCase().includes(lowered)) {
        continue;
      }
      hits.push(`${name}${fileExtension}:${i + 1}: ${formatLinePreview(line)}`);
      if (hits.length >= MAX_SEARCH_RESULTS) {
        return hits;
      }
    }
  }

  return hits;
}

function formatSearchResponse(query: string, hits: string[]): string {
  if (hits.length === 0) {
    return `No matches for '${query}'.`;
  }
  const header =
    hits.length === MAX_SEARCH_RESULTS
      ? `${hits.length}+ matches (truncated):`
      : `${hits.length} matches:`;
  return `${header}\n${hits.join("\n")}`;
}

let bundledKnowledgeHash: string | null = null;
function computeBundledKnowledgeHash(): string {
  if (bundledKnowledgeHash) {
    return bundledKnowledgeHash;
  }
  const hash = createHash("sha256");
  for (const [name, content] of Array.from(getAllKnowledge()).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  bundledKnowledgeHash = hash.digest("hex").slice(0, 16);
  return bundledKnowledgeHash;
}

interface ServerInfoOptions {
  transport: "stdio" | "sse";
  authEnabled: boolean;
  sessionCount?: number;
}

let serverInfoOptions: ServerInfoOptions = {
  transport: "stdio",
  authEnabled: false,
};

/** Set transport-specific server info shown by `get_server_info`. */
export function setServerInfo(options: ServerInfoOptions): void {
  serverInfoOptions = options;
}

function renderDepSection(
  out: string[],
  heading: string,
  deps: readonly string[],
): void {
  if (deps.length === 0) {
    return;
  }
  out.push("", `**${heading}:**`, ...deps.map((d) => `- ${d}`));
}

function renderPackageInfo(info: {
  name: string;
  description: string;
  homepage?: string;
  npmUrl?: string;
  bakedVersion: string;
  liveVersion?: string;
  stale: boolean;
  published: boolean;
  dependencies: readonly string[];
  peerDependencies: readonly string[];
  optionalDependencies: readonly string[];
  exports: readonly string[];
}): string {
  const lines: string[] = [
    `# ${info.name}`,
    info.description,
    "",
    `**Version (live):** ${info.liveVersion ?? "unknown"}`,
    `**Version (baked):** ${info.bakedVersion}${info.stale ? " (live fetch failed; using baked)" : ""}`,
    `**Published to npm:** ${info.published ? "yes" : "no (private workspace package)"}`,
  ];
  if (info.homepage) {
    lines.push(`**Homepage:** ${info.homepage}`);
  }
  if (info.npmUrl) {
    lines.push(`**npm:** ${info.npmUrl}`);
  }
  renderDepSection(lines, "Dependencies", info.dependencies);
  renderDepSection(lines, "Peer dependencies", info.peerDependencies);
  renderDepSection(lines, "Optional dependencies", info.optionalDependencies);
  renderDepSection(lines, "Exports", info.exports);
  return lines.join("\n");
}

/**
 * Build the MCP server with every Directive tool registered.
 *
 * The returned server has no transport attached — connect it to
 * `StdioServerTransport` for local clients or an SSE transport for
 * hosted deployments.
 */
export function createDirectiveServer(): McpServer {
  const server = new McpServer({
    name: "directive",
    version: PKG_VERSION,
  });

  server.registerTool(
    "list_knowledge",
    {
      title: "List Directive knowledge files",
      description:
        "List every knowledge file shipped in @directive-run/knowledge. Returns the file names (without .md) that can be passed to get_knowledge. Covers core docs (engine, facts, constraints, resolvers, derivations, effects, plugins, modules, systems, testing) and AI docs (orchestrator, agents, adapters, guardrails, memory, MCP, RAG, security, evals, budget, multi-agent).",
      inputSchema: {},
    },
    async () => {
      const knowledge = getAllKnowledge();
      const names = Array.from(knowledge.keys()).sort();

      return {
        content: [
          {
            type: "text",
            text: `${names.length} knowledge files:\n${names.join("\n")}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_knowledge",
    {
      title: "Get a Directive knowledge file",
      description:
        "Fetch the full Markdown contents of one Directive knowledge file by name. Use list_knowledge first to discover available names. Names match the file stem (e.g. 'constraints', 'ai-orchestrator', 'api-skeleton').",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            "The knowledge file name (no .md suffix). Example: 'constraints', 'ai-orchestrator', 'api-skeleton'.",
          ),
      },
    },
    async ({ name }) => {
      const content = getKnowledge(name);
      if (!content) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Knowledge file not found: '${name}'. Call list_knowledge to see available names.`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: content }],
      };
    },
  );

  server.registerTool(
    "list_examples",
    {
      title: "List Directive code examples",
      description:
        "List every code example shipped in @directive-run/knowledge. Examples are minimal, working TypeScript files demonstrating one concept each. Pass the returned names to get_example.",
      inputSchema: {},
    },
    async () => {
      const examples = getAllExamples();
      const names = Array.from(examples.keys()).sort();

      return {
        content: [
          {
            type: "text",
            text: `${names.length} examples:\n${names.join("\n")}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_example",
    {
      title: "Get a Directive code example",
      description:
        "Fetch the source of one Directive code example by name. Use list_examples first to discover available names. Returns raw TypeScript.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            "The example file name (no .ts suffix). Example: 'basic-module', 'ai-orchestrator'.",
          ),
      },
    },
    async ({ name }) => {
      const content = getExample(name);
      if (!content) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Example not found: '${name}'. Call list_examples to see available names.`,
            },
          ],
        };
      }

      return {
        content: [
          { type: "text", text: `\`\`\`typescript\n${content}\n\`\`\`` },
        ],
      };
    },
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Search Directive knowledge files",
      description:
        "Case-insensitive substring search across every knowledge file. Returns existing reference material; does NOT generate code. Use this to find which knowledge file covers a topic before calling get_knowledge for the full document.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(MAX_QUERY_LENGTH)
          .describe(
            "The search string. Matched case-insensitively against every line of every knowledge file.",
          ),
      },
    },
    async ({ query }) => {
      const hits = collectSearchHits(query, getAllKnowledge(), ".md");
      return {
        content: [{ type: "text", text: formatSearchResponse(query, hits) }],
      };
    },
  );

  server.registerTool(
    "search_examples",
    {
      title: "Search Directive code examples",
      description:
        "Case-insensitive substring search across every bundled code example (.ts files in @directive-run/knowledge). Returns existing reference material; does NOT generate code. Use this to find which example demonstrates a concept before calling get_example for the full source.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(MAX_QUERY_LENGTH)
          .describe(
            "The search string. Matched case-insensitively against every line of every example file.",
          ),
      },
    },
    async ({ query }) => {
      const hits = collectSearchHits(query, getAllExamples(), ".ts");
      return {
        content: [{ type: "text", text: formatSearchResponse(query, hits) }],
      };
    },
  );

  server.registerTool(
    "list_packages",
    {
      title: "List @directive-run/* packages",
      description:
        "Enumerate every @directive-run/* package known to this MCP server. Returns name + one-line description. Use this to answer 'what should I install for X?' and to discover names to pass to get_package_info or get_composable_packages. Returns existing reference material; does NOT generate code.",
      inputSchema: {},
    },
    async () => {
      const packages = listPackages();
      const lines = packages.map(
        (p) => `${p.name}${p.published ? "" : " (private)"} — ${p.summary}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `${packages.length} packages:\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_package_info",
    {
      title: "Get @directive-run/* package detail",
      description:
        "Fetch detailed info for one @directive-run/* package: description, dependencies, peerDependencies, exports, npm URL. Returns the version baked into this MCP build AND the live-from-npm version when available (1-hour cache, 3-second timeout, falls back to baked version on network failure). Returns existing reference material; does NOT generate code.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(128)
          .describe(
            "Package name (e.g. '@directive-run/core'). Call list_packages first to discover valid names.",
          ),
      },
    },
    async ({ name }) => {
      const info = await getPackageInfo(name);
      if (!info) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Package not found: '${name}'. Call list_packages to see available names.`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: renderPackageInfo(info) }],
      };
    },
  );

  server.registerTool(
    "get_composable_packages",
    {
      title: "Get composition siblings for a package",
      description:
        "Given a @directive-run/* package name, return the sibling packages it composes with (outgoing edges) AND the packages that compose with IT (incoming edges). Each edge carries a one-line reason. Returns existing reference material; does NOT generate code. Use this to answer 'what should I pair @directive-run/X with?' or 'who else uses @directive-run/Y?'.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(128)
          .describe(
            "Package name (e.g. '@directive-run/query'). Call list_packages first to discover valid names.",
          ),
      },
    },
    async ({ name }) => {
      const outgoing = getCompositionsFor(name);
      const incoming = getReverseCompositionsFor(name);
      if (outgoing.length === 0 && incoming.length === 0) {
        // No edges either direction means the package name isn't known
        // to the graph at all (every shipped @directive-run/* package
        // has at least one edge). Surface as isError so LLM clients
        // can distinguish "you typed it wrong" from "no data."
        const knownPackage = listPackages().some((p) => p.name === name);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: knownPackage
                ? `NO_COMPOSITIONS: '${name}' is a known package but has no composition edges yet. This is a coverage gap in compositions.json.`
                : `NOT_FOUND: '${name}' is not a known @directive-run/* package. Call list_packages to see available names.`,
            },
          ],
        };
      }
      const lines: string[] = [`# ${name}`, ""];
      if (outgoing.length > 0) {
        lines.push("## Composes with:");
        for (const e of outgoing) {
          lines.push(`- ${e.to} — ${e.reason}`);
        }
        lines.push("");
      }
      if (incoming.length > 0) {
        lines.push("## Composed by:");
        for (const e of incoming) {
          lines.push(`- ${e.from} — ${e.reason}`);
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `<directive-data>\n${lines.join("\n")}\n</directive-data>`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_server_info",
    {
      title: "Get directive MCP server info",
      description:
        "Return version manifest for this MCP server build — package version, transport (stdio or SSE), whether auth is enabled, bundled-knowledge hash, package-registry build timestamp, and (for SSE) the current session count. Returns existing reference material; does NOT generate code. Use this to verify the client is talking to the expected build.",
      inputSchema: {},
    },
    async () => {
      const lines = [
        `# @directive-run/mcp@${PKG_VERSION}`,
        `**Transport:** ${serverInfoOptions.transport}`,
        `**Auth enabled:** ${serverInfoOptions.authEnabled ? "yes" : "no"}`,
        `**Bundled knowledge hash:** ${computeBundledKnowledgeHash()}`,
        `**Package registry built at:** ${PACKAGE_REGISTRY_BUILT_AT}`,
      ];
      if (serverInfoOptions.sessionCount !== undefined) {
        lines.push(
          `**Active SSE sessions:** ${serverInfoOptions.sessionCount}`,
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );

  server.registerTool(
    "list_module_sections",
    {
      title: "List valid module sections for generate_module",
      description:
        "Enumerate the valid `sections` values that `generate_module` accepts: derive, events, constraints, resolvers, effects. Call this before generate_module so the section list comes from the server (no hallucination risk). Returns existing reference material; does NOT generate code.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `${MODULE_SECTIONS.length} module sections:\n${MODULE_SECTIONS.join("\n")}`,
        },
      ],
    }),
  );

  server.registerTool(
    "generate_module",
    {
      title:
        "Generate NEW Directive module source code (paired with a runnable driver)",
      description:
        'Generate a new Directive module or AI orchestrator as a paired source bundle: a library `moduleSource` (the `createModule(...)` definition) AND a `runnerSource` that wraps it in `createSystem` + `start()` + dispatch + settle + log so the playground boots a project that actually demonstrates behavior. Pipe BOTH into `playground_link` as a `files` array for a clickable runnable URL. Never writes to disk — the caller decides. Strict regex on `name` (kebab-case, ≤64 chars). For `kind: "module"`, optionally pass `sections` to pick which blocks to include. Discover valid section values via list_module_sections.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "Kebab-case identifier (e.g. 'traffic-light'). Must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.",
          ),
        kind: z
          .enum(["module", "orchestrator"])
          .default("module")
          .describe(
            "What to generate. 'module' for a plain Directive module; 'orchestrator' for an AI agent orchestrator module with memory + guardrails scaffolding.",
          ),
        sections: z
          .array(z.enum(MODULE_SECTIONS))
          .optional()
          .describe(
            "Which module sections to include. Defaults to every section. Only honored when kind === 'module'. Discover valid values via list_module_sections.",
          ),
      },
    },
    async ({ name, kind, sections }) => {
      const validation = validateModuleName(name);
      if (validation !== true) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Invalid name '${name}': ${validation}` },
          ],
        };
      }
      try {
        const scaffold =
          kind === "orchestrator"
            ? generateOrchestrator(name)
            : generateModule(
                name,
                (sections as readonly ModuleSection[]) ?? MODULE_SECTIONS,
              );
        const { testFileName } = suggestFileNames(name, kind);
        const needed = requiredPackages(kind);
        const payload = {
          moduleSource: scaffold.moduleSource,
          runnerSource: scaffold.runnerSource,
          suggestedFilenames: {
            module: `src/${scaffold.suggestedFilenames.module}`,
            runner: `src/${scaffold.suggestedFilenames.runner}`,
            test: `src/${testFileName}`,
          },
          runnable: scaffold.runnable,
          requiredPackages: needed,
          installCommand: `pnpm add ${needed.join(" ")}`,
          nextStep:
            "Pipe `moduleSource` AND `runnerSource` into `playground_link` as a `files` array to give the user a runnable URL.",
        };
        return {
          content: [
            {
              type: "text",
              text: `<directive-data>\n${JSON.stringify(payload, null, 2)}\n</directive-data>`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: (err as Error).message }],
        };
      }
    },
  );

  server.registerTool(
    "list_review_rules",
    {
      title: "List Directive code-review rules",
      description:
        "Enumerate every anti-pattern Directive code can violate, parsed from @directive-run/knowledge. Each entry carries an id, severity, category, title, badExample, goodExample, and explanation. Use this to discover rule ids before calling get_review_rule or before passing ruleFilter to review_source. Returns existing reference material; does NOT generate code.",
      inputSchema: {},
    },
    async () => {
      const rules = getAntiPatterns();
      const compact = rules.map((r) => ({
        id: r.id,
        severity: r.severity,
        category: r.category,
        title: r.title,
      }));
      return {
        content: [
          {
            type: "text",
            text: `<directive-data>\n${rules.length} review rules:\n${JSON.stringify(compact, null, 2)}\n</directive-data>`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_review_rule",
    {
      title: "Get a Directive code-review rule",
      description:
        "Fetch one anti-pattern's full detail: title, severity, category, explanation, and the WRONG/CORRECT code-example pair. Use list_review_rules first to discover valid ids. Returns existing reference material; does NOT generate code.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .max(128)
          .describe(
            "Rule id (a kebab-case slug — e.g. 'flat-schema-missing-facts-wrapper'). Call list_review_rules first to discover valid ids.",
          ),
      },
    },
    async ({ id }) => {
      const rule = getAntiPatternById(id);
      if (!rule) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Rule not found: '${id}'. Call list_review_rules to see available ids.`,
            },
          ],
        };
      }
      const lines: string[] = [
        `# ${rule.title}`,
        `**id:** ${rule.id}`,
        `**severity:** ${rule.severity}`,
        `**category:** ${rule.category}`,
      ];
      if (rule.explanation) {
        lines.push("", rule.explanation);
      }
      if (rule.badExample) {
        lines.push("", "## Wrong", "```typescript", rule.badExample, "```");
      }
      if (rule.goodExample) {
        lines.push("", "## Correct", "```typescript", rule.goodExample, "```");
      }
      return {
        content: [
          {
            type: "text",
            text: `<directive-data>\n${lines.join("\n")}\n</directive-data>`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_migration_sources",
    {
      title: "List supported migration source libraries",
      description:
        "Enumerate the source libraries get_migration_pattern accepts: redux, zustand, xstate, mobx, jotai, recoil. Call this before get_migration_pattern so the source list comes from the server (no hallucination risk). Returns existing reference material; does NOT generate code.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `${MIGRATION_SOURCES.length} sources:\n${MIGRATION_SOURCES.join("\n")}`,
        },
      ],
    }),
  );

  server.registerTool(
    "get_migration_pattern",
    {
      title: "Get migration pattern from a state-management library",
      description:
        "Fetch the concept-mapping table + step list + before/after exemplars for migrating from a popular state-management library to Directive. Use this when a user asks 'how do I migrate from Redux / Zustand / XState / MobX / Jotai / Recoil'. Returns existing reference material; does NOT generate code.",
      inputSchema: {
        source: z
          .enum(MIGRATION_SOURCES)
          .describe(
            "Source library. Discover valid values via list_migration_sources.",
          ),
      },
    },
    async ({ source }) => {
      const pattern = getMigrationPattern(source as MigrationSourceId);
      if (!pattern) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Migration pattern not found: '${source}'. Call list_migration_sources to see valid values.`,
            },
          ],
        };
      }
      const lines: string[] = [
        `# Migrating from ${pattern.name} to Directive`,
        "",
        "## Concept map",
        "",
        "| From | To | Note |",
        "|---|---|---|",
        ...pattern.conceptMap.map(
          (row) => `| ${row.from} | ${row.to} | ${row.note} |`,
        ),
        "",
        "## Steps",
        ...pattern.steps.map((s, i) => `${i + 1}. ${s}`),
        "",
        "## Before",
        "```typescript",
        pattern.before,
        "```",
        "",
        "## After",
        "```typescript",
        pattern.after,
        "```",
      ];
      return {
        content: [
          {
            type: "text",
            text: `<directive-data>\n${lines.join("\n")}\n</directive-data>`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "review_source",
    {
      title: "Review Directive code with ts-morph rules",
      description:
        "Run the @directive-run/lint rule registry against a TypeScript source string. Returns structured findings (line, column, severity, message, fixable) for every match. Use this when the user asks 'review this Directive code' or 'lint this'. Source is parsed in a worker thread with a 5-second budget and 200 KB cap.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .max(200_000)
          .describe(
            "TypeScript source to review. Max 200,000 bytes; longer inputs are rejected pre-parse.",
          ),
        fileName: z
          .string()
          .regex(/^[\w./-]{1,128}$/)
          .optional()
          .describe(
            "Optional file name shown in findings. Must match /^[\\w./-]{1,128}$/.",
          ),
        ruleFilter: z
          .array(z.string().max(64))
          .max(32)
          .optional()
          .describe(
            "Optional whitelist of rule ids to run. Discover valid ids via list_review_rules.",
          ),
      },
    },
    async ({ source, fileName, ruleFilter }) => {
      try {
        const result = await runLintInWorker({ source, fileName, ruleFilter });
        return {
          content: [
            {
              type: "text",
              text: `<directive-data>\n${JSON.stringify(result, null, 2)}\n</directive-data>`,
            },
          ],
        };
      } catch (err) {
        const reason =
          err instanceof LintRunnerError
            ? `${err.code}: ${err.message}`
            : (err as Error).message;
        return {
          isError: true,
          content: [{ type: "text", text: `review_source failed — ${reason}` }],
        };
      }
    },
  );

  server.registerTool(
    "fix_code",
    {
      title: "Apply a mechanical fix for a Directive review finding",
      description:
        "Given a source string and a Finding returned by review_source, run the rule's mechanical fix and return { ok, diff, fixedSource, explanation } — or { ok: false, reason } when the rule has no fix. Useful for closing the loop: review_source → user picks → fix_code. The fixed source is NOT written to disk — the caller decides.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .max(200_000)
          .describe("The same source you passed to review_source."),
        finding: z
          .object({
            ruleId: z.string().min(1).max(64),
            severity: z.enum(["error", "warning", "info"]),
            line: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            message: z.string(),
            findingId: z.string(),
            suggestion: z.string().optional(),
          })
          .describe(
            "The Finding returned by review_source. Pass the WHOLE object — the worker uses ruleId + line + column to locate the AST node.",
          ),
      },
    },
    async ({ source, finding }) => {
      try {
        const result = await applyFixInWorker({ source, finding });
        return {
          content: [
            {
              type: "text",
              text: `<directive-data>\n${JSON.stringify(result, null, 2)}\n</directive-data>`,
            },
          ],
        };
      } catch (err) {
        const reason =
          err instanceof LintRunnerError
            ? `${err.code}: ${err.message}`
            : (err as Error).message;
        return {
          isError: true,
          content: [{ type: "text", text: `fix_code failed — ${reason}` }],
        };
      }
    },
  );

  server.registerTool(
    "list_skills",
    {
      title: "List Directive Claude Code skills",
      description:
        "List every skill bundled in @directive-run/claude-plugin. Each skill is a gerund-named bundle of one SKILL.md plus supporting knowledge files. Pass a returned name to get_skill.",
      inputSchema: {},
    },
    async () => {
      const skills = getAllSkills();
      const names = Array.from(skills.keys()).sort();

      return {
        content: [
          {
            type: "text",
            text: `${names.length} skills:\n${names.join("\n")}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get a Directive Claude Code skill",
      description:
        "Fetch one skill bundle: the SKILL.md manifest plus every supporting knowledge file concatenated into a single document. Use list_skills to discover names.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            "The skill name (e.g. 'building-ai-orchestrators', 'writing-directive-constraints').",
          ),
      },
    },
    async ({ name }) => {
      const skill = getSkill(name);
      if (!skill) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Skill not found: '${name}'. Call list_skills to see available names.`,
            },
          ],
        };
      }

      const parts = [`# Skill: ${skill.name}\n\n${skill.manifest}`];
      for (const [fileName, content] of skill.files) {
        parts.push(`---\n\n## ${fileName}.md\n\n${content}`);
      }

      return {
        content: [{ type: "text", text: parts.join("\n\n") }],
      };
    },
  );

  server.registerTool(
    "playground_link",
    {
      title:
        "Build a shareable playground link for a Directive snippet (single- or multi-file)",
      description:
        "Turn TypeScript source into a directive.run URL the user can click to open a real running project. Two input shapes:\n\n• `source` (single string) — for snippets that are already runnable (`get_example`, `fix_code` output, hand-written demos). Lands as `src/main.ts` in a StackBlitz project preloaded with @directive-run/core.\n\n• `files` (array of {path, source}) — for paired output from `generate_module` (which returns both a library `moduleSource` AND a runnable `runnerSource`). Pass `[{path: 'src/<name>.ts', source: moduleSource}, {path: 'src/main.ts', source: runnerSource}]` so the playground boots a project that actually demonstrates behavior. THIS IS THE NORMAL WAY TO HAND OFF `generate_module` OUTPUT.\n\nOptional `mode`: `'preview'` (default — code + Open-in-StackBlitz button, the only Directive-branded surface, recommended for first-time users) or `'instant'` (thin auto-submit redirect, lands in StackBlitz in ~600ms with no preview UI). Use `'instant'` after the user has road-tested one link, or when they explicitly want 'just open it'.\n\nPayload travels in the URL hash so it never reaches server logs. 8 KB cap on raw input.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .max(MAX_PLAYGROUND_SOURCE_BYTES)
          .optional()
          .describe(
            `Single-file source (mutually exclusive with \`files\`). Use for already-runnable code from \`get_example\` / \`fix_code\`. Max ${MAX_PLAYGROUND_SOURCE_BYTES} bytes.`,
          ),
        files: z
          .array(
            z.object({
              path: z
                .string()
                .min(1)
                .max(120)
                .describe(
                  "Relative path inside the StackBlitz project, e.g. 'src/counter.ts' or 'src/main.ts'. One file should be 'src/main.ts' (the entry point tsx runs).",
                ),
              source: z.string().min(1).describe("File contents."),
            }),
          )
          .min(1)
          .max(10)
          .optional()
          .describe(
            `Multi-file payload (mutually exclusive with \`source\`). Use for \`generate_module\` paired output. JSON-encoded array gets compressed; the encoded payload must stay under ${MAX_PLAYGROUND_SOURCE_BYTES} bytes.`,
          ),
        title: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "Optional short label shown as the editor tab title on the playground page. Defaults to 'Untitled snippet'.",
          ),
        mode: z
          .enum(["preview", "instant"])
          .optional()
          .describe(
            "URL flavor: 'preview' (default) routes via directive.run/playground (preview + Open-in-StackBlitz button). 'instant' routes via directive.run/run (thin auto-submit redirect, lands directly in StackBlitz).",
          ),
      },
    },
    async ({ source, files, title, mode }) => {
      try {
        const result = buildPlaygroundLink({
          source,
          files: files as { path: string; source: string }[] | undefined,
          title,
          mode,
        });
        const payload = {
          url: result.url,
          mode: result.mode,
          fileCount: result.fileCount,
          sizeBytes: result.sizeBytes,
          urlBytes: result.urlBytes,
          title: result.title ?? null,
        };
        return {
          content: [
            {
              type: "text",
              text: `<directive-data>\n${JSON.stringify(payload, null, 2)}\n</directive-data>`,
            },
          ],
        };
      } catch (err) {
        const reason =
          err instanceof PlaygroundLinkError
            ? `${err.code}: ${err.message}`
            : (err as Error).message;
        return {
          isError: true,
          content: [
            { type: "text", text: `playground_link failed — ${reason}` },
          ],
        };
      }
    },
  );

  server.registerTool(
    "run_in_sandbox",
    {
      title: "Execute a Directive snippet and return its observed behavior",
      description:
        "Execute a Directive snippet and return its observed behavior. Use `run_in_sandbox` when you want the transcript IN-CHAT (so you or your next reasoning step can see what happened). Use `playground_link` instead when you want to hand the USER an interactive URL. Both accept identical `source` / `files` shapes — copy the same payload across if you want both.\n\nResponse payload: `logs[]` (captured console.log/warn/error), `facts` (post-settle snapshot), `errors[]` (validation/bundle/runtime/timeout messages), `durationMs`, `timedOut`, and `playgroundUrl` (click-through to StackBlitz for the same snippet).\n\nDecoding errors:\n• `'<path>:<line>:<col> — <reason>'` → validation rejection (snippet hit the AST allowlist). REWRITE the snippet; re-running with the same input will reject again.\n• `'wall-clock budget of Nms elapsed'` plus `timedOut: true` → likely infinite loop or unawaited promise. Don't retry; surface to user.\n• `'cannot resolve \"./X\" from \"./Y\"'` or any `esbuild ...` → bundle failure; check file paths and imports.\n• Any other string → runtime throw (may be intentional from the module's logic; check `facts` to confirm).\n\nSandbox boundary (v0.3.0): the AST allowlist validator rejects (a) imports outside `@directive-run/{core, ai, query, react, vue, svelte, solid, lit, el, optimistic, timeline, mutator, knowledge, scaffold, claude-plugin, lint}` plus relative `./*.js` paths inside the payload, (b) free-identifier references to FS / network / eval surfaces (`process`, `require`, `fetch`, `eval`, `Buffer`, `setTimeout`, etc.), (c) `globalThis.process` / `Reflect.get(globalThis, ...)` / `.constructor` / `Function(...)` and other property-access bypass chains, (d) `@directive-run/{cli, mcp, sandbox, vite-plugin-api-proxy}` (build/CLI/sandbox tooling). The worker has a 5-second wall-clock budget (clamped to [100ms, 10s]) and a 32 MB heap ceiling.\n\nNote: `react/vue/svelte/solid/lit` import OK, but their runtime hooks (`useState`, etc.) need a DOM and throw in this Node sandbox. For UI demos, prefer `playground_link` (StackBlitz has a DOM).\n\nValidator rejection, bundle failure, runtime error, and timeout all return structured results in `errors` rather than throwing.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .max(MAX_PLAYGROUND_SOURCE_BYTES)
          .optional()
          .describe(
            `Single-file source (mutually exclusive with \`files\`). Use for already-runnable code. Max ${MAX_PLAYGROUND_SOURCE_BYTES} bytes.`,
          ),
        files: z
          .array(
            z.object({
              path: z
                .string()
                .min(1)
                .max(120)
                .describe(
                  "Relative path inside the sandbox, e.g. 'src/counter.ts'. One file MUST be 'src/main.ts' — that's the entry point the worker imports.",
                ),
              source: z.string().min(1).describe("File contents."),
            }),
          )
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Multi-file payload (mutually exclusive with `source`). Use for `generate_module` paired output.",
          ),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(10_000)
          .optional()
          .describe(
            "Wall-clock execution budget in milliseconds. Default 5000. Clamped to [100, 10000].",
          ),
      },
    },
    async ({ source, files, timeoutMs }) => {
      try {
        const result = await runInSandboxTool({
          source,
          files: files as { path: string; source: string }[] | undefined,
          timeoutMs,
        });
        // Build a playgroundUrl alongside the transcript so the LLM can
        // hand the user a click-through to edit the same snippet in
        // StackBlitz if the transcript is interesting (or if it errored
        // and the user wants to debug interactively).
        let playgroundUrl: string | null = null;
        try {
          const link = buildPlaygroundLink({
            source,
            files: files as { path: string; source: string }[] | undefined,
          });
          playgroundUrl = link.url;
        } catch {
          // Playground URL is a convenience; failing to build one
          // shouldn't gate the transcript response.
        }
        const payload = {
          logs: result.logs,
          facts: result.facts,
          errors: result.errors,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          playgroundUrl,
        };
        return {
          content: [
            {
              type: "text",
              text: `<directive-data>\n${JSON.stringify(payload, null, 2)}\n</directive-data>`,
            },
          ],
        };
      } catch (err) {
        const reason =
          err instanceof SandboxRunnerError
            ? `${err.code}: ${err.message}`
            : (err as Error).message;
        return {
          isError: true,
          content: [
            { type: "text", text: `run_in_sandbox failed — ${reason}` },
          ],
        };
      }
    },
  );

  return server;
}
