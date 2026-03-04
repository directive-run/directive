// Example: provider-routing
// Source: examples/provider-routing/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Smart Provider Router — Constraint-Based Provider Routing & Fallback
 *
 * 3 mock providers (OpenAI, Anthropic, Ollama). Constraint router selects based
 * on cost, error rates, circuit state. Provider fallback chain.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import {
  type CircuitState,
  createCircuitBreaker,
  devtoolsPlugin,
} from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

interface ProviderStats {
  name: string;
  callCount: number;
  errorCount: number;
  totalCost: number;
  avgLatencyMs: number;
  circuitState: CircuitState;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "route" | "error" | "fallback" | "circuit" | "info" | "success";
}

// ============================================================================
// Mock Providers
// ============================================================================

const PROVIDERS = {
  openai: { name: "OpenAI", costPer1k: 0.03, baseLatency: 200 },
  anthropic: { name: "Anthropic", costPer1k: 0.025, baseLatency: 250 },
  ollama: { name: "Ollama", costPer1k: 0.001, baseLatency: 400 },
};

const providerErrors: Record<string, boolean> = {
  openai: false,
  anthropic: false,
  ollama: false,
};

const circuitBreakers = {
  openai: createCircuitBreaker({
    name: "openai",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) =>
  }),
  anthropic: createCircuitBreaker({
    name: "anthropic",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) =>
  }),
  ollama: createCircuitBreaker({
    name: "ollama",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) =>
  }),
};

// ============================================================================
// Timeline
// ============================================================================

const timeline: TimelineEntry[] = [];

function addTimeline(
  event: string,
  detail: string,
  type: TimelineEntry["type"],
) {
  timeline.unshift({ time: Date.now(), event, detail, type });
  if (timeline.length > 50) {
    timeline.length = 50;
  }
}

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    openaiStats: t.object<ProviderStats>(),
    anthropicStats: t.object<ProviderStats>(),
    ollamaStats: t.object<ProviderStats>(),
    budgetRemaining: t.number(),
    budgetTotal: t.number(),
    preferCheapest: t.boolean(),
    lastProvider: t.string(),
    totalRequests: t.number(),
    lastError: t.string(),
  },
  derivations: {
    openaiCircuit: t.string<CircuitState>(),
    anthropicCircuit: t.string<CircuitState>(),
    ollamaCircuit: t.string<CircuitState>(),
    cheapestAvailable: t.string(),
    allDown: t.boolean(),
  },
  events: {
    toggleProviderError: { provider: t.string() },
    setBudget: { value: t.number() },
    togglePreferCheapest: {},
    resetStats: {},
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

function defaultStats(name: string): ProviderStats {
  return {
    name,
    callCount: 0,
    errorCount: 0,
    totalCost: 0,
    avgLatencyMs: 0,
    circuitState: "CLOSED",
  };
}

const routerModule = createModule("router", {
  schema,

  init: (facts) => {
    facts.openaiStats = defaultStats("OpenAI");
    facts.anthropicStats = defaultStats("Anthropic");
    facts.ollamaStats = defaultStats("Ollama");
    facts.budgetRemaining = 1.0;
    facts.budgetTotal = 1.0;
    facts.preferCheapest = false;
    facts.lastProvider = "";
    facts.totalRequests = 0;
    facts.lastError = "";
  },

  derive: {
    openaiCircuit: () => circuitBreakers.openai.getState(),
    anthropicCircuit: () => circuitBreakers.anthropic.getState(),
    ollamaCircuit: () => circuitBreakers.ollama.getState(),
    cheapestAvailable: () => {
      const available: { name: string; cost: number }[] = [];
      for (const [id, config] of Object.entries(PROVIDERS)) {
        const breaker = circuitBreakers[id as keyof typeof circuitBreakers];
        if (breaker.isAllowed()) {
          available.push({ name: id, cost: config.costPer1k });
        }
      }
      available.sort((a, b) => a.cost - b.cost);

      return available.length > 0 ? available[0]!.name : "none";
    },
    allDown: () =>
      !circuitBreakers.openai.isAllowed() &&
      !circuitBreakers.anthropic.isAllowed() &&
      !circuitBreakers.ollama.isAllowed(),
  },

  events: {
    toggleProviderError: (_facts, { provider }) => {
      providerErrors[provider] = !providerErrors[provider];
    },
    setBudget: (facts, { value }) => {
      facts.budgetRemaining = value;
      facts.budgetTotal = value;
    },
    togglePreferCheapest: (facts) => {
      facts.preferCheapest = !facts.preferCheapest;
    },
    resetStats: (facts) => {
      facts.openaiStats = defaultStats("OpenAI");
      facts.anthropicStats = defaultStats("Anthropic");
      facts.ollamaStats = defaultStats("Ollama");
      facts.budgetRemaining = facts.budgetTotal;
      facts.lastProvider = "";
      facts.totalRequests = 0;
      facts.lastError = "";
      providerErrors.openai = false;
      providerErrors.anthropic = false;
      providerErrors.ollama = false;
      circuitBreakers.openai.reset();
      circuitBreakers.anthropic.reset();
      circuitBreakers.ollama.reset();
      timeline.length = 0;
    },
  },
});

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: routerModule,
  plugins: [devtoolsPlugin({ name: "provider-routing" })],
});
system.start();

// ============================================================================
// Routing Logic
// ============================================================================

function selectProvider(): string | null {
  const budget = system.facts.budgetRemaining as number;
  const preferCheapest = system.facts.preferCheapest as boolean;

  // Collect available providers (circuit breaker allows + within budget)
  const available: { id: string; cost: number }[] = [];
  for (const [id, config] of Object.entries(PROVIDERS)) {
    const breaker = circuitBreakers[id as keyof typeof circuitBreakers];
    if (breaker.isAllowed() && budget >= config.costPer1k) {
      available.push({ id, cost: config.costPer1k });
    }
  }

  if (available.length === 0) {
    return null;
  }

  if (preferCheapest) {
    available.sort((a, b) => a.cost - b.cost);

    return available[0]!.id;
  }

  // Default: prefer openai > anthropic > ollama
  const priority = ["openai", "anthropic", "ollama"];
  for (const id of priority) {
    if (available.find((a) => a.id === id)) {
      return id;
    }
  }

  return available[0]!.id;
}

async function executeProvider(providerId: string): Promise<boolean> {
  const breaker = circuitBreakers[providerId as keyof typeof circuitBreakers];
  const config = PROVIDERS[providerId as keyof typeof PROVIDERS]!;
  const statsKey = `${providerId}Stats` as
    | "openaiStats"
    | "anthropicStats"
    | "ollamaStats";

  try {
    await breaker.execute(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, config.baseLatency + Math.random() * 100),
      );

      if (providerErrors[providerId]) {
        throw new Error(`${config.name}: simulated error`);
      }
    });

    const stats = system.facts[statsKey] as ProviderStats;
    const cost = config.costPer1k;
    const latency = config.baseLatency + Math.random() * 100;
    system.facts[statsKey] = {
      ...stats,
      callCount: stats.callCount + 1,
      totalCost: Math.round((stats.totalCost + cost) * 1000) / 1000,
      avgLatencyMs: Math.round(
        (stats.avgLatencyMs * stats.callCount + latency) /
          (stats.callCount + 1),
      ),
      circuitState: breaker.getState(),
    };
    system.facts.budgetRemaining =
      Math.round(((system.facts.budgetRemaining as number) - cost) * 1000) /
      1000;
    system.facts.lastError = "";

    return true;
  } catch (err) {
    const stats = system.facts[statsKey] as ProviderStats;
    system.facts[statsKey] = {
      ...stats,
      errorCount: stats.errorCount + 1,
      circuitState: breaker.getState(),
    };
    system.facts.lastError = err instanceof Error ? err.message : String(err);

    return false;
  }
}

async function sendRequest() {
  system.facts.totalRequests = (system.facts.totalRequests as number) + 1;

  const providerId = selectProvider();
  if (!providerId) {
    system.facts.lastError = "All providers unavailable or over budget";

    return;
  }

  system.facts.lastProvider = providerId;

  const success = await executeProvider(providerId);
  if (success) {
    return;
  }

  // Primary failed — try fallback
  const fallbackId = selectProvider();
  if (fallbackId && fallbackId !== providerId) {
    system.facts.lastProvider = fallbackId;
    await executeProvider(fallbackId);
  }
}

// ============================================================================
// DOM References
// ============================================================================


// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}

function circuitBadge(state: CircuitState): string {
  const cls =
    state === "CLOSED" ? "closed" : state === "OPEN" ? "open" : "half-open";

  return `<span class="pr-circuit-badge ${cls}">${state}</span>`;
}

  stats: ProviderStats,
  state: CircuitState,
): void {
    ${circuitBadge(state)}
    <span style="font-size:0.55rem;color:var(--brand-text-dim)">${stats.callCount} calls, ${stats.errorCount} err, $${stats.totalCost}</span>
  `;
}


// ============================================================================
// Subscribe
// ============================================================================

const allKeys = [
  ...Object.keys(schema.facts),
  ...Object.keys(schema.derivations),
];
system.subscribe(allKeys, render);

setInterval(render, 1000);

// ============================================================================
// Controls
// ============================================================================


for (const id of ["openai", "anthropic", "ollama"]) {
    system.events.toggleProviderError({ provider: id });
  });
}

  "input",
  (e) => {
    system.events.setBudget({ value });
  },
);


// ============================================================================
// Initial Render
// ============================================================================

render();
