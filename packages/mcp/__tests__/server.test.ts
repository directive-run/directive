import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectiveServer } from "../src/server.js";

describe("createDirectiveServer", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = createDirectiveServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("registers every documented tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      "fix_code",
      "generate_module",
      "get_composable_packages",
      "get_example",
      "get_knowledge",
      "get_migration_pattern",
      "get_package_info",
      "get_review_rule",
      "get_server_info",
      "get_skill",
      "list_examples",
      "list_knowledge",
      "list_migration_sources",
      "list_module_sections",
      "list_packages",
      "list_review_rules",
      "list_skills",
      "playground_link",
      "review_source",
      "run_in_sandbox",
      "search_examples",
      "search_knowledge",
    ]);
  });

  it("list_knowledge returns a non-empty file list", async () => {
    const result = await client.callTool({
      name: "list_knowledge",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toMatch(/^\d+ knowledge files:/);
    expect(text).toContain("constraints");
    expect(text).toContain("resolvers");
  });

  it("get_knowledge returns markdown content for a known file", async () => {
    const result = await client.callTool({
      name: "get_knowledge",
      arguments: { name: "constraints" },
    });

    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(200);
    expect(text.toLowerCase()).toContain("constraint");
  });

  it("get_knowledge returns an error for unknown file", async () => {
    const result = await client.callTool({
      name: "get_knowledge",
      arguments: { name: "definitely-not-a-real-file-12345" },
    });

    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/not found/i);
  });

  it("list_skills returns at least the 12 bundled skills", async () => {
    const result = await client.callTool({
      name: "list_skills",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    const match = text.match(/^(\d+) skills:/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(9);
    expect(text).toContain("building-ai-orchestrators");
  });

  it("get_skill returns SKILL.md + supporting files", async () => {
    const result = await client.callTool({
      name: "get_skill",
      arguments: { name: "building-ai-orchestrators" },
    });

    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("# Skill: building-ai-orchestrators");
    expect(text).toContain("---");
  });

  it("get_skill returns an error for unknown skill", async () => {
    const result = await client.callTool({
      name: "get_skill",
      arguments: { name: "not-a-real-skill" },
    });

    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/not found/i);
  });

  it("playground_link single-source mode returns a /playground URL", async () => {
    const result = await client.callTool({
      name: "playground_link",
      arguments: {
        source: 'console.log("hello directive");\n',
        title: "Hello",
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = parseDirectiveData<{
      url: string;
      mode: string;
      fileCount: number;
      sizeBytes: number;
      urlBytes: number;
      title: string;
    }>(result);

    expect(payload.url.startsWith("https://directive.run/playground#")).toBe(
      true,
    );
    expect(payload.url).toContain("src=");
    expect(payload.url).toContain("t=Hello");
    expect(payload.mode).toBe("preview");
    expect(payload.fileCount).toBe(1);
    expect(payload.sizeBytes).toBe(32);
    expect(payload.title).toBe("Hello");
  });

  it("playground_link multi-file mode returns a URL with files= hash field", async () => {
    const result = await client.callTool({
      name: "playground_link",
      arguments: {
        files: [
          {
            path: "src/counter.ts",
            source: 'export const counter = "x";\n',
          },
          { path: "src/main.ts", source: 'console.log("hi");\n' },
        ],
        title: "Counter demo",
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = parseDirectiveData<{
      url: string;
      fileCount: number;
      mode: string;
    }>(result);
    expect(payload.url.startsWith("https://directive.run/playground#")).toBe(
      true,
    );
    expect(payload.url).toContain("files=");
    expect(payload.fileCount).toBe(2);
    expect(payload.mode).toBe("preview");
  });

  it("playground_link mode=instant routes to /run", async () => {
    const result = await client.callTool({
      name: "playground_link",
      arguments: { source: "console.log(1);", mode: "instant" },
    });

    expect(result.isError).toBeFalsy();
    const payload = parseDirectiveData<{ url: string; mode: string }>(result);
    expect(payload.url.startsWith("https://directive.run/run#")).toBe(true);
    expect(payload.mode).toBe("instant");
  });

  it("playground_link rejects when both source and files are provided", async () => {
    const result = await client.callTool({
      name: "playground_link",
      arguments: {
        source: "x",
        files: [{ path: "src/main.ts", source: "y" }],
      },
    });
    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/both/i);
  });

  it("playground_link rejects source larger than the 8KB cap", async () => {
    const result = await client.callTool({
      name: "playground_link",
      arguments: { source: "x".repeat(8001) },
    });

    expect(result.isError).toBe(true);
  });

  it("search_knowledge finds hits for a common term", async () => {
    const result = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "constraint" },
    });

    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toMatch(/^\d+(\+)? matches/);
    expect(text.split("\n").length).toBeGreaterThan(2);
  });

  it("search_knowledge reports no matches for nonsense", async () => {
    const result = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "zxqzxqzxqzxqzxqzxq" },
    });

    expect(result.isError).toBeFalsy();
    expect(extractText(result)).toMatch(/no matches/i);
  });

  it("rejects empty query for search_knowledge", async () => {
    const result = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "" },
    });

    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/at least 1 character/i);
  });

  it("search_knowledge rejects queries longer than 512 chars", async () => {
    const huge = "a".repeat(513);
    const result = await client.callTool({
      name: "search_knowledge",
      arguments: { query: huge },
    });
    expect(result.isError).toBe(true);
  });

  it("search_examples finds hits for an example concept", async () => {
    const result = await client.callTool({
      name: "search_examples",
      arguments: { query: "createModule" },
    });
    expect(result.isError).toBeFalsy();
    expect(extractText(result)).toMatch(/^\d+(\+)? matches/);
  });

  it("search_examples reports no matches for nonsense", async () => {
    const result = await client.callTool({
      name: "search_examples",
      arguments: { query: "zxqzxqzxqzxqzxq" },
    });
    expect(result.isError).toBeFalsy();
    expect(extractText(result)).toMatch(/no matches/i);
  });

  it("list_packages returns every @directive-run/* package", async () => {
    const result = await client.callTool({
      name: "list_packages",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toMatch(/^\d+ packages:/);
    expect(text).toContain("@directive-run/core");
    expect(text).toContain("@directive-run/mcp");
    expect(text).toContain("@directive-run/scaffold");
    expect(text).toContain("@directive-run/lint");
  });

  it("get_package_info returns detail for a known package", async () => {
    const result = await client.callTool({
      name: "get_package_info",
      arguments: { name: "@directive-run/core" },
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("@directive-run/core");
    expect(text).toMatch(/Version \(baked\):/);
    expect(text).toMatch(/npm:|Published/);
  }, 8000);

  it("get_package_info returns an error for unknown package", async () => {
    const result = await client.callTool({
      name: "get_package_info",
      arguments: { name: "@directive-run/does-not-exist" },
    });
    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/not found/i);
  });

  it("get_composable_packages returns siblings for a known package", async () => {
    const result = await client.callTool({
      name: "get_composable_packages",
      arguments: { name: "@directive-run/query" },
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("<directive-data>");
    expect(text).toContain("# @directive-run/query");
    expect(text).toMatch(/Composes with:|Composed by:/);
  });

  it("get_composable_packages flags unknown package as NOT_FOUND error", async () => {
    const result = await client.callTool({
      name: "get_composable_packages",
      arguments: { name: "@directive-run/not-a-real-pkg" },
    });
    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/not_found/i);
  });

  it("list_module_sections returns the canonical 5", async () => {
    const result = await client.callTool({
      name: "list_module_sections",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("derive");
    expect(text).toContain("events");
    expect(text).toContain("constraints");
    expect(text).toContain("resolvers");
    expect(text).toContain("effects");
  });

  it("generate_module returns paired moduleSource + runnerSource", async () => {
    const result = await client.callTool({
      name: "generate_module",
      arguments: { name: "traffic-light", kind: "module" },
    });
    expect(result.isError).toBeFalsy();
    const payload = parseDirectiveData(result);
    expect(payload.moduleSource).toContain("@directive-run/core");
    expect(payload.moduleSource).toContain('createModule("traffic-light"');
    expect(payload.moduleSource).toContain("export const trafficLight");
    expect(payload.runnerSource).toContain(
      "createSystem({ module: trafficLight })",
    );
    expect(payload.runnerSource).toContain("system.start()");
    expect(payload.runnerSource).toContain("await system.settle()");
    expect(payload.runnable).toBe(false);
    expect(payload.suggestedFilenames).toEqual({
      module: "src/traffic-light.ts",
      runner: "src/main.ts",
      test: "src/traffic-light.test.ts",
    });
  });

  it("generate_module respects sections enum", async () => {
    const result = await client.callTool({
      name: "generate_module",
      arguments: {
        name: "minimal-mod",
        kind: "module",
        sections: ["derive"],
      },
    });
    expect(result.isError).toBeFalsy();
    const payload = parseDirectiveData(result);
    expect(payload.moduleSource).toContain("derive:");
    expect(payload.moduleSource).not.toContain("effects:");
  });

  it("generate_module rejects invalid names", async () => {
    const result = await client.callTool({
      name: "generate_module",
      arguments: { name: "../etc/passwd", kind: "module" },
    });
    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/invalid name|must start/i);
  });

  it("generate_module orchestrator pulls in @directive-run/ai", async () => {
    const result = await client.callTool({
      name: "generate_module",
      arguments: { name: "chat-agent", kind: "orchestrator" },
    });
    expect(result.isError).toBeFalsy();
    const payload = parseDirectiveData(result);
    expect(payload.moduleSource).toContain("@directive-run/ai");
    expect(payload.moduleSource).toContain("chatAgent");
    expect(payload.moduleSource).toContain("RUN_AGENT");
    expect(payload.runnerSource).toContain('from "./chat-agent.js"');
    expect(payload.runnable).toBe(false);
  });

  it("list_review_rules returns a non-empty JSON list of rules", async () => {
    const result = await client.callTool({
      name: "list_review_rules",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("<directive-data>");
    expect(text).toMatch(/^.*?\d+ review rules:/m);
    expect(text).toContain('"id":');
    expect(text).toContain('"severity":');
  });

  it("get_review_rule returns a known rule", async () => {
    const list = await client.callTool({
      name: "list_review_rules",
      arguments: {},
    });
    const listText = extractText(list);
    const firstId = listText.match(/"id":\s*"([^"]+)"/)?.[1];
    expect(firstId).toBeTruthy();

    const result = await client.callTool({
      name: "get_review_rule",
      arguments: { id: firstId! },
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("<directive-data>");
    expect(text).toContain(`**id:** ${firstId}`);
    expect(text).toMatch(/\*\*severity:\*\*/);
  });

  it("get_review_rule errors on unknown id", async () => {
    const result = await client.callTool({
      name: "get_review_rule",
      arguments: { id: "not-a-real-rule-12345" },
    });
    expect(result.isError).toBe(true);
    expect(extractText(result)).toMatch(/not found/i);
  });

  it("list_migration_sources enumerates the 6 source libs", async () => {
    const result = await client.callTool({
      name: "list_migration_sources",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    for (const src of [
      "redux",
      "zustand",
      "xstate",
      "mobx",
      "jotai",
      "recoil",
    ]) {
      expect(text).toContain(src);
    }
  });

  it("get_migration_pattern returns concept map + steps + examples", async () => {
    const result = await client.callTool({
      name: "get_migration_pattern",
      arguments: { source: "redux" },
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("<directive-data>");
    expect(text).toContain("Migrating from Redux");
    expect(text).toContain("Concept map");
    expect(text).toContain("Steps");
    expect(text).toContain("createSlice");
    expect(text).toContain("createModule");
  });

  it("get_migration_pattern rejects unknown source via enum schema", async () => {
    const result = await client.callTool({
      name: "get_migration_pattern",
      arguments: { source: "not-a-lib" },
    });
    expect(result.isError).toBe(true);
  });

  it("review_source returns findings for code that violates a rule", async () => {
    const result = await client.callTool({
      name: "review_source",
      arguments: {
        source: 'createModule("trafficLight", { schema: { phase: 0 } });',
      },
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain("<directive-data>");
    expect(text).toContain("module-name-not-kebab");
    expect(text).toContain("module-missing-facts-schema");
  }, 15_000);

  it("review_source returns empty findings for clean code", async () => {
    const result = await client.callTool({
      name: "review_source",
      arguments: {
        source: `createModule("traffic-light", { schema: { facts: { phase: 0 } } });`,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toContain('"findings": []');
  }, 15_000);

  it("review_source rejects oversize source pre-parse", async () => {
    const huge = "x".repeat(200_001);
    const result = await client.callTool({
      name: "review_source",
      arguments: { source: huge },
    });
    expect(result.isError).toBe(true);
  });

  it("fix_code applies a known fix and returns a diff", async () => {
    const reviewResult = await client.callTool({
      name: "review_source",
      arguments: {
        source: 'createModule("trafficLight", { schema: {} });',
        ruleFilter: ["module-name-not-kebab"],
      },
    });
    const reviewText = extractText(reviewResult);
    const parsed = JSON.parse(
      reviewText.replace(/^<directive-data>\n|\n<\/directive-data>$/g, ""),
    );
    expect(parsed.findings.length).toBeGreaterThan(0);
    const finding = parsed.findings[0];

    const fixResult = await client.callTool({
      name: "fix_code",
      arguments: {
        source: 'createModule("trafficLight", { schema: {} });',
        finding,
      },
    });
    expect(fixResult.isError).toBeFalsy();
    const fixText = extractText(fixResult);
    expect(fixText).toContain('"ok": true');
    expect(fixText).toContain("traffic-light");
    expect(fixText).toContain('"diff"');
  }, 15_000);

  it("get_server_info returns version + transport + hash manifest", async () => {
    const result = await client.callTool({
      name: "get_server_info",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = extractText(result);
    expect(text).toMatch(/@directive-run\/mcp@/);
    expect(text).toMatch(/Transport:/);
    expect(text).toMatch(/Auth enabled:/);
    expect(text).toMatch(/Bundled knowledge hash:/);
    expect(text).toMatch(/Package registry built at:/);
  });
});

function extractText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// Tools that return structured data wrap the JSON payload in a
// <directive-data>...</directive-data> fence; pull it out and parse.
function parseDirectiveData<T = Record<string, unknown>>(result: unknown): T {
  const text = extractText(result);
  const match = text.match(/<directive-data>\n([\s\S]*?)\n<\/directive-data>/);
  if (!match) {
    throw new Error(
      `response did not contain a <directive-data> block: ${text}`,
    );
  }
  return JSON.parse(match[1]!) as T;
}
