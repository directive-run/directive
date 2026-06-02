import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectiveKnowledgeServer } from "../src/server.js";

describe("createDirectiveKnowledgeServer", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = createDirectiveKnowledgeServer();
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
      "get_example",
      "get_knowledge",
      "get_skill",
      "list_examples",
      "list_knowledge",
      "list_skills",
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
});

function extractText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
