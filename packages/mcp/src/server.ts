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
  getAllExamples,
  getAllKnowledge,
  getCompositionsFor,
  getExample,
  getKnowledge,
  getReverseCompositionsFor,
} from "@directive-run/knowledge";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PACKAGE_REGISTRY_BUILT_AT } from "./generated/package-registry.js";
import { getPackageInfo, listPackages } from "./packages.js";

const PKG_VERSION = "0.2.0";
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
        return {
          content: [
            {
              type: "text",
              text: `No composition data for '${name}'. Call list_packages to see available names.`,
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

  return server;
}
