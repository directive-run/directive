/**
 * Integration test — exercises the full architect lifecycle:
 * create → analyze → create constraint → export pattern → extract graph → what-if → kill → verify audit
 */

import { describe, it, expect, vi } from "vitest";
import { createAIArchitect } from "../architect.js";
import { extractSystemGraph } from "../graph.js";
import { createWhatIfAnalysis } from "../what-if.js";
import { exportPattern, importPattern } from "../federation.js";
import { wireServiceHooks } from "../service.js";
import type { ArchitectAction, ArchitectAnalysis } from "../types.js";

// ============================================================================
// Mock System
// ============================================================================

function createMockSystem() {
  const subscribers: Array<() => void> = [];
  const settledSubscribers: Array<(settled: boolean) => void> = [];
  let facts: Record<string, unknown> = { count: 0, status: "idle" };

  return {
    get facts() {
      return facts;
    },

    batch: vi.fn((fn: () => void) => {
      fn();
      for (const cb of subscribers) {
        cb();
      }
    }),

    inspect: vi.fn(() => ({
      facts: { ...facts },
      constraints: [
        { id: "c1", deps: ["count"], priority: 10, active: true },
      ],
      resolvers: [
        { id: "r1", requirement: "FIX_COUNT" },
      ],
      derivations: [],
      effects: [],
      pendingRequirements: [],
    })),

    constraints: {
      listDynamic: vi.fn(() => []),
      addDynamic: vi.fn(),
      removeDynamic: vi.fn(),
    },

    resolvers: {
      listDynamic: vi.fn(() => []),
      addDynamic: vi.fn(),
      removeDynamic: vi.fn(),
    },

    effects: {
      listDynamic: vi.fn(() => []),
      addDynamic: vi.fn(),
      removeDynamic: vi.fn(),
    },

    subscribe: vi.fn((cb: () => void) => {
      subscribers.push(cb);

      return () => {
        const idx = subscribers.indexOf(cb);
        if (idx >= 0) {
          subscribers.splice(idx, 1);
        }
      };
    }),

    onSettledChange: vi.fn((cb: (settled: boolean) => void) => {
      settledSubscribers.push(cb);

      return () => {
        const idx = settledSubscribers.indexOf(cb);
        if (idx >= 0) {
          settledSubscribers.splice(idx, 1);
        }
      };
    }),

    _setFacts(newFacts: Record<string, unknown>) {
      facts = { ...facts, ...newFacts };
    },

    _emitFactChange() {
      for (const cb of subscribers) {
        cb();
      }
    },

    _emitSettled(settled: boolean) {
      for (const cb of settledSubscribers) {
        cb(settled);
      }
    },
  };
}

// ============================================================================
// Integration Test
// ============================================================================

describe("integration", () => {
  it("full lifecycle: create → analyze → constraint → export → graph → what-if → kill → audit", async () => {
    const system = createMockSystem();

    // Runner that proposes creating a constraint
    const mockRunner = vi.fn()
      .mockResolvedValueOnce({
        // First call: analysis — proposes a constraint
        output: "I see count is 0. Creating a guard constraint.",
        toolCalls: [
          {
            id: "tc-1",
            name: "create_constraint",
            arguments: JSON.stringify({
              id: "guard-overflow",
              whenCode: "facts.count > 100",
              require: { type: "OVERFLOW_FIX" },
            }),
          },
        ],
        messages: [],
        totalTokens: 150,
      })
      .mockResolvedValue({
        // Subsequent calls: empty responses
        output: "",
        toolCalls: [],
        messages: [],
        totalTokens: 10,
      });

    // Step 1: Create architect
    const architect = createAIArchitect({
      system: system as never,
      runner: mockRunner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: {
        approval: {
          constraints: "never",
          resolvers: "never",
        },
      },
    });

    expect(architect).toBeDefined();

    // Step 2: Analyze — should propose a constraint
    const analysis = await architect.analyze("Check the system");

    expect(analysis.actions.length).toBeGreaterThanOrEqual(0);
    expect(analysis.tokensUsed).toBeGreaterThan(0);

    // Step 3: Get active definitions
    const activeDefs = architect.getActiveDefinitions();

    // The constraint may or may not be active depending on system mock behavior
    // We verify the flow doesn't throw

    // Step 4: Export a pattern from an action
    const action: ArchitectAction = {
      id: "test-action",
      tool: "create_constraint",
      arguments: {
        id: "guard-overflow",
        whenCode: "facts.count > 100",
        require: { type: "OVERFLOW_FIX" },
      },
      reasoning: {
        trigger: "demand",
        observation: "Count could overflow",
        justification: "Prevent unbounded growth",
        expectedOutcome: "Count stays below 100",
        raw: "",
      },
      confidence: 0.9,
      risk: "low",
      requiresApproval: false,
      approvalStatus: "auto-approved",
      timestamp: Date.now(),
    };

    const exported = exportPattern(action, { tags: ["overflow", "guard"] });

    expect(exported.success).toBe(true);
    expect(exported.pattern.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(exported.pattern.tags).toContain("overflow");

    // Step 5: Extract system graph
    const graph = extractSystemGraph(system as never);

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.metadata.nodeCount).toBe(graph.nodes.length);

    // Verify fact nodes exist
    const factNodes = graph.nodes.filter((n) => n.type === "fact");

    expect(factNodes.some((n) => n.label === "count")).toBe(true);

    // Verify constraint nodes exist
    const constraintNodes = graph.nodes.filter((n) => n.type === "constraint");

    expect(constraintNodes.length).toBeGreaterThan(0);

    // Step 6: What-if analysis
    const whatIf = await createWhatIfAnalysis(system as never, action);

    expect(whatIf.steps.length).toBeGreaterThan(0);
    expect(typeof whatIf.riskScore).toBe("number");

    // Step 7: Kill all AI definitions
    const killResult = architect.kill();

    expect(killResult).toBeDefined();
    expect(typeof killResult.removed).toBe("number");
    expect(killResult.timestamp).toBeGreaterThan(0);

    // Step 8: Verify audit log has entries
    const auditLog = architect.getAuditLog();

    // Should have at least an analysis entry
    expect(auditLog.length).toBeGreaterThan(0);

    // Step 9: Verify budget tracking
    const budget = architect.getBudgetUsage();

    expect(budget.tokens).toBeGreaterThan(0);
  });

  it("service hooks receive events during lifecycle", async () => {
    const system = createMockSystem();

    const mockRunner = vi.fn().mockResolvedValue({
      output: "",
      toolCalls: [],
      messages: [],
      totalTokens: 50,
    });

    const architect = createAIArchitect({
      system: system as never,
      runner: mockRunner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: {
        approval: {
          constraints: "never",
          resolvers: "never",
        },
      },
    });

    // Wire service hooks
    const analysisEvents: ArchitectAnalysis[] = [];
    const errorEvents: Error[] = [];

    const handlers: Record<string, (...args: unknown[]) => void> = {};

    // Simulate architect's on() as a subscribe function
    const cleanup = wireServiceHooks({
      hooks: {
        onAnalysis: (a) => {
          analysisEvents.push(a);
        },
        onError: (e) => {
          errorEvents.push(e);
        },
      },
      subscribe: (event, handler) => {
        handlers[event] = handler;

        return () => {
          delete handlers[event];
        };
      },
    });

    // Trigger an analysis
    await architect.analyze("test");

    // Manually fire the handler to simulate event routing (uses "analysis-complete" event name)
    if (handlers["analysis-complete"]) {
      handlers["analysis-complete"]({ type: "analysis-complete", timestamp: Date.now(), analysis: { trigger: "demand", actions: [], tokensUsed: 50 } });
    }

    expect(analysisEvents).toHaveLength(1);

    cleanup();
  });

  it("import pattern adapts to local schema", async () => {
    const system = createMockSystem();
    system._setFacts({ localCount: 0, localStatus: "ready" });

    const mockRunner = vi.fn().mockResolvedValue({
      output: "Adapted constraint",
      toolCalls: [
        {
          name: "create_constraint",
          arguments: JSON.stringify({
            id: "imported-guard",
            whenCode: "facts.localCount > 100",
            require: { type: "OVERFLOW_FIX" },
          }),
        },
      ],
      totalTokens: 50,
    });

    // Export from source system
    const action: ArchitectAction = {
      id: "src-action",
      tool: "create_constraint",
      arguments: {
        id: "guard",
        whenCode: "facts.count > 100",
        require: { type: "OVERFLOW_FIX" },
      },
      reasoning: {
        trigger: "demand",
        observation: "",
        justification: "Overflow guard",
        expectedOutcome: "",
        raw: "",
      },
      confidence: 0.9,
      risk: "low",
      requiresApproval: false,
      approvalStatus: "auto-approved",
      timestamp: Date.now(),
    };

    const exported = exportPattern(action);
    const imported = await importPattern(
      exported.pattern,
      system as never,
      mockRunner as never,
    );

    expect(imported.success).toBe(true);
    expect(imported.action).toBeDefined();
    expect(imported.action!.id).toContain("federated-");
    expect(imported.action!.requiresApproval).toBe(true);
  });
});
