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
  debug: { runHistory: true },
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
        addTimeline(
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
      addTimeline("error", `${stage}: ${lastError.message}`, "error");
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
  addTimeline("stage", `${nextStage}: starting`, "stage");
  render();

  try {
    const result = await runStageWithRetry(nextStage);
    const results = [...(system.facts.stageResults as StageResult[]), result];
    system.facts.stageResults = results;
    system.facts.totalTokens =
      (system.facts.totalTokens as number) + result.tokens;
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

async function autoRun() {
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
    render();

    try {
      const result = await runStageWithRetry(stage);
      const results = [...(system.facts.stageResults as StageResult[]), result];
      system.facts.stageResults = results;
      system.facts.totalTokens =
        (system.facts.totalTokens as number) + result.tokens;
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

  addTimeline("checkpoint", `saved: ${label}`, "checkpoint");
}

async function restoreCheckpoint(checkpointId: string) {
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

async function deleteCheckpoint(checkpointId: string) {
  const deleted = await checkpointStore.delete(checkpointId);
  if (deleted) {
    const checkpoints = (system.facts.checkpoints as CheckpointEntry[]).filter(
      (c) => c.id !== checkpointId,
    );
    system.facts.checkpoints = checkpoints;
    addTimeline("checkpoint", "deleted checkpoint", "checkpoint");
  }
}

// ============================================================================
// DOM References
// ============================================================================

const progressBar = document.getElementById("cp-progress-fill")!;
const progressLabel = document.getElementById("cp-progress-label")!;
const stageIndicators = document.querySelectorAll<HTMLElement>(".cp-stage-dot");

const checkpointList = document.getElementById("cp-checkpoint-list")!;
const timelineEl = document.getElementById("cp-timeline")!;

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function render(): void {
  const stage = system.facts.currentStage as PipelineStage;
  const completion = system.read("completionPercentage") as number;
  const results = system.facts.stageResults as StageResult[];

  // Progress bar
  progressBar.style.width = `${completion}%`;
  progressLabel.textContent =
    stage === "done"
      ? "Complete"
      : stage === "idle"
        ? "Ready"
        : `${stage}... ${completion}%`;

  // Stage dots
  stageIndicators.forEach((dot) => {
    const dotStage = dot.getAttribute("data-stage") as PipelineStage;
    const dotIdx = STAGES.indexOf(dotStage);
    const currentIdx = STAGES.indexOf(stage);
    const completedStages = results.map((r) => r.stage);

    dot.classList.remove("active", "complete", "error");
    if (completedStages.includes(dotStage)) {
      dot.classList.add("complete");
    } else if (dotStage === stage && system.facts.isRunning) {
      dot.classList.add("active");
    } else if (stage === "error" && dotIdx === currentIdx) {
      dot.classList.add("error");
    }
  });

  // Checkpoints
  const checkpoints = system.facts.checkpoints as CheckpointEntry[];
  if (checkpoints.length === 0) {
    checkpointList.innerHTML =
      '<div style="color:var(--brand-text-faint);font-size:0.65rem;font-style:italic">No checkpoints saved</div>';
  } else {
    checkpointList.innerHTML = checkpoints
      .map((cp) => {
        const time = new Date(cp.createdAt);
        const timeStr = time.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return `<div class="cp-checkpoint-entry" data-testid="cp-ckpt-${cp.id}">
        <div class="cp-checkpoint-info">
          <span class="cp-checkpoint-label">${escapeHtml(cp.label)}</span>
          <span class="cp-checkpoint-time">${timeStr}</span>
        </div>
        <div class="cp-checkpoint-actions">
          <button class="cp-btn-sm" data-restore="${cp.id}">Restore</button>
          <button class="cp-btn-sm danger" data-delete="${cp.id}">Del</button>
        </div>
      </div>`;
      })
      .join("");
  }

  // Timeline
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="cp-timeline-empty">Events appear after running the pipeline</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `cp-timeline-entry ${entry.type}`;
      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      el.innerHTML = `
        <span class="cp-timeline-time">${timeStr}</span>
        <span class="cp-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="cp-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;
      timelineEl.appendChild(el);
    }
  }
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

document
  .getElementById("cp-advance")!
  .addEventListener("click", () => advancePipeline());
document
  .getElementById("cp-auto-run")!
  .addEventListener("click", () => autoRun());

document
  .getElementById("cp-save-ckpt")!
  .addEventListener("click", () => saveCheckpoint());

document.getElementById("cp-reset")!.addEventListener("click", () => {
  system.events.reset();
  checkpointStore.clear();
  system.facts.checkpoints = [];
});

const failSelect = document.getElementById(
  "cp-fail-stage",
) as HTMLSelectElement;
failSelect.addEventListener("change", () => {
  system.events.setFailStage({ value: failSelect.value });
});

// Delegated click for checkpoint restore/delete
checkpointList.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const restoreId = target.getAttribute("data-restore");
  const deleteId = target.getAttribute("data-delete");

  if (restoreId) {
    restoreCheckpoint(restoreId);
  }

  if (deleteId) {
    deleteCheckpoint(deleteId);
  }
});

const retrySlider = document.getElementById(
  "cp-max-retries",
) as HTMLInputElement;
retrySlider.addEventListener("input", () => {
  document.getElementById("cp-retry-val")!.textContent = retrySlider.value;
  system.events.setMaxRetries({ value: Number(retrySlider.value) });
});

// ============================================================================
// Initial Render
// ============================================================================

render();
document.body.setAttribute("data-ai-checkpoint-ready", "true");
