# Examples

> Auto-generated from extracted examples. Do not edit manually.

## ai-checkpoint

```typescript
// Example: ai-checkpoint
// Source: examples/ai-checkpoint/src/module.ts
// Pure module file — no DOM wiring

/**
 * AI Pipeline Checkpoint — Module Definition
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

export type PipelineStage =
  | "idle"
  | "extract"
  | "summarize"
  | "classify"
  | "archive"
  | "done"
  | "error";

export interface StageResult {
  stage: string;
  output: string;
  tokens: number;
  durationMs: number;
}

export interface CheckpointEntry {
  id: string;
  label: string;
  createdAt: string;
  stage: PipelineStage;
}

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "stage" | "checkpoint" | "retry" | "error" | "info" | "success";
}

// ============================================================================
// Constants
// ============================================================================

export const STAGES: PipelineStage[] = [
  "extract",
  "summarize",
  "classify",
  "archive",
];

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

export const timeline: TimelineEntry[] = [];

export function addTimeline(
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

export const checkpointStore = new InMemoryCheckpointStore({
  maxCheckpoints: 20,
});

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    currentStage: t.string<PipelineStage>(),
    stageResults: t.array<StageResult>(),
    totalTokens: t.number(),
    retryCount: t.number(),
    maxRetries: t.number(),
    failStage: t.string(),
    isRunning: t.boolean(),
    lastError: t.string(),
    checkpoints: t.array<CheckpointEntry>(),
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
        const idx = facts.stageResults.length;

        return Math.round((idx / STAGES.length) * 100);
      }
      const idx = STAGES.indexOf(facts.currentStage);

      return Math.round((idx / STAGES.length) * 100);
    },
    currentStageIndex: (facts) => {
      if (facts.currentStage === "idle") {
        return -1;
      }
      if (facts.currentStage === "done") {
        return STAGES.length;
      }

      return STAGES.indexOf(facts.currentStage);
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

export const system = createSystem({
  module: pipelineModule,
  trace: true,
  plugins: [devtoolsPlugin({ name: "ai-checkpoint" })],
});

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

export async function runStageWithRetry(
  stage: PipelineStage,
  renderCallback: () => void,
): Promise<StageResult> {
  const maxRetries = system.facts.maxRetries;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(500 * 2 ** (attempt - 1), 4000);
        const jitter = Math.random() * delay * 0.1;
        system.facts.retryCount = system.facts.retryCount + 1;
        addTimeline(
          "retry",
          `${stage}: attempt ${attempt + 1}/${maxRetries + 1} (delay ${Math.round(delay)}ms)`,
          "retry",
        );
        renderCallback();
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      }

      return await runStage(stage);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      addTimeline("error", `${stage}: ${lastError.message}`, "error");
    }
  }

  throw lastError!;
}

export async function advancePipeline(
  renderCallback: () => void,
): Promise<void> {
  if (system.facts.isRunning) {
    return;
  }

  const current = system.facts.currentStage;
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
  addTimeline("stage", `${nextStage}: starting`, "stage");
  renderCallback();

  try {
    const result = await runStageWithRetry(nextStage, renderCallback);
    const results = [...system.facts.stageResults, result];
    system.facts.stageResults = results;
    system.facts.totalTokens = system.facts.totalTokens + result.tokens;
    addTimeline(
      "success",
      `${nextStage}: complete (${result.tokens} tokens)`,
      "success",
    );

    const idx = STAGES.indexOf(nextStage);
    if (idx >= STAGES.length - 1) {
      system.facts.currentStage = "done";
      addTimeline("info", "pipeline complete", "info");
    } else {
      system.facts.currentStage = nextStage;
    }
  } catch (err) {
    system.facts.currentStage = "error";
    system.facts.lastError = err instanceof Error ? err.message : String(err);
    addTimeline("error", `pipeline halted: ${system.facts.lastError}`, "error");
  } finally {
    system.facts.isRunning = false;
  }
}

export async function autoRun(renderCallback: () => void): Promise<void> {
  if (system.facts.isRunning) {
    return;
  }

  system.facts.currentStage = "idle";
  system.facts.stageResults = [];
  system.facts.totalTokens = 0;
  system.facts.retryCount = 0;
  system.facts.lastError = "";
  addTimeline("info", "auto-run started", "info");

  for (const stage of STAGES) {
    system.facts.isRunning = true;
    system.facts.currentStage = stage;
    addTimeline("stage", `${stage}: starting`, "stage");
    renderCallback();

    try {
      const result = await runStageWithRetry(stage, renderCallback);
      const results = [...system.facts.stageResults, result];
      system.facts.stageResults = results;
      system.facts.totalTokens = system.facts.totalTokens + result.tokens;
      addTimeline(
        "success",
        `${stage}: complete (${result.tokens} tokens)`,
        "success",
      );
    } catch (err) {
      system.facts.currentStage = "error";
      system.facts.lastError = err instanceof Error ? err.message : String(err);
      system.facts.isRunning = false;
      addTimeline(
        "error",
        `pipeline halted at ${stage}: ${system.facts.lastError}`,
        "error",
      );

      return;
    }

    system.facts.isRunning = false;
  }

  system.facts.currentStage = "done";
  addTimeline("info", "pipeline complete (auto-run)", "info");
}

// ============================================================================
// Checkpoint Logic
// ============================================================================

export async function saveCheckpoint(): Promise<void> {
  const stage = system.facts.currentStage;
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
  system.facts.checkpoints = [...system.facts.checkpoints, entry];

  addTimeline("checkpoint", `saved: ${label}`, "checkpoint");
}

export async function restoreCheckpoint(checkpointId: string): Promise<void> {
  const checkpoint = await checkpointStore.load(checkpointId);
  if (!checkpoint) {
    addTimeline("error", "checkpoint not found", "error");

    return;
  }

  if (!validateCheckpoint(checkpoint)) {
    addTimeline("error", "invalid checkpoint data", "error");

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
    const savedTimeline = JSON.parse(checkpoint.timelineExport);
    timeline.length = 0;
    for (const entry of savedTimeline) {
      timeline.push(entry);
    }
  }

  addTimeline("checkpoint", `restored: ${checkpoint.label}`, "checkpoint");
}

export async function deleteCheckpoint(checkpointId: string): Promise<void> {
  const deleted = await checkpointStore.delete(checkpointId);
  if (deleted) {
    const checkpoints = system.facts.checkpoints.filter(
      (c) => c.id !== checkpointId,
    );
    system.facts.checkpoints = checkpoints;
    addTimeline("checkpoint", "deleted checkpoint", "checkpoint");
  }
}
```

## provider-routing

```typescript
// Example: provider-routing
// Source: examples/provider-routing/src/module.ts
// Pure module file — no DOM wiring

/**
 * Smart Provider Router — Module Definition
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

export interface ProviderStats {
  name: string;
  callCount: number;
  errorCount: number;
  totalCost: number;
  avgLatencyMs: number;
  circuitState: CircuitState;
}

export interface TimelineEntry {
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

export const circuitBreakers = {
  openai: createCircuitBreaker({
    name: "openai",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) =>
      addTimeline("circuit", `openai: ${from} → ${to}`, "circuit"),
  }),
  anthropic: createCircuitBreaker({
    name: "anthropic",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) =>
      addTimeline("circuit", `anthropic: ${from} → ${to}`, "circuit"),
  }),
  ollama: createCircuitBreaker({
    name: "ollama",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) =>
      addTimeline("circuit", `ollama: ${from} → ${to}`, "circuit"),
  }),
};

// ============================================================================
// Timeline
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimeline(
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

export const schema = {
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

export const system = createSystem({
  module: routerModule,
  trace: true,
  plugins: [devtoolsPlugin({ name: "provider-routing" })],
});

// ============================================================================
// Routing Logic
// ============================================================================

function selectProvider(): string | null {
  const budget = system.facts.budgetRemaining;
  const preferCheapest = system.facts.preferCheapest;

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

    const stats = system.facts[statsKey];
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
      Math.round((system.facts.budgetRemaining - cost) * 1000) / 1000;
    system.facts.lastError = "";
    addTimeline("success", `${config.name}: ok ($${cost})`, "success");

    return true;
  } catch (err) {
    const stats = system.facts[statsKey];
    system.facts[statsKey] = {
      ...stats,
      errorCount: stats.errorCount + 1,
      circuitState: breaker.getState(),
    };
    system.facts.lastError = err instanceof Error ? err.message : String(err);
    addTimeline("error", `${config.name}: ${system.facts.lastError}`, "error");

    return false;
  }
}

export async function sendRequest(): Promise<void> {
  system.facts.totalRequests = system.facts.totalRequests + 1;

  const providerId = selectProvider();
  if (!providerId) {
    system.facts.lastError = "All providers unavailable or over budget";
    addTimeline("error", "no available providers", "error");

    return;
  }

  system.facts.lastProvider = providerId;
  addTimeline("route", `→ ${providerId}`, "route");

  const success = await executeProvider(providerId);
  if (success) {
    return;
  }

  // Primary failed — try fallback
  const fallbackId = selectProvider();
  if (fallbackId && fallbackId !== providerId) {
    addTimeline("fallback", `falling back to ${fallbackId}`, "fallback");
    system.facts.lastProvider = fallbackId;
    await executeProvider(fallbackId);
  }
}

export { providerErrors };
```
