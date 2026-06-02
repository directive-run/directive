/**
 * Build a Model Context Protocol server that exposes the Directive
 * knowledge package as MCP tools. Transport-agnostic — call
 * `createDirectiveKnowledgeServer()` to get a configured `McpServer`,
 * then connect it to a stdio transport (local clients) or an SSE
 * transport (hosted at `mcp.directive.run`).
 *
 * Tool surface:
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
 * The package version is read from the consuming package.json so
 * the MCP handshake reports an accurate server version.
 */

import { getAllSkills, getSkill } from "@directive-run/claude-plugin";
import {
  getAllExamples,
  getAllKnowledge,
  getExample,
  getKnowledge,
} from "@directive-run/knowledge";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const PKG_VERSION = "0.1.0";

const MAX_SEARCH_RESULTS = 50;
const MAX_LINE_PREVIEW = 200;

function formatLinePreview(line: string): string {
  return line.length > MAX_LINE_PREVIEW
    ? `${line.slice(0, MAX_LINE_PREVIEW)}…`
    : line;
}

function collectSearchHits(
  query: string,
  knowledge: ReadonlyMap<string, string>,
): string[] {
  const lowered = query.toLowerCase();
  const hits: string[] = [];

  for (const [name, content] of knowledge) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.toLowerCase().includes(lowered)) {
        continue;
      }
      hits.push(`${name}.md:${i + 1}: ${formatLinePreview(line)}`);
      if (hits.length >= MAX_SEARCH_RESULTS) {
        return hits;
      }
    }
  }

  return hits;
}

/**
 * Build the MCP server with every Directive knowledge tool registered.
 *
 * The returned server has no transport attached — connect it to
 * `StdioServerTransport` for local clients or an SSE transport for
 * hosted deployments.
 */
export function createDirectiveKnowledgeServer(): McpServer {
  const server = new McpServer({
    name: "directive-knowledge",
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
        "Case-insensitive substring search across every knowledge file. Returns up to 50 matching lines with the file name and line context. Useful for discovering which knowledge file covers a topic before calling get_knowledge for the full document.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "The search string. Matched case-insensitively against every line of every knowledge file.",
          ),
      },
    },
    async ({ query }) => {
      const hits = collectSearchHits(query, getAllKnowledge());

      if (hits.length === 0) {
        return {
          content: [{ type: "text", text: `No matches for '${query}'.` }],
        };
      }

      const header =
        hits.length === MAX_SEARCH_RESULTS
          ? `${hits.length}+ matches (truncated):`
          : `${hits.length} matches:`;

      return {
        content: [{ type: "text", text: `${header}\n${hits.join("\n")}` }],
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
