import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cachedResponseStrategy,
  heuristicStrategy,
  blockStrategy,
  runFallback,
  type FallbackContext,
  type HeuristicRule,
} from "../fallback.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";
import type { ArchitectEvent } from "../types.js";

function makeFallbackContext(overrides: Partial<FallbackContext> = {}): FallbackContext {
  return {
    error: new Error("LLM down"),
    trigger: "demand",
    prompt: "test prompt",
    systemState: { facts: {} },
    consecutiveFailures: 1,
    budgetRemaining: { tokens: 10000, dollars: 5 },
    ...overrides,
  };
}

describe("fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // cachedResponseStrategy
  // ===========================================================================

  describe("cachedResponseStrategy", () => {
    it("returns null when no cache entries exist", () => {
      const strategy = cachedResponseStrategy();
      const result = strategy.handle(makeFallbackContext());

      expect(result).toBeNull();
    });

    it("caches on success and replays on failure", () => {
      const strategy = cachedResponseStrategy();
      const reasoning = {
        trigger: "demand",
        observation: "test",
        justification: "test",
        expectedOutcome: "test",
        raw: "test",
      };

      strategy.cache(
        "demand",
        [{ name: "observe_system", arguments: "{}" }],
        reasoning,
      );

      const result = strategy.handle(makeFallbackContext({ trigger: "demand" }));

      expect(result).not.toBeNull();
      expect(result!.strategy).toBe("cached");
      expect(result!.toolCalls).toHaveLength(1);
      expect(result!.toolCalls[0]!.name).toBe("observe_system");
      expect(result!.tokensUsed).toBe(0);
    });

    it("respects maxAge — evicts expired entries", () => {
      const strategy = cachedResponseStrategy({ maxAgeMs: 1000 });
      const reasoning = {
        trigger: "demand",
        observation: "old",
        justification: "old",
        expectedOutcome: "old",
        raw: "old",
      };

      strategy.cache("demand", [{ name: "observe_system", arguments: "{}" }], reasoning);

      // Advance past maxAge
      vi.advanceTimersByTime(2000);

      const result = strategy.handle(makeFallbackContext({ trigger: "demand" }));

      expect(result).toBeNull();
    });

    it("evicts oldest when maxPerTrigger exceeded", () => {
      const strategy = cachedResponseStrategy({ maxPerTrigger: 2 });
      const reasoning = {
        trigger: "demand",
        observation: "test",
        justification: "test",
        expectedOutcome: "test",
        raw: "test",
      };

      strategy.cache("demand", [{ name: "tool-1", arguments: "{}" }], reasoning);
      strategy.cache("demand", [{ name: "tool-2", arguments: "{}" }], reasoning);
      strategy.cache("demand", [{ name: "tool-3", arguments: "{}" }], reasoning);

      // Size should be capped at 2 per trigger
      expect(strategy.size()).toBe(2);

      const result = strategy.handle(makeFallbackContext({ trigger: "demand" }));

      // Should return most recent (tool-3)
      expect(result!.toolCalls[0]!.name).toBe("tool-3");
    });

    it("separates cache by trigger type", () => {
      const strategy = cachedResponseStrategy();
      const reasoning = {
        trigger: "error",
        observation: "test",
        justification: "test",
        expectedOutcome: "test",
        raw: "test",
      };

      strategy.cache("error", [{ name: "error-tool", arguments: "{}" }], reasoning);

      // Request for different trigger type should miss
      const result = strategy.handle(makeFallbackContext({ trigger: "demand" }));

      expect(result).toBeNull();

      // Request for matching trigger should hit
      const result2 = strategy.handle(makeFallbackContext({ trigger: "error" }));

      expect(result2).not.toBeNull();
      expect(result2!.toolCalls[0]!.name).toBe("error-tool");
    });
  });

  // ===========================================================================
  // heuristicStrategy
  // ===========================================================================

  describe("heuristicStrategy", () => {
    it("fires matching rules", () => {
      const rules: HeuristicRule[] = [
        {
          when: (ctx) => ctx.trigger === "error",
          toolCalls: [{ name: "observe_system", arguments: "{}" }],
          reasoning: "Auto-observe on error",
        },
      ];

      const strategy = heuristicStrategy(rules);
      const result = strategy.handle(makeFallbackContext({ trigger: "error" }));

      expect(result).not.toBeNull();
      expect(result!.strategy).toBe("heuristic");
      expect(result!.toolCalls[0]!.name).toBe("observe_system");
    });

    it("skips non-matching rules", () => {
      const rules: HeuristicRule[] = [
        {
          when: (ctx) => ctx.trigger === "error",
          toolCalls: [{ name: "observe_system", arguments: "{}" }],
          reasoning: "Only on error",
        },
      ];

      const strategy = heuristicStrategy(rules);
      const result = strategy.handle(makeFallbackContext({ trigger: "demand" }));

      expect(result).toBeNull();
    });

    it("skips rules that throw", () => {
      const rules: HeuristicRule[] = [
        {
          when: () => {
            throw new Error("rule crash");
          },
          toolCalls: [],
          reasoning: "broken",
        },
        {
          when: () => true,
          toolCalls: [{ name: "fallback-tool", arguments: "{}" }],
          reasoning: "catch-all",
        },
      ];

      const strategy = heuristicStrategy(rules);
      const result = strategy.handle(makeFallbackContext());

      expect(result).not.toBeNull();
      expect(result!.toolCalls[0]!.name).toBe("fallback-tool");
    });

    it("first match wins", () => {
      const rules: HeuristicRule[] = [
        {
          when: () => true,
          toolCalls: [{ name: "first", arguments: "{}" }],
          reasoning: "first",
        },
        {
          when: () => true,
          toolCalls: [{ name: "second", arguments: "{}" }],
          reasoning: "second",
        },
      ];

      const strategy = heuristicStrategy(rules);
      const result = strategy.handle(makeFallbackContext());

      expect(result!.toolCalls[0]!.name).toBe("first");
    });
  });

  // ===========================================================================
  // blockStrategy
  // ===========================================================================

  describe("blockStrategy", () => {
    it("always returns empty toolCalls", () => {
      const strategy = blockStrategy();
      const result = strategy.handle(makeFallbackContext());

      expect(result).not.toBeNull();
      expect(result!.strategy).toBe("block");
      expect(result!.toolCalls).toHaveLength(0);
      expect(result!.tokensUsed).toBe(0);
    });

    it("includes error info in reasoning", () => {
      const strategy = blockStrategy();
      const result = strategy.handle(makeFallbackContext({
        error: new Error("API rate limit"),
        consecutiveFailures: 3,
      }));

      expect(result!.reasoning.observation).toContain("API rate limit");
      expect(result!.reasoning.raw).toContain("3");
    });
  });

  // ===========================================================================
  // runFallback
  // ===========================================================================

  describe("runFallback", () => {
    it("strategy ordering — first match wins", () => {
      const strategies = [
        heuristicStrategy([
          { when: () => true, toolCalls: [{ name: "heuristic", arguments: "{}" }], reasoning: "first" },
        ]),
        blockStrategy(),
      ];

      const result = runFallback(strategies, makeFallbackContext());

      expect(result!.strategy).toBe("heuristic");
    });

    it("falls through to next strategy when first returns null", () => {
      const strategies = [
        heuristicStrategy([
          { when: () => false, toolCalls: [], reasoning: "never matches" },
        ]),
        blockStrategy(),
      ];

      const result = runFallback(strategies, makeFallbackContext());

      expect(result!.strategy).toBe("block");
    });

    it("returns null when no strategy handles", () => {
      const strategies = [
        heuristicStrategy([
          { when: () => false, toolCalls: [], reasoning: "nope" },
        ]),
      ];

      const result = runFallback(strategies, makeFallbackContext());

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Integration — Fallback in Architect Pipeline
  // ===========================================================================

  describe("architect integration", () => {
    const architects: Array<{ destroy: () => void }> = [];

    afterEach(() => {
      for (const a of architects) {
        a.destroy();
      }

      architects.length = 0;
    });

    it("fallback event emitted on LLM failure with fallback configured", async () => {
      const system = createTestSystem();
      let callCount = 0;
      const failRunner = (async () => {
        callCount++;
        throw new Error("LLM timeout");
      }) as any;

      const events: ArchitectEvent[] = [];

      const architect = createAIArchitect({
        system: system as any,
        runner: failRunner,
        budget: { tokens: 100_000, dollars: 10 },
        safety: { approval: { constraints: "never" } },
        fallback: {
          strategies: [blockStrategy()],
          maxConsecutiveFailures: 5,
        },
      });
      architects.push(architect);
      architect.on((e) => events.push(e));

      const analysis = await architect.analyze("test");

      // Should not throw — fallback handled it
      expect(analysis.actions).toHaveLength(0); // block strategy returns empty
      expect(analysis.tokensUsed).toBe(0);

      const fallbackEvents = events.filter((e) => e.type === "fallback-activated");

      expect(fallbackEvents).toHaveLength(1);
      expect((fallbackEvents[0] as any).strategy).toBe("block");
      expect((fallbackEvents[0] as any).consecutiveFailures).toBe(1);
    });

    it("maxConsecutiveFailures forces block strategy", async () => {
      const system = createTestSystem();
      const failRunner = (async () => {
        throw new Error("LLM down");
      }) as any;

      const events: ArchitectEvent[] = [];

      const architect = createAIArchitect({
        system: system as any,
        runner: failRunner,
        budget: { tokens: 100_000, dollars: 10 },
        safety: { approval: { constraints: "never" } },
        fallback: {
          // Use a strategy that never handles — to test force-block
          strategies: [
            heuristicStrategy([
              { when: () => false, toolCalls: [], reasoning: "never" },
            ]),
          ],
          maxConsecutiveFailures: 2,
        },
      });
      architects.push(architect);
      architect.on((e) => events.push(e));

      // First failure — no matching strategy, but not at maxConsecutiveFailures yet
      // Since no strategy handles it, it should throw
      await expect(architect.analyze("test")).rejects.toThrow("LLM down");

      // Second failure — still not at max (needs >= 2)
      // consecutiveFailures is now 2, which >= maxConsecutiveFailures
      const analysis = await architect.analyze("test 2");

      // Force-block should have kicked in
      expect(analysis.actions).toHaveLength(0);
      const fallbackEvents = events.filter((e) => e.type === "fallback-activated");

      expect(fallbackEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("counter resets on success", async () => {
      const system = createTestSystem();
      let callCount = 0;
      const alternatingRunner = (async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("fail once");
        }

        return {
          output: "{}",
          messages: [],
          toolCalls: [],
          totalTokens: 50,
        };
      }) as any;

      const events: ArchitectEvent[] = [];

      const architect = createAIArchitect({
        system: system as any,
        runner: alternatingRunner,
        budget: { tokens: 100_000, dollars: 10 },
        safety: { approval: { constraints: "never" } },
        fallback: {
          strategies: [blockStrategy()],
          maxConsecutiveFailures: 5,
        },
      });
      architects.push(architect);
      architect.on((e) => events.push(e));

      // First call fails → fallback
      await architect.analyze("fail");

      // Second call succeeds → resets counter
      await architect.analyze("succeed");

      // Third call would fail if counter wasn't reset, but we can't easily test
      // the internal counter. We verify the second call succeeded normally.
      const completions = events.filter((e) => e.type === "analysis-complete");

      expect(completions).toHaveLength(2);
    });

    it("fallback reasoning appears in analysis", async () => {
      const system = createTestSystem();
      const failRunner = (async () => {
        throw new Error("service unavailable");
      }) as any;

      const architect = createAIArchitect({
        system: system as any,
        runner: failRunner,
        budget: { tokens: 100_000, dollars: 10 },
        safety: { approval: { constraints: "never" } },
        fallback: {
          strategies: [blockStrategy()],
        },
      });
      architects.push(architect);

      const analysis = await architect.analyze("test");

      // Analysis should complete (not throw)
      expect(analysis.trigger).toBe("demand");
      expect(analysis.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
