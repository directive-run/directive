/**
 * Test utilities for @directive-run/architect.
 *
 * @example
 * ```typescript
 * import { createTestArchitect, mockRunner } from '@directive-run/architect/testing';
 *
 * const runner = mockRunner([
 *   { toolCalls: [{ name: 'observe_system', arguments: '{}' }] },
 * ]);
 *
 * // Item 9: system is first arg, returns { architect, runner, events }
 * const { architect, runner: r, events } = createTestArchitect(system, { runner });
 * const analysis = await architect.analyze("test");
 * ```
 *
 * @module
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type {
  AIArchitect,
  AIArchitectOptions,
  ArchitectAction,
  ArchitectAnalysis,
} from "./types.js";
import { createAIArchitect } from "./architect.js";

// ============================================================================
// Mock Runner
// ============================================================================

export interface MockRunnerResponse {
  output?: unknown;
  toolCalls?: Array<{
    name: string;
    arguments: string | Record<string, unknown>;
    result?: string;
  }>;
  totalTokens?: number;
}

/**
 * Create a mock AgentRunner that returns pre-configured responses.
 * Responses are consumed in order. After exhaustion, returns empty results.
 */
export function mockRunner(
  responses: MockRunnerResponse[],
): AgentRunner {
  let callIndex = 0;
  const calls: Array<{ agent: unknown; input: string }> = [];

  let tcCounter = 0;

  const runner = (async (_agent: unknown, input: string) => {
    calls.push({ agent: _agent, input });

    const response = responses[callIndex] ?? { output: "", toolCalls: [] };
    callIndex++;

    const toolCalls = (response.toolCalls ?? []).map((tc) => ({
      id: `tc-${++tcCounter}`,
      name: tc.name,
      arguments:
        typeof tc.arguments === "string"
          ? tc.arguments
          : JSON.stringify(tc.arguments),
      result: tc.result,
    }));

    return {
      output: response.output ?? "",
      messages: [],
      toolCalls,
      totalTokens: response.totalTokens ?? 100,
    };
  }) as AgentRunner;

  // Attach call history for assertions
  (runner as unknown as { calls: typeof calls }).calls = calls;

  return runner;
}

// ============================================================================
// Test Architect Factory
// ============================================================================

export interface TestArchitectOptions {
  /** Mock runner. If not provided, creates one with empty responses. */
  runner?: AgentRunner;
  /** Override any architect options. */
  overrides?: Partial<AIArchitectOptions>;
}

export interface TestArchitectResult {
  architect: AIArchitect;
  runner: AgentRunner;
  /** Get all events emitted. */
  events: Array<{ type: string; [key: string]: unknown }>;
}

/**
 * Create an AI Architect configured for testing.
 * Requires a pre-created system (use createSystem from @directive-run/core).
 *
 * @param system - A Directive system to attach to.
 * @param options - Test configuration.
 */
export function createTestArchitect(
  // M14: properly typed as System
  system: System,
  options?: TestArchitectOptions,
): TestArchitectResult {
  const runner = options?.runner ?? mockRunner([]);
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  const architect = createAIArchitect({
    system: system as AIArchitectOptions["system"],
    runner,
    budget: { tokens: 100_000, dollars: 10 },
    safety: {
      approval: {
        constraints: "never",
        resolvers: "never",
      },
    },
    ...options?.overrides,
  });

  architect.on((event) => {
    events.push({ ...event });
  });

  return { architect, runner, events };
}

// ============================================================================
// Item 21: Test System Factory
// ============================================================================

export interface TestSystem {
  /** Facts proxy — set values directly. */
  facts: Record<string, unknown>;
  /** Full system.inspect() response. */
  inspect(): Record<string, unknown>;
  /** Subscribe to specific fact key changes. */
  subscribe(keys: string[], listener: () => void): () => void;
  /** Subscribe to settled changes. */
  onSettledChange(listener: (settled: boolean) => void): () => void;
  /** Batch mutations. */
  batch(fn: () => void): void;
  /** Explain a requirement. */
  explain(id: string): unknown;
  /** Constraints registration. */
  constraints: {
    register: (id: string, def: unknown) => void;
    unregister: (id: string) => void;
    listDynamic: () => string[];
    isDynamic: (id: string) => boolean;
  };
  /** Resolvers registration. */
  resolvers: {
    register: (id: string, def: unknown) => void;
    unregister: (id: string) => void;
    listDynamic: () => string[];
    isDynamic: (id: string) => boolean;
  };
  /** Effects registration. */
  effects: {
    register: (id: string, def: unknown) => void;
    unregister: (id: string) => void;
    listDynamic: () => string[];
    isDynamic: (id: string) => boolean;
  };
  /** Test helper: emit a fact change notification. */
  _emitFactChange(keys?: string[]): void;
  /** Test helper: emit a settled change notification. */
  _emitSettled(settled: boolean): void;
  /** Test helper: set the initial facts. */
  _setFacts(facts: Record<string, unknown>): void;
  /** Test helper: set inspection overrides. */
  _setInspection(overrides: Record<string, unknown>): void;
}

/**
 * Create a mock System for testing architect features.
 * Replaces duplicated mocks across test files.
 */
export function createTestSystem(initialFacts?: Record<string, unknown>): TestSystem {
  const facts: Record<string, unknown> = { ...initialFacts };
  const dynamicConstraints = new Map<string, unknown>();
  const dynamicResolvers = new Map<string, unknown>();
  const dynamicEffects = new Map<string, unknown>();
  let inspectionOverrides: Record<string, unknown> = {};

  const factListeners: Array<{ keys: string[]; fn: () => void }> = [];
  const settledListeners: Array<(settled: boolean) => void> = [];

  const system: TestSystem = {
    facts,

    inspect() {
      return {
        facts: { ...facts },
        constraints: [],
        resolvers: [],
        derivations: [],
        effects: [],
        pendingRequirements: [],
        ...inspectionOverrides,
      };
    },

    subscribe(keys: string[], listener: () => void): () => void {
      const entry = { keys, fn: listener };
      factListeners.push(entry);

      return () => {
        const idx = factListeners.indexOf(entry);
        if (idx >= 0) {
          factListeners.splice(idx, 1);
        }
      };
    },

    onSettledChange(listener: (settled: boolean) => void): () => void {
      settledListeners.push(listener);

      return () => {
        const idx = settledListeners.indexOf(listener);
        if (idx >= 0) {
          settledListeners.splice(idx, 1);
        }
      };
    },

    batch(fn: () => void): void {
      fn();
    },

    explain(_id: string): unknown {
      return null;
    },

    constraints: {
      register(id: string, def: unknown) {
        dynamicConstraints.set(id, def);
      },
      unregister(id: string) {
        dynamicConstraints.delete(id);
      },
      listDynamic() {
        return [...dynamicConstraints.keys()];
      },
      isDynamic(id: string) {
        return dynamicConstraints.has(id);
      },
    },

    resolvers: {
      register(id: string, def: unknown) {
        dynamicResolvers.set(id, def);
      },
      unregister(id: string) {
        dynamicResolvers.delete(id);
      },
      listDynamic() {
        return [...dynamicResolvers.keys()];
      },
      isDynamic(id: string) {
        return dynamicResolvers.has(id);
      },
    },

    effects: {
      register(id: string, def: unknown) {
        dynamicEffects.set(id, def);
      },
      unregister(id: string) {
        dynamicEffects.delete(id);
      },
      listDynamic() {
        return [...dynamicEffects.keys()];
      },
      isDynamic(id: string) {
        return dynamicEffects.has(id);
      },
    },

    _emitFactChange(keys?: string[]) {
      for (const entry of factListeners) {
        if (!keys || keys.some((k) => entry.keys.includes(k))) {
          entry.fn();
        }
      }
    },

    _emitSettled(settled: boolean) {
      for (const listener of settledListeners) {
        listener(settled);
      }
    },

    _setFacts(newFacts: Record<string, unknown>) {
      for (const key of Object.keys(facts)) {
        delete facts[key];
      }

      Object.assign(facts, newFacts);
    },

    _setInspection(overrides: Record<string, unknown>) {
      inspectionOverrides = overrides;
    },
  };

  return system;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/** Assert that an analysis produced the expected number of actions. */
export function assertAnalysisActions(
  analysis: ArchitectAnalysis,
  expectedCount: number,
): void {
  if (analysis.actions.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} actions, got ${analysis.actions.length}`,
    );
  }
}

/** Assert that an action has the expected tool name. */
export function assertActionTool(
  action: ArchitectAction,
  expectedTool: string,
): void {
  if (action.tool !== expectedTool) {
    throw new Error(
      `Expected tool "${expectedTool}", got "${action.tool}"`,
    );
  }
}

/** Assert that an action was approved. */
export function assertApproved(action: ArchitectAction): void {
  if (
    action.approvalStatus !== "approved" &&
    action.approvalStatus !== "auto-approved"
  ) {
    throw new Error(
      `Expected action to be approved, got "${action.approvalStatus}"`,
    );
  }
}

/** Assert that all AI definitions have been killed (none active). */
export function assertKilled(architect: AIArchitect): void {
  const active = architect.getActiveDefinitions();
  if (active.length > 0) {
    throw new Error(
      `Expected 0 active definitions after kill, got ${active.length}`,
    );
  }
}

/** Assert budget usage is within expected bounds. */
export function assertBudgetWithin(
  architect: AIArchitect,
  maxTokens: number,
  maxDollars: number,
): void {
  const usage = architect.getBudgetUsage();
  if (usage.tokens > maxTokens) {
    throw new Error(
      `Token usage ${usage.tokens} exceeds max ${maxTokens}`,
    );
  }

  if (usage.dollars > maxDollars) {
    throw new Error(
      `Dollar usage ${usage.dollars} exceeds max ${maxDollars}`,
    );
  }
}
