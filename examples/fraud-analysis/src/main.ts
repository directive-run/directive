/**
 * Fraud Case Analysis — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

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

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

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

function renderTransactionTable(events: FlagEvent[]): string {
  const rows = events
    .map((e) => {
      const merchant = escapeHtml(e.redactedMerchant ?? e.merchant);
      const piiDot = e.piiFound
        ? '<span class="fraud-pii-dot" title="PII detected"></span>'
        : "";

      return `<tr>
      <td>${escapeHtml(formatTimestamp(e.timestamp))}</td>
      <td>${merchant}${piiDot}</td>
      <td>$${e.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td class="fraud-txn-col-location">${escapeHtml(e.location)}</td>
      <td>${escapeHtml(e.cardLast4)}</td>
    </tr>`;
    })
    .join("");

  return `<table class="fraud-txn-table">
    <thead><tr>
      <th>Time</th><th>Merchant</th><th>Amount</th>
      <th class="fraud-txn-col-location">Location</th><th>Card</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderSignals(signals: EnrichmentSignal[]): string {
  if (signals.length === 0) {
    return "";
  }

  const items = signals
    .map(
      (s) => `
    <div class="fraud-signal-item">
      <span class="fraud-signal-name">${escapeHtml(s.source)}</span>
      <div class="fraud-signal-bar-track">
        <div class="fraud-signal-bar-fill" style="width: ${s.risk}%; background: ${signalColor(s.risk)};"></div>
      </div>
      <span class="fraud-signal-score">${s.risk}</span>
    </div>
    <div class="fraud-signal-detail">${escapeHtml(s.detail)}</div>
  `,
    )
    .join("");

  return `<div class="fraud-detail-label">Signals</div>
    <div class="fraud-signal-list">${items}</div>`;
}

function renderAnalysisNotes(notes: string | undefined): string {
  if (!notes) {
    return "";
  }

  return `<div class="fraud-detail-label">Analysis</div>
    <div class="fraud-analysis-note">${escapeHtml(notes)}</div>`;
}

function renderDispositionReason(reason: string | undefined): string {
  if (!reason) {
    return "";
  }

  return `<div class="fraud-disposition-reason">${escapeHtml(reason)}</div>`;
}

function renderCaseCard(c: FraudCase, testId: string): string {
  const totalAmount = c.events.reduce((sum, e) => sum + e.amount, 0);

  const hasDetails = c.events.length > 0;
  const detailsBlock = hasDetails
    ? `
    <details class="fraud-case-details" data-testid="${testId}-details">
      <summary>Details</summary>
      <div class="fraud-case-details-body">
        <div class="fraud-detail-label">Transactions</div>
        ${renderTransactionTable(c.events)}
        ${renderSignals(c.signals)}
        ${renderAnalysisNotes(c.analysisNotes)}
        ${renderDispositionReason(c.dispositionReason)}
      </div>
    </details>
  `
    : "";

  return `
    <div class="fraud-case-card" data-disposition="${escapeHtml(c.disposition)}" data-testid="${testId}">
      <div class="fraud-case-header">
        <span class="fraud-case-id">${escapeHtml(c.id)}</span>
        ${c.analyzed ? `<span class="fraud-case-badge fraud-badge-${escapeHtml(c.severity)}">${escapeHtml(c.severity)}</span>` : ""}
      </div>
      <div class="fraud-case-meta">
        <span>${c.events.length} txns</span>
        <span>$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
        <span>${escapeHtml(c.accountId)}</span>
        ${c.riskScore > 0 ? `<span>Risk: ${c.riskScore}</span>` : ""}
      </div>
      ${c.disposition !== "pending" ? `<div class="fraud-case-disposition fraud-disp-${escapeHtml(c.disposition)}">${escapeHtml(c.disposition.replace("_", " "))}</div>` : '<div class="fraud-case-disposition fraud-disp-pending">pending</div>'}
      ${detailsBlock}
    </div>
  `;
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
  const dispositionSummary = derive.dispositionSummary as Record<
    string,
    number
  >;
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
    const rows = DISPOSITION_ORDER.filter(
      (d) => (dispositionSummary[d] ?? 0) > 0,
    )
      .map(
        (d) => `
        <div class="fraud-disposition-row">
          <span class="fraud-disposition-dot disp-${escapeHtml(d)}"></span>
          <span class="fraud-disposition-label">${escapeHtml(d.replace("_", " "))}</span>
          <span class="fraud-disposition-count">${dispositionSummary[d]}</span>
        </div>
      `,
      )
      .join("");
    dispositionBreakdown.innerHTML = `<div class="fraud-metric-label">Dispositions</div>${rows}`;
  } else {
    dispositionBreakdown.innerHTML =
      '<div class="fraud-metric-label">Dispositions</div><div style="font-size: 0.6rem; color: var(--fraud-text-dim);">No cases</div>';
  }

  // ---- Stage Progress Stats ----
  const maxBudget = facts.maxAnalysisBudget;
  stageStatsEl.innerHTML = `
    <div class="fraud-stage-stat">
      <div class="fraud-stage-stat-label">Events</div>
      <div class="fraud-stage-stat-value" data-testid="fraud-stat-events">${facts.totalEventsProcessed}</div>
    </div>
    <div class="fraud-stage-stat">
      <div class="fraud-stage-stat-label">Cases</div>
      <div class="fraud-stage-stat-value">${caseCount}</div>
    </div>
    <div class="fraud-stage-stat">
      <div class="fraud-stage-stat-label">Ungrouped</div>
      <div class="fraud-stage-stat-value">${ungroupedCount}</div>
    </div>
    <div class="fraud-stage-stat">
      <div class="fraud-stage-stat-label">Pending Analysis</div>
      <div class="fraud-stage-stat-value">${pendingAnalysisCount}</div>
    </div>
    <div class="fraud-stage-stat">
      <div class="fraud-stage-stat-label">PII Hits</div>
      <div class="fraud-stage-stat-value">${piiDetections}</div>
    </div>
    <div class="fraud-stage-stat">
      <div class="fraud-stage-stat-label">Budget</div>
      <div class="fraud-stage-stat-value">${budget} / ${maxBudget}</div>
    </div>
  `;

  // ---- Case Cards (with open-state preservation) ----
  if (cases.length === 0) {
    casesEl.innerHTML =
      '<div class="fraud-empty">No cases yet. Select a scenario and run the pipeline.</div>';
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

    casesEl.innerHTML = cases
      .map((c) => {
        const testId = `fraud-case-${escapeHtml(c.id)}`;

        return renderCaseCard(c, testId);
      })
      .join("");

    // Restore open state
    for (const tid of openDetails) {
      const el = casesEl.querySelector<HTMLDetailsElement>(
        `[data-testid="${tid}"]`,
      );
      if (el) {
        el.open = true;
      }
    }
  }

  // ---- Timeline ----
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="fraud-empty" style="padding: 0.5rem 0; font-size: 0.6rem;">No activity yet</div>';
  } else {
    timelineEl.innerHTML = timeline
      .slice(-30)
      .map(
        (entry) => `
      <div class="fraud-timeline-entry" data-type="${escapeHtml(entry.type)}">
        <span class="fraud-timeline-time">${escapeHtml(entry.time)}</span>
        <span class="fraud-timeline-msg">${escapeHtml(entry.message)}</span>
      </div>
    `,
      )
      .join("");
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }

  // ---- Checkpoints ----
  if (checkpoints.length === 0) {
    checkpointsEl.innerHTML =
      '<div style="font-size: 0.6rem; color: var(--fraud-text-dim);">No checkpoints saved</div>';
  } else {
    checkpointsEl.innerHTML = checkpoints
      .map(
        (cp) => `
      <div class="fraud-checkpoint-item" data-testid="fraud-checkpoint-${escapeHtml(cp.id)}">
        <span class="fraud-checkpoint-label" title="${escapeHtml(cp.label)}">${escapeHtml(cp.label)}</span>
        <div class="fraud-checkpoint-actions">
          <button class="fraud-checkpoint-btn" data-action="restore" data-checkpoint-id="${escapeHtml(cp.id)}" title="Restore">&#8634;</button>
          <button class="fraud-checkpoint-btn delete" data-action="delete-checkpoint" data-checkpoint-id="${escapeHtml(cp.id)}" title="Delete">&times;</button>
        </div>
      </div>
    `,
      )
      .join("");
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
    rulesEl.innerHTML = scenario.rules
      .map(
        (r) =>
          `<div class="fraud-rule"><div class="fraud-rule-header"><span class="fraud-rule-severity fraud-rule-${r.severity}">${r.severity}</span> <strong>${escapeHtml(r.name)}</strong></div><div class="fraud-rule-desc">${escapeHtml(r.description)}</div></div>`,
      )
      .join("");
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
