/**
 * Fraud Case Analysis — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import { el } from "@directive-run/el";
import {
  type Checkpoint,
  createCheckpointId,
  validateCheckpoint,
} from "./checkpoint.js";
import {
  addTimeline,
  checkpointStore,
  delay,
  fraudSchema,
  system,
  timeline,
} from "./fraud-analysis.js";
import {
  type CheckpointEntry,
  type Disposition,
  type EnrichmentSignal,
  type FlagEvent,
  type FraudCase,
  type PipelineStage,
  scenarios,
} from "./mock-data.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const stageBadge = document.getElementById("fraud-stage-badge")!;
const progressFill = document.getElementById("fraud-progress-fill")!;
const progressLabel = document.getElementById("fraud-progress-label")!;
const stageDots = document.querySelectorAll<HTMLElement>(
  ".fraud-stage-dot-circle",
);
const casesEl = document.getElementById("fraud-cases")!;

const metricStage = document.getElementById("fraud-metric-stage")!;
const metricCompletion = document.getElementById("fraud-metric-completion")!;
const metricPii = document.getElementById("fraud-metric-pii")!;
const metricBudget = document.getElementById("fraud-metric-budget")!;
const metricCases = document.getElementById("fraud-metric-cases")!;
const metricCritical = document.getElementById("fraud-metric-critical")!;
const metricRisk = document.getElementById("fraud-metric-risk")!;
const dispositionBreakdown = document.getElementById(
  "fraud-disposition-breakdown",
)!;
const stageStatsEl = document.getElementById("fraud-stage-stats")!;

const timelineEl = document.getElementById("fraud-timeline")!;
const checkpointsEl = document.getElementById("fraud-checkpoints")!;

const scenarioSelect = document.getElementById(
  "fraud-scenario-select",
) as HTMLSelectElement;
const scenarioDesc = document.getElementById("fraud-scenario-desc")!;
const rulesEl = document.getElementById("fraud-rules")!;
const thresholdSlider = document.getElementById(
  "fraud-threshold-slider",
) as HTMLInputElement;
const thresholdValue = document.getElementById("fraud-threshold-value")!;
const budgetSlider = document.getElementById(
  "fraud-budget-slider",
) as HTMLInputElement;
const budgetValue = document.getElementById("fraud-budget-value")!;

const runBtn = document.getElementById("fraud-run-btn") as HTMLButtonElement;
const autoBtn = document.getElementById("fraud-auto-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("fraud-save-btn") as HTMLButtonElement;
const resetBtn = document.getElementById(
  "fraud-reset-btn",
) as HTMLButtonElement;

// ============================================================================
// Helpers
// ============================================================================

const STAGE_ORDER: PipelineStage[] = [
  "idle",
  "ingesting",
  "normalizing",
  "grouping",
  "enriching",
  "analyzing",
  "complete",
];

const DISPOSITION_ORDER: Disposition[] = [
  "pending",
  "cleared",
  "flagged",
  "human_review",
  "escalated",
];

function signalColor(risk: number): string {
  if (risk >= 70) {
    return "var(--fraud-error)";
  }

  if (risk >= 40) {
    return "var(--fraud-warning)";
  }

  return "var(--fraud-success)";
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);

    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function renderTransactionTable(events: FlagEvent[]): HTMLTableElement {
  return el("table", { className: "fraud-txn-table" },
    el("thead",
      el("tr",
        el("th", "Time"),
        el("th", "Merchant"),
        el("th", "Amount"),
        el("th", { className: "fraud-txn-col-location" }, "Location"),
        el("th", "Card"),
      ),
    ),
    el("tbody",
      events.map((e) =>
        el("tr",
          el("td", formatTimestamp(e.timestamp)),
          el("td",
            e.redactedMerchant ?? e.merchant,
            e.piiFound ? el("span", { className: "fraud-pii-dot", title: "PII detected" }) : null,
          ),
          el("td", `$${e.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`),
          el("td", { className: "fraud-txn-col-location" }, e.location),
          el("td", e.cardLast4),
        ),
      ),
    ),
  );
}

function renderSignals(signals: EnrichmentSignal[]): DocumentFragment | null {
  if (signals.length === 0) {
    return null;
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(el("div", { className: "fraud-detail-label" }, "Signals"));
  frag.appendChild(
    el("div", { className: "fraud-signal-list" },
      signals.flatMap((s) => [
        el("div", { className: "fraud-signal-item" },
          el("span", { className: "fraud-signal-name" }, s.source),
          el("div", { className: "fraud-signal-bar-track" },
            el("div", {
              className: "fraud-signal-bar-fill",
              style: `width: ${s.risk}%; background: ${signalColor(s.risk)};`,
            }),
          ),
          el("span", { className: "fraud-signal-score" }, String(s.risk)),
        ),
        el("div", { className: "fraud-signal-detail" }, s.detail),
      ]),
    ),
  );

  return frag;
}

function renderAnalysisNotes(notes: string | undefined): DocumentFragment | null {
  if (!notes) {
    return null;
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(el("div", { className: "fraud-detail-label" }, "Analysis"));
  frag.appendChild(el("div", { className: "fraud-analysis-note" }, notes));

  return frag;
}

function renderDispositionReason(reason: string | undefined): HTMLDivElement | null {
  if (!reason) {
    return null;
  }

  return el("div", { className: "fraud-disposition-reason" }, reason);
}

function renderCaseCard(c: FraudCase, testId: string): HTMLDivElement {
  const totalAmount = c.events.reduce((sum, e) => sum + e.amount, 0);

  let detailsBlock: HTMLDetailsElement | null = null;
  if (c.events.length > 0) {
    detailsBlock = el("details", { className: "fraud-case-details" },
      el("summary", "Details"),
      el("div", { className: "fraud-case-details-body" },
        el("div", { className: "fraud-detail-label" }, "Transactions"),
        renderTransactionTable(c.events),
        renderSignals(c.signals),
        renderAnalysisNotes(c.analysisNotes),
        renderDispositionReason(c.dispositionReason),
      ),
    );
    detailsBlock.dataset.testid = `${testId}-details`;
  }

  const dispText = c.disposition !== "pending" ? c.disposition.replace("_", " ") : "pending";
  const dispClass = `fraud-case-disposition fraud-disp-${c.disposition}`;

  const card = el("div", { className: "fraud-case-card" },
    el("div", { className: "fraud-case-header" },
      el("span", { className: "fraud-case-id" }, c.id),
      c.analyzed
        ? el("span", { className: `fraud-case-badge fraud-badge-${c.severity}` }, c.severity)
        : null,
    ),
    el("div", { className: "fraud-case-meta" },
      el("span", `${c.events.length} txns`),
      el("span", `$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`),
      el("span", c.accountId),
      c.riskScore > 0 ? el("span", `Risk: ${c.riskScore}`) : null,
    ),
    el("div", { className: dispClass }, dispText),
    detailsBlock,
  );
  card.dataset.disposition = c.disposition;
  card.dataset.testid = testId;

  return card;
}

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const stage = facts.stage;
  const cases = facts.cases;
  const isRunning = facts.isRunning;
  const piiDetections = facts.totalPiiDetections;
  const budget = facts.analysisBudget;
  const checkpoints = facts.checkpoints;

  const caseCount = derive.caseCount;
  const criticalCount = derive.criticalCaseCount;
  const completionPct = derive.completionPercentage;
  const avgRisk = derive.averageRiskScore;
  const dispositionSummary = derive.dispositionSummary;
  const ungroupedCount = derive.ungroupedCount;
  const pendingAnalysisCount = derive.pendingAnalysisCount;

  // ---- Stage Badge ----
  stageBadge.textContent = stage;

  // ---- Progress Bar ----
  progressFill.style.width = `${completionPct}%`;
  progressLabel.textContent = `${completionPct}%`;

  // ---- Stage Dots ----
  const currentIdx = STAGE_ORDER.indexOf(stage);
  stageDots.forEach((dot) => {
    const dotIdx = STAGE_ORDER.indexOf(dot.dataset.stage as PipelineStage);

    dot.classList.remove("active", "completed");
    if (dotIdx === currentIdx) {
      dot.classList.add("active");
    } else if (dotIdx < currentIdx) {
      dot.classList.add("completed");
    }
  });

  // ---- Metrics ----
  metricStage.textContent = stage;
  metricCompletion.textContent = `${completionPct}%`;
  metricPii.textContent = String(piiDetections);
  metricBudget.textContent = String(budget);
  metricCases.textContent = String(caseCount);
  metricCritical.textContent = String(criticalCount);
  metricRisk.textContent = String(avgRisk);

  // ---- Disposition Breakdown ----
  const hasDispositions = Object.keys(dispositionSummary).length > 0;
  if (hasDispositions) {
    dispositionBreakdown.replaceChildren(
      el("div", { className: "fraud-metric-label" }, "Dispositions"),
      ...DISPOSITION_ORDER.filter((d) => (dispositionSummary[d] ?? 0) > 0).map((d) =>
        el("div", { className: "fraud-disposition-row" },
          el("span", { className: `fraud-disposition-dot disp-${d}` }),
          el("span", { className: "fraud-disposition-label" }, d.replace("_", " ")),
          el("span", { className: "fraud-disposition-count" }, String(dispositionSummary[d])),
        ),
      ),
    );
  } else {
    dispositionBreakdown.replaceChildren(
      el("div", { className: "fraud-metric-label" }, "Dispositions"),
      el("div", { style: "font-size: 0.6rem; color: var(--fraud-text-dim);" }, "No cases"),
    );
  }

  // ---- Stage Progress Stats ----
  const maxBudget = facts.maxAnalysisBudget;

  function statBlock(label: string, value: string, testId?: string): HTMLDivElement {
    const valEl = el("div", { className: "fraud-stage-stat-value" }, value);
    if (testId) {
      valEl.dataset.testid = testId;
    }

    return el("div", { className: "fraud-stage-stat" },
      el("div", { className: "fraud-stage-stat-label" }, label),
      valEl,
    );
  }

  stageStatsEl.replaceChildren(
    statBlock("Events", String(facts.totalEventsProcessed), "fraud-stat-events"),
    statBlock("Cases", String(caseCount)),
    statBlock("Ungrouped", String(ungroupedCount)),
    statBlock("Pending Analysis", String(pendingAnalysisCount)),
    statBlock("PII Hits", String(piiDetections)),
    statBlock("Budget", `${budget} / ${maxBudget}`),
  );

  // ---- Case Cards (with open-state preservation) ----
  if (cases.length === 0) {
    casesEl.replaceChildren(
      el("div", { className: "fraud-empty" }, "No cases yet. Select a scenario and run the pipeline."),
    );
  } else {
    // Capture which details are currently open
    const openDetails = new Set<string>();
    casesEl
      .querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((d) => {
        const testid = d.getAttribute("data-testid");
        if (testid) {
          openDetails.add(testid);
        }
      });

    casesEl.replaceChildren(
      ...cases.map((c) => renderCaseCard(c, `fraud-case-${c.id}`)),
    );

    // Restore open state
    for (const tid of openDetails) {
      const detailsEl = casesEl.querySelector<HTMLDetailsElement>(
        `[data-testid="${tid}"]`,
      );
      if (detailsEl) {
        detailsEl.open = true;
      }
    }
  }

  // ---- Timeline ----
  if (timeline.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "fraud-empty", style: "padding: 0.5rem 0; font-size: 0.6rem;" }, "No activity yet"),
    );
  } else {
    timelineEl.replaceChildren(
      ...timeline.slice(-30).map((entry) => {
        const entryEl = el("div", { className: "fraud-timeline-entry" },
          el("span", { className: "fraud-timeline-time" }, entry.time),
          el("span", { className: "fraud-timeline-msg" }, entry.message),
        );
        entryEl.dataset.type = entry.type;

        return entryEl;
      }),
    );
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }

  // ---- Checkpoints ----
  if (checkpoints.length === 0) {
    checkpointsEl.replaceChildren(
      el("div", { style: "font-size: 0.6rem; color: var(--fraud-text-dim);" }, "No checkpoints saved"),
    );
  } else {
    checkpointsEl.replaceChildren(
      ...checkpoints.map((cp) => {
        const restoreBtn = el("button", {
          className: "fraud-checkpoint-btn",
          title: "Restore",
        }, "\u21BA");
        restoreBtn.dataset.action = "restore";
        restoreBtn.dataset.checkpointId = cp.id;

        const deleteBtn = el("button", {
          className: "fraud-checkpoint-btn delete",
          title: "Delete",
        }, "\u00D7");
        deleteBtn.dataset.action = "delete-checkpoint";
        deleteBtn.dataset.checkpointId = cp.id;

        const item = el("div", { className: "fraud-checkpoint-item" },
          el("span", { className: "fraud-checkpoint-label", title: cp.label }, cp.label),
          el("div", { className: "fraud-checkpoint-actions" }, restoreBtn, deleteBtn),
        );
        item.dataset.testid = `fraud-checkpoint-${cp.id}`;

        return item;
      }),
    );
  }

  // ---- Button States ----
  runBtn.disabled = isRunning;
  autoBtn.disabled = isRunning;
  saveBtn.disabled = stage === "idle";
  thresholdSlider.disabled = isRunning;
  budgetSlider.disabled = isRunning;
  scenarioSelect.disabled = isRunning;
}

// ============================================================================
// Subscribe
// ============================================================================

const allKeys = [
  ...Object.keys(fraudSchema.facts),
  ...Object.keys(fraudSchema.derivations),
];

system.subscribe(allKeys, render);

// ============================================================================
// Pipeline Runner
// ============================================================================

let autoRunning = false;

async function runPipeline(): Promise<void> {
  if (system.facts.isRunning) {
    return;
  }

  const scenario = scenarios[system.facts.selectedScenario];
  if (!scenario) {
    return;
  }

  if (system.facts.stage === "idle") {
    addTimeline("stage", `ingesting ${scenario.name} scenario`);
    system.events.ingestEvents({ events: [...scenario.events] });
  }

  // Wait for constraint-driven resolution to settle
  await waitForSettled();

  // Check if more stages need to run
  const stage = system.facts.stage;
  const cases = system.facts.cases;
  const allAnalyzed =
    cases.length > 0 &&
    cases.every((c) => c.analyzed || c.disposition === "escalated");
  const allDispositioned =
    cases.length > 0 && cases.every((c) => c.disposition !== "pending");

  if (allDispositioned || (allAnalyzed && !autoRunning)) {
    system.facts.stage = "complete";
    system.facts.isRunning = false;
    addTimeline("stage", "pipeline complete");
  } else if (stage !== "complete" && stage !== "error") {
    system.facts.isRunning = false;
  }

  render();
}

async function autoRun(): Promise<void> {
  if (system.facts.isRunning || autoRunning) {
    return;
  }

  autoRunning = true;
  const scenario = scenarios[system.facts.selectedScenario];
  if (!scenario) {
    autoRunning = false;

    return;
  }

  addTimeline("stage", `auto-running ${scenario.name} scenario`);
  system.events.ingestEvents({ events: [...scenario.events] });

  // Keep waiting until pipeline settles completely
  let iterations = 0;
  const maxIterations = 60;

  while (iterations < maxIterations) {
    await waitForSettled();
    await delay(200);

    const cases = system.facts.cases;
    const allDone =
      cases.length > 0 &&
      cases.every(
        (c) =>
          c.disposition !== "pending" ||
          (c.enriched && !c.analyzed && system.facts.analysisBudget <= 0),
      );

    if (allDone) {
      break;
    }

    iterations++;
  }

  // Final disposition pass for any remaining pending cases
  const cases = system.facts.cases;
  const allDispositioned = cases.every((c) => c.disposition !== "pending");

  if (allDispositioned && cases.length > 0) {
    system.facts.stage = "complete";
    system.facts.isRunning = false;
    addTimeline("stage", "pipeline complete (auto-run)");
  }

  autoRunning = false;
  render();
}

function waitForSettled(): Promise<void> {
  return new Promise((resolve) => {
    let checks = 0;
    const check = () => {
      checks++;
      if (checks > 40) {
        resolve();

        return;
      }

      // Check if system has settled (no inflight requirements)
      if (!system.isSettled) {
        setTimeout(check, 150);
      } else {
        // Extra wait to let constraint re-evaluation fire
        setTimeout(resolve, 200);
      }
    };
    setTimeout(check, 100);
  });
}

// ============================================================================
// Checkpoint Logic
// ============================================================================

async function saveCheckpoint(): Promise<void> {
  const id = createCheckpointId();
  const label = `Stage: ${system.facts.stage} (${new Date().toLocaleTimeString()})`;

  const checkpoint: Checkpoint = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    label,
    systemExport: JSON.stringify({
      stage: system.facts.stage,
      flagEvents: system.facts.flagEvents,
      cases: system.facts.cases,
      isRunning: system.facts.isRunning,
      totalEventsProcessed: system.facts.totalEventsProcessed,
      totalPiiDetections: system.facts.totalPiiDetections,
      analysisBudget: system.facts.analysisBudget,
      maxAnalysisBudget: system.facts.maxAnalysisBudget,
      riskThreshold: system.facts.riskThreshold,
      lastError: system.facts.lastError,
      selectedScenario: system.facts.selectedScenario,
    }),
    timelineExport: JSON.stringify(timeline.slice(0, 50)),
    localState: { type: "single" },
    memoryExport: null,
    orchestratorType: "single",
  };

  await checkpointStore.save(checkpoint);

  const entry: CheckpointEntry = {
    id,
    label,
    createdAt: checkpoint.createdAt,
    stage: system.facts.stage,
  };
  system.facts.checkpoints = [...system.facts.checkpoints, entry];

  addTimeline("checkpoint", `saved: ${label}`);
  render();
}

async function restoreCheckpoint(checkpointId: string): Promise<void> {
  const checkpoint = await checkpointStore.load(checkpointId);
  if (!checkpoint) {
    addTimeline("error", "checkpoint not found");

    return;
  }

  if (!validateCheckpoint(checkpoint)) {
    addTimeline("error", "invalid checkpoint data");

    return;
  }

  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(checkpoint.systemExport);
  } catch {
    addTimeline("error", "corrupt checkpoint data");

    return;
  }

  system.facts.stage = saved.stage as PipelineStage;
  system.facts.flagEvents = saved.flagEvents as FraudCase["events"];
  system.facts.cases = saved.cases as FraudCase[];
  system.facts.isRunning = false;
  system.facts.totalEventsProcessed = saved.totalEventsProcessed as number;
  system.facts.totalPiiDetections = saved.totalPiiDetections as number;
  system.facts.analysisBudget = saved.analysisBudget as number;
  system.facts.maxAnalysisBudget = saved.maxAnalysisBudget as number;
  system.facts.riskThreshold = saved.riskThreshold as number;
  system.facts.lastError = (saved.lastError as string) ?? "";
  system.facts.selectedScenario =
    (saved.selectedScenario as string) ?? "card-skimming";

  // Restore timeline
  if (checkpoint.timelineExport) {
    try {
      const savedTimeline = JSON.parse(checkpoint.timelineExport);
      timeline.length = 0;
      for (const entry of savedTimeline) {
        timeline.push(entry);
      }
    } catch {
      // Timeline is non-critical — ignore corrupt data
    }
  }

  // Sync sliders
  thresholdSlider.value = String(saved.riskThreshold);
  thresholdValue.textContent = String(saved.riskThreshold);
  budgetSlider.value = String(saved.analysisBudget);
  budgetValue.textContent = String(saved.analysisBudget);

  addTimeline("checkpoint", `restored: ${checkpoint.label}`);
  render();
}

async function deleteCheckpoint(checkpointId: string): Promise<void> {
  const deleted = await checkpointStore.delete(checkpointId);
  if (deleted) {
    system.facts.checkpoints = system.facts.checkpoints.filter(
      (c) => c.id !== checkpointId,
    );
    addTimeline("checkpoint", "deleted checkpoint");
    render();
  }
}

// ============================================================================
// Controls
// ============================================================================

// Scenario selector
scenarioSelect.addEventListener("change", () => {
  system.events.selectScenario({ key: scenarioSelect.value });
  updateScenarioDesc();
});

function updateScenarioDesc(): void {
  const scenario = scenarios[scenarioSelect.value];
  if (scenario) {
    scenarioDesc.textContent = scenario.description;
    rulesEl.replaceChildren(
      ...scenario.rules.map((r) =>
        el("div", { className: "fraud-rule" },
          el("div", { className: "fraud-rule-header" },
            el("span", { className: `fraud-rule-severity fraud-rule-${r.severity}` }, r.severity),
            " ",
            el("strong", r.name),
          ),
          el("div", { className: "fraud-rule-desc" }, r.description),
        ),
      ),
    );
  }
}

// Threshold slider
thresholdSlider.addEventListener("input", () => {
  const val = Number(thresholdSlider.value);
  thresholdValue.textContent = String(val);
  system.events.setRiskThreshold({ value: val });
});

// Budget slider
budgetSlider.addEventListener("input", () => {
  const val = Number(budgetSlider.value);
  budgetValue.textContent = String(val);
  system.events.setBudget({ value: val });
});

// Run button
runBtn.addEventListener("click", () => {
  runPipeline();
});

// Auto-run button
autoBtn.addEventListener("click", () => {
  autoRun();
});

// Save checkpoint
saveBtn.addEventListener("click", () => {
  saveCheckpoint();
});

// Reset button
resetBtn.addEventListener("click", () => {
  autoRunning = false;
  system.events.reset();
  thresholdSlider.value = "70";
  thresholdValue.textContent = "70";
  budgetSlider.value = "300";
  budgetValue.textContent = "300";
  system.events.setRiskThreshold({ value: 70 });
  system.events.setBudget({ value: 300 });
  timeline.length = 0;
  render();
});

// Delegated click handler for checkpoint actions
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const action = target.dataset.action;
  const cpId = target.dataset.checkpointId;

  if (!action || !cpId) {
    return;
  }

  if (action === "restore") {
    restoreCheckpoint(cpId);
  } else if (action === "delete-checkpoint") {
    deleteCheckpoint(cpId);
  }
});

// ============================================================================
// Initial Render
// ============================================================================

updateScenarioDesc();
render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-fraud-analysis-ready", "true");
