# Examples

> Auto-generated from extracted examples. Do not edit manually.

## ai-checkpoint

```typescript
// Example: ai-checkpoint
// Source: examples/ai-checkpoint/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * AI Pipeline Checkpoint — 4-Stage Document Processing with Save/Restore
 *
 * 4-stage pipeline (extract → summarize → classify → archive) with checkpoint
 * at every stage. Save/restore/delete checkpoints. Retry with backoff on failures.
 */

import {
  type Checkpoint,
  InMemoryCheckpointStore,
  createCheckpointId,
  validateCheckpoint,
} from "@directive-run/ai";
import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

type PipelineStage =
  | "idle"
  | "extract"
  | "summarize"
  | "classify"
  | "archive"
  | "done"
  | "error";

interface StageResult {
  stage: string;
  output: string;
  tokens: number;
  durationMs: number;
}

interface CheckpointEntry {
  id: string;
  label: string;
  createdAt: string;
  stage: PipelineStage;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "stage" | "checkpoint" | "retry" | "error" | "info" | "success";
}

// ============================================================================
// Constants
// ============================================================================

const STAGES: PipelineStage[] = ["extract", "summarize", "classify", "archive"];

const STAGE_CONFIG = {
  extract: {
    tokens: 150,
    baseLatency: 300,
    output: "Extracted 3 sections, 2 tables, 5 figures from document.",
  },
  summarize: {
    tokens: 200,
    baseLatency: 400,
    output:
      "Summary: Key findings include efficiency gains of 23% and cost reduction of $1.2M annually.",
  },
  classify: {
    tokens: 80,
    baseLatency: 200,
    output:
      "Classification: category=research, confidence=0.94, tags=[efficiency, cost, annual-review]",
  },
  archive: {
    tokens: 50,
    baseLatency: 150,
    output: "Archived to /documents/2026/research/efficiency-report.json",
  },
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
// Checkpoint Store
// ============================================================================

const checkpointStore = new InMemoryCheckpointStore({ maxCheckpoints: 20 });

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    currentStage: t.string<PipelineStage>(),
    stageResults: t.object<StageResult[]>(),
    totalTokens: t.number(),
    retryCount: t.number(),
    maxRetries: t.number(),
    failStage: t.string(),
    isRunning: t.boolean(),
    lastError: t.string(),
    checkpoints: t.object<CheckpointEntry[]>(),
    selectedCheckpoint: t.string(),
  },
  derivations: {
    completionPercentage: t.number(),
    currentStageIndex: t.number(),
    canAdvance: t.boolean(),
    isPipelineDone: t.boolean(),
    stageCount: t.number(),
  },
  events: {
    setFailStage: { value: t.string() },
    setMaxRetries: { value: t.number() },
    selectCheckpoint: { id: t.string() },
    reset: {},
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const pipelineModule = createModule("pipeline", {
  schema,

  init: (facts) => {
    facts.currentStage = "idle";
    facts.stageResults = [];
    facts.totalTokens = 0;
    facts.retryCount = 0;
    facts.maxRetries = 2;
    facts.failStage = "";
    facts.isRunning = false;
    facts.lastError = "";
    facts.checkpoints = [];
    facts.selectedCheckpoint = "";
  },

  derive: {
    completionPercentage: (facts) => {
      if (facts.currentStage === "idle") {
        return 0;
      }
      if (facts.currentStage === "done") {
        return 100;
      }
      if (facts.currentStage === "error") {
        const idx = (facts.stageResults as StageResult[]).length;

        return Math.round((idx / STAGES.length) * 100);
      }
      const idx = STAGES.indexOf(facts.currentStage as PipelineStage);

      return Math.round((idx / STAGES.length) * 100);
    },
    currentStageIndex: (facts) => {
      if (facts.currentStage === "idle") {
        return -1;
      }
      if (facts.currentStage === "done") {
        return STAGES.length;
      }

      return STAGES.indexOf(facts.currentStage as PipelineStage);
    },
    canAdvance: (facts) => {
      return (
        !facts.isRunning &&
        facts.currentStage !== "done" &&
        facts.currentStage !== "error"
      );
    },
    isPipelineDone: (facts) => facts.currentStage === "done",
    stageCount: () => STAGES.length,
  },

  events: {
    setFailStage: (facts, { value }) => {
      facts.failStage = value;
    },
    setMaxRetries: (facts, { value }) => {
      facts.maxRetries = value;
    },
    selectCheckpoint: (facts, { id }) => {
      facts.selectedCheckpoint = id;
    },
    reset: (facts) => {
      facts.currentStage = "idle";
      facts.stageResults = [];
      facts.totalTokens = 0;
      facts.retryCount = 0;
      facts.isRunning = false;
      facts.lastError = "";
      facts.selectedCheckpoint = "";
      timeline.length = 0;
    },
  },
});

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: pipelineModule,
  plugins: [devtoolsPlugin({ name: "ai-checkpoint" })],
});
system.start();

// ============================================================================
// Pipeline Logic
// ============================================================================

async function runStage(stage: PipelineStage): Promise<StageResult> {
  const config = STAGE_CONFIG[stage as keyof typeof STAGE_CONFIG];
  if (!config) {
    throw new Error(`Unknown stage: ${stage}`);
  }

  // Simulate latency
  const latency = config.baseLatency + Math.random() * 100;
  await new Promise((resolve) => setTimeout(resolve, latency));

  // Check for injected failure
  if (system.facts.failStage === stage) {
    throw new Error(`${stage}: simulated failure`);
  }

  return {
    stage,
    output: config.output,
    tokens: config.tokens + Math.floor(Math.random() * 30),
    durationMs: Math.round(latency),
  };
}

async function runStageWithRetry(stage: PipelineStage): Promise<StageResult> {
  const maxRetries = system.facts.maxRetries as number;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(500 * 2 ** (attempt - 1), 4000);
        const jitter = Math.random() * delay * 0.1;
        system.facts.retryCount = (system.facts.retryCount as number) + 1;
          "retry",
          `${stage}: attempt ${attempt + 1}/${maxRetries + 1} (delay ${Math.round(delay)}ms)`,
          "retry",
        );
        render();
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      }

      return await runStage(stage);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError!;
}

async function advancePipeline() {
  if (system.facts.isRunning) {
    return;
  }

  const current = system.facts.currentStage as PipelineStage;
  let nextStage: PipelineStage;

  if (current === "idle") {
    nextStage = STAGES[0]!;
  } else if (current === "done" || current === "error") {
    return;
  } else {
    const idx = STAGES.indexOf(current);
    if (idx < 0 || idx >= STAGES.length - 1) {
      // Current stage should be run first
      nextStage = current;
    } else {
      nextStage = STAGES[idx + 1]!;
    }
  }

  system.facts.isRunning = true;
  system.facts.currentStage = nextStage;
  render();

  try {
    const result = await runStageWithRetry(nextStage);
    const results = [...(system.facts.stageResults as StageResult[]), result];
    system.facts.stageResults = results;
    system.facts.totalTokens =
      (system.facts.totalTokens as number) + result.tokens;
      "success",
      `${nextStage}: complete (${result.tokens} tokens)`,
      "success",
    );

    const idx = STAGES.indexOf(nextStage);
    if (idx >= STAGES.length - 1) {
      system.facts.currentStage = "done";
    } else {
      system.facts.currentStage = nextStage;
    }
  } catch (err) {
    system.facts.currentStage = "error";
    system.facts.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    system.facts.isRunning = false;
  }
}

async function autoRun() {
  if (system.facts.isRunning) {
    return;
  }

  system.facts.currentStage = "idle";
  system.facts.stageResults = [];
  system.facts.totalTokens = 0;
  system.facts.retryCount = 0;
  system.facts.lastError = "";

  for (const stage of STAGES) {
    system.facts.isRunning = true;
    system.facts.currentStage = stage;
    render();

    try {
      const result = await runStageWithRetry(stage);
      const results = [...(system.facts.stageResults as StageResult[]), result];
      system.facts.stageResults = results;
      system.facts.totalTokens =
        (system.facts.totalTokens as number) + result.tokens;
        "success",
        `${stage}: complete (${result.tokens} tokens)`,
        "success",
      );
    } catch (err) {
      system.facts.currentStage = "error";
      system.facts.lastError = err instanceof Error ? err.message : String(err);
      system.facts.isRunning = false;
        "error",
        `pipeline halted at ${stage}: ${system.facts.lastError}`,
        "error",
      );

      return;
    }

    system.facts.isRunning = false;
  }

  system.facts.currentStage = "done";
}

// ============================================================================
// Checkpoint Logic
// ============================================================================

async function saveCheckpoint() {
  const stage = system.facts.currentStage as PipelineStage;
  const id = createCheckpointId();
  const label = `Stage: ${stage} (${new Date().toLocaleTimeString()})`;

  const checkpoint: Checkpoint = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    label,
    systemExport: JSON.stringify({
      currentStage: system.facts.currentStage,
      stageResults: system.facts.stageResults,
      totalTokens: system.facts.totalTokens,
      retryCount: system.facts.retryCount,
      lastError: system.facts.lastError,
    }),
    timelineExport: JSON.stringify(timeline.slice(0, 20)),
    localState: { type: "single" },
    memoryExport: null,
    orchestratorType: "single",
  };

  await checkpointStore.save(checkpoint);

  const entry: CheckpointEntry = {
    id,
    label,
    createdAt: checkpoint.createdAt,
    stage,
  };
  system.facts.checkpoints = [
    ...(system.facts.checkpoints as CheckpointEntry[]),
    entry,
  ];

}

async function restoreCheckpoint(checkpointId: string) {
  const checkpoint = await checkpointStore.load(checkpointId);
  if (!checkpoint) {

    return;
  }

  if (!validateCheckpoint(checkpoint)) {

    return;
  }

  const saved = JSON.parse(checkpoint.systemExport);
  system.facts.currentStage = saved.currentStage;
  system.facts.stageResults = saved.stageResults;
  system.facts.totalTokens = saved.totalTokens;
  system.facts.retryCount = saved.retryCount;
  system.facts.lastError = saved.lastError;
  system.facts.isRunning = false;

  if (checkpoint.timelineExport) {
    timeline.length = 0;
    for (const entry of savedTimeline) {
      timeline.push(entry);
    }
  }

}

async function deleteCheckpoint(checkpointId: string) {
  const deleted = await checkpointStore.delete(checkpointId);
  if (deleted) {
    const checkpoints = (system.facts.checkpoints as CheckpointEntry[]).filter(
      (c) => c.id !== checkpointId,
    );
    system.facts.checkpoints = checkpoints;
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


// ============================================================================
// Subscribe
// ============================================================================

const allKeys = [
  ...Object.keys(schema.facts),
  ...Object.keys(schema.derivations),
];
system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================


  "cp-fail-stage",

// Delegated click for checkpoint restore/delete

  "cp-max-retries",

// ============================================================================
// Initial Render
// ============================================================================

render();
```

## provider-routing

```typescript
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
```
