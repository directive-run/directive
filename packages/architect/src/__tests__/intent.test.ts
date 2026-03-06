/**
 * Tests for intent-based story configuration.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveStories, mergeStoryConfig } from "../intent.js";
import type { AIArchitectOptions } from "../types.js";
import type { AgentRunner } from "@directive-run/ai";

// ============================================================================
// Helpers
// ============================================================================

function createMockSystem(facts: Record<string, unknown> = { status: "ok", errorCount: 0 }) {
  return {
    facts,
    inspect: () => ({ facts, constraints: [], resolvers: [] }),
    subscribe: () => () => {},
    onSettledChange: () => () => {},
    batch: (fn: () => void) => fn(),
    explain: () => null,
    constraints: {
      register: () => {},
      unregister: () => {},
      listDynamic: () => [],
      isDynamic: () => false,
    },
    resolvers: {
      register: () => {},
      unregister: () => {},
      listDynamic: () => [],
      isDynamic: () => false,
    },
    effects: {
      register: () => {},
      unregister: () => {},
      listDynamic: () => [],
      isDynamic: () => false,
    },
    derivations: {
      register: () => {},
      unregister: () => {},
      listDynamic: () => [],
      isDynamic: () => false,
    },
  };
}

function createMockRunner(response: string): AgentRunner {
  return (async () => ({
    output: response,
    messages: [],
    toolCalls: [],
    totalTokens: 50,
  })) as AgentRunner;
}

// ============================================================================
// resolveStories
// ============================================================================

describe("resolveStories", () => {
  it("resolves plain string stories into config", async () => {
    const response = JSON.stringify({
      context: {
        goals: ["Keep error count under 10"],
      },
      triggers: {
        onFactChange: ["errorCount"],
      },
    });

    const result = await resolveStories(
      ["Keep error count under 10"],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect(result.config.context?.goals).toEqual(["Keep error count under 10"]);
    expect(result.config.triggers?.onFactChange).toEqual(["errorCount"]);
    expect(result.rawResponse).toBe(response);
  });

  it("resolves structured stories", async () => {
    const response = JSON.stringify({
      triggers: {
        onError: true,
      },
      capabilities: {
        constraints: true,
        resolvers: true,
      },
    });

    const result = await resolveStories(
      [
        {
          when: "errors spike",
          iWant: "add constraints and resolvers",
          soThat: "the system recovers",
        },
      ],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect(result.config.triggers?.onError).toBe(true);
    expect(result.config.capabilities?.constraints).toBe(true);
  });

  it("handles JSON in markdown fences", async () => {
    const response = '```json\n{"context": {"goals": ["test"]}}\n```';

    const result = await resolveStories(
      ["test"],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect(result.config.context?.goals).toEqual(["test"]);
  });

  it("returns empty config on invalid JSON", async () => {
    const result = await resolveStories(
      ["test"],
      createMockSystem() as any,
      createMockRunner("not json at all"),
    );

    expect(result.config).toEqual({});
    expect(result.rawResponse).toBe("not json at all");
  });

  it("validates approval levels", async () => {
    const response = JSON.stringify({
      safety: {
        approval: {
          constraints: "always",
          resolvers: "invalid-value",
        },
      },
    });

    const result = await resolveStories(
      ["test"],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect((result.config.safety as any)?.approval?.constraints).toBe("always");
    expect((result.config.safety as any)?.approval?.resolvers).toBeUndefined();
  });

  it("validates interval format", async () => {
    const response = JSON.stringify({
      triggers: {
        onSchedule: "5m",
        minInterval: 30000,
      },
    });

    const result = await resolveStories(
      ["test"],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect(result.config.triggers?.onSchedule).toBe("5m");
    expect(result.config.triggers?.minInterval).toBe(30000);
  });

  it("rejects invalid interval format", async () => {
    const response = JSON.stringify({
      triggers: {
        onSchedule: "every 5 minutes",
      },
    });

    const result = await resolveStories(
      ["test"],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect(result.config.triggers?.onSchedule).toBeUndefined();
  });

  it("validates capabilities", async () => {
    const response = JSON.stringify({
      capabilities: {
        constraints: true,
        effects: false,
        facts: "read-write",
      },
    });

    const result = await resolveStories(
      ["test"],
      createMockSystem() as any,
      createMockRunner(response),
    );

    expect(result.config.capabilities?.constraints).toBe(true);
    expect(result.config.capabilities?.effects).toBe(false);
    expect(result.config.capabilities?.facts).toBe("read-write");
  });

  it("passes system schema keys to the LLM", async () => {
    const calls: string[] = [];
    const runner = (async (_agent: unknown, input: string) => {
      calls.push(input);

      return {
        output: "{}",
        messages: [],
        toolCalls: [],
        totalTokens: 50,
      };
    }) as AgentRunner;

    await resolveStories(
      ["test"],
      createMockSystem({ status: "ok", errorCount: 0 }) as any,
      runner,
    );

    expect(calls[0]).toContain("status");
    expect(calls[0]).toContain("errorCount");
  });
});

// ============================================================================
// mergeStoryConfig
// ============================================================================

describe("mergeStoryConfig", () => {
  it("story-derived config provides defaults", () => {
    const base: Partial<AIArchitectOptions> = {};
    const story: Partial<AIArchitectOptions> = {
      context: { goals: ["from story"] },
    };

    const result = mergeStoryConfig(base, story);
    expect(result.context?.goals).toEqual(["from story"]);
  });

  it("explicit config overrides story-derived values", () => {
    const base: Partial<AIArchitectOptions> = {
      context: { goals: ["explicit goal"] },
    };
    const story: Partial<AIArchitectOptions> = {
      context: { goals: ["story goal"], description: "from story" },
    };

    const result = mergeStoryConfig(base, story);
    // Explicit goals override story goals
    expect(result.context?.goals).toEqual(["explicit goal"]);
    // Story description is kept since not in explicit
    expect(result.context?.description).toBe("from story");
  });

  it("deep merges nested objects", () => {
    const base: Partial<AIArchitectOptions> = {
      safety: {
        approval: { constraints: "always" },
      },
    };
    const story: Partial<AIArchitectOptions> = {
      safety: {
        approval: { resolvers: "first-time" },
      },
    };

    const result = mergeStoryConfig(base, story);
    const safety = result.safety as any;
    expect(safety.approval.constraints).toBe("always");
    expect(safety.approval.resolvers).toBe("first-time");
  });

  it("explicit scalar values override story scalars", () => {
    const base: Partial<AIArchitectOptions> = {
      model: "gpt-4",
    };
    const story: Partial<AIArchitectOptions> = {
      model: "gpt-3.5",
    };

    const result = mergeStoryConfig(base, story);
    expect(result.model).toBe("gpt-4");
  });

  it("handles undefined values in base", () => {
    const base: Partial<AIArchitectOptions> = {
      model: undefined,
    };
    const story: Partial<AIArchitectOptions> = {
      model: "from-story",
    };

    const result = mergeStoryConfig(base, story);
    expect(result.model).toBe("from-story");
  });
});
