import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCache,
  getAllExamples,
  getAllKnowledge,
  getExample,
  getExampleFiles,
  getKnowledge,
  getKnowledgeFiles,
} from "../src/index.js";

beforeEach(() => {
  clearCache();
});

describe("getKnowledge", () => {
  it("returns non-empty string for core-patterns", () => {
    const content = getKnowledge("core-patterns");
    expect(content).toBeTruthy();
    expect(typeof content).toBe("string");
  });

  it("returns non-empty string for anti-patterns", () => {
    expect(getKnowledge("anti-patterns")).toBeTruthy();
  });

  it("returns non-empty string for constraints", () => {
    expect(getKnowledge("constraints")).toBeTruthy();
  });

  it("returns non-empty string for resolvers", () => {
    expect(getKnowledge("resolvers")).toBeTruthy();
  });

  it("returns non-empty string for AI knowledge (ai-orchestrator)", () => {
    expect(getKnowledge("ai-orchestrator")).toBeTruthy();
  });

  it("returns empty string for unknown knowledge name", () => {
    expect(getKnowledge("nonexistent-file-that-does-not-exist")).toBe("");
  });

  it("returns empty string for empty string name", () => {
    expect(getKnowledge("")).toBe("");
  });
});

describe("getAllKnowledge", () => {
  it("returns a Map", () => {
    const all = getAllKnowledge();
    expect(all).toBeInstanceOf(Map);
  });

  it("has at least 25 entries", () => {
    const all = getAllKnowledge();
    expect(all.size).toBeGreaterThanOrEqual(25);
  });

  it("includes core knowledge files", () => {
    const all = getAllKnowledge();
    expect(all.has("core-patterns")).toBe(true);
    expect(all.has("anti-patterns")).toBe(true);
    expect(all.has("constraints")).toBe(true);
    expect(all.has("resolvers")).toBe(true);
    expect(all.has("schema-types")).toBe(true);
    expect(all.has("plugins")).toBe(true);
  });

  it("includes AI knowledge files", () => {
    const all = getAllKnowledge();
    expect(all.has("ai-orchestrator")).toBe(true);
    expect(all.has("ai-agents-streaming")).toBe(true);
    expect(all.has("ai-guardrails-memory")).toBe(true);
  });

  it("includes api-skeleton", () => {
    const all = getAllKnowledge();
    expect(all.has("api-skeleton")).toBe(true);
    expect(all.get("api-skeleton")).toBeTruthy();
  });

  it("returns ReadonlyMap (same reference on repeated calls)", () => {
    const first = getAllKnowledge();
    const second = getAllKnowledge();
    expect(first).toBe(second);
  });

  it("all values are non-empty strings", () => {
    const all = getAllKnowledge();

    for (const [key, value] of all) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
      expect(value.length, `knowledge "${key}" should not be empty`).toBeGreaterThan(0);
    }
  });
});

describe("getExample", () => {
  it("returns non-empty string for counter example", () => {
    const content = getExample("counter");
    expect(content).toBeTruthy();
    expect(typeof content).toBe("string");
  });

  it("returns non-empty string for auth-flow example", () => {
    expect(getExample("auth-flow")).toBeTruthy();
  });

  it("returns non-empty string for shopping-cart example", () => {
    expect(getExample("shopping-cart")).toBeTruthy();
  });

  it("returns empty string for unknown example name", () => {
    expect(getExample("nonexistent-example-xyz")).toBe("");
  });

  it("returns empty string for empty string name", () => {
    expect(getExample("")).toBe("");
  });

  it("example content contains Directive imports", () => {
    const counter = getExample("counter");
    expect(counter).toMatch(/createModule|createSystem/);
  });

  it("auth-flow example contains Directive imports", () => {
    const auth = getExample("auth-flow");
    expect(auth).toMatch(/createModule|createSystem/);
  });
});

describe("getAllExamples", () => {
  it("returns a Map", () => {
    const all = getAllExamples();
    expect(all).toBeInstanceOf(Map);
  });

  it("has at least 30 entries", () => {
    const all = getAllExamples();
    expect(all.size).toBeGreaterThanOrEqual(30);
  });

  it("includes expected example names", () => {
    const all = getAllExamples();
    expect(all.has("counter")).toBe(true);
    expect(all.has("auth-flow")).toBe(true);
    expect(all.has("shopping-cart")).toBe(true);
    expect(all.has("websocket")).toBe(true);
    expect(all.has("notifications")).toBe(true);
  });

  it("returns ReadonlyMap (same reference on repeated calls)", () => {
    const first = getAllExamples();
    const second = getAllExamples();
    expect(first).toBe(second);
  });

  it("all values are non-empty strings", () => {
    const all = getAllExamples();

    for (const [key, value] of all) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
      expect(value.length, `example "${key}" should not be empty`).toBeGreaterThan(0);
    }
  });
});

describe("getKnowledgeFiles", () => {
  it("joins multiple knowledge files with --- separator", () => {
    const result = getKnowledgeFiles(["core-patterns", "constraints"]);
    expect(result).toContain("---");

    const coreContent = getKnowledge("core-patterns");
    const constraintsContent = getKnowledge("constraints");
    expect(result).toContain(coreContent);
    expect(result).toContain(constraintsContent);
  });

  it("uses double newline + --- + double newline as separator", () => {
    const result = getKnowledgeFiles(["core-patterns", "constraints"]);
    expect(result).toContain("\n\n---\n\n");
  });

  it("filters out missing/unknown names", () => {
    const result = getKnowledgeFiles(["core-patterns", "does-not-exist", "constraints"]);
    const parts = result.split("\n\n---\n\n");
    expect(parts).toHaveLength(2);
  });

  it("returns empty string when all names are missing", () => {
    const result = getKnowledgeFiles(["nope", "also-nope", "still-nope"]);
    expect(result).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(getKnowledgeFiles([])).toBe("");
  });

  it("handles single file without separator", () => {
    const result = getKnowledgeFiles(["core-patterns"]);
    expect(result).not.toContain("---");
    expect(result).toBe(getKnowledge("core-patterns"));
  });
});

describe("getExampleFiles", () => {
  it("formats with ### Example: name header", () => {
    const result = getExampleFiles(["counter"]);
    expect(result).toContain("### Example: counter");
  });

  it("wraps content in typescript code blocks", () => {
    const result = getExampleFiles(["counter"]);
    expect(result).toContain("```typescript");
    expect(result).toContain("```");
  });

  it("includes actual example content inside code block", () => {
    const result = getExampleFiles(["counter"]);
    const rawContent = getExample("counter");
    expect(result).toContain(rawContent);
  });

  it("formats multiple examples separated by double newlines", () => {
    const result = getExampleFiles(["counter", "auth-flow"]);
    expect(result).toContain("### Example: counter");
    expect(result).toContain("### Example: auth-flow");

    const parts = result.split("\n\n### Example:");
    expect(parts).toHaveLength(2);
  });

  it("filters out missing examples", () => {
    const result = getExampleFiles(["counter", "does-not-exist", "auth-flow"]);
    expect(result).toContain("### Example: counter");
    expect(result).toContain("### Example: auth-flow");
    expect(result).not.toContain("does-not-exist");
  });

  it("returns empty string when all names are missing", () => {
    const result = getExampleFiles(["nope", "also-nope"]);
    expect(result).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(getExampleFiles([])).toBe("");
  });
});

describe("clearCache", () => {
  it("does not throw when called before any reads", () => {
    expect(() => clearCache()).not.toThrow();
  });

  it("allows subsequent reads after clearing", () => {
    // Load caches
    getKnowledge("core-patterns");
    getExample("counter");

    // Clear
    clearCache();

    // Re-read should work fine
    const knowledge = getKnowledge("core-patterns");
    const example = getExample("counter");
    expect(knowledge).toBeTruthy();
    expect(example).toBeTruthy();
  });

  it("breaks reference identity (new Map after clear)", () => {
    const before = getAllKnowledge();
    clearCache();
    const after = getAllKnowledge();
    expect(before).not.toBe(after);
  });

  it("breaks example reference identity (new Map after clear)", () => {
    const before = getAllExamples();
    clearCache();
    const after = getAllExamples();
    expect(before).not.toBe(after);
  });

  it("can be called multiple times without error", () => {
    clearCache();
    clearCache();
    clearCache();
    expect(() => getKnowledge("core-patterns")).not.toThrow();
  });
});
