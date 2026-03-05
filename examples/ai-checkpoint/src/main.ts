/**
 * AI Pipeline Checkpoint — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import {
  type PipelineStage,
  STAGES,
  advancePipeline,
  autoRun,
  checkpointStore,
  deleteCheckpoint,
  restoreCheckpoint,
  saveCheckpoint,
  schema,
  system,
  timeline,
} from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const progressBar = document.getElementById("cp-progress-fill")!;
const progressLabel = document.getElementById("cp-progress-label")!;
const stageIndicators = document.querySelectorAll<HTMLElement>(".cp-stage-dot");

const checkpointList = document.getElementById("cp-checkpoint-list")!;
const timelineEl = document.getElementById("cp-timeline")!;

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const stage = system.facts.currentStage;
  const completion = system.read("completionPercentage") as number;
  const results = system.facts.stageResults;

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
  const checkpoints = system.facts.checkpoints;
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
  .addEventListener("click", () => advancePipeline(render));
document
  .getElementById("cp-auto-run")!
  .addEventListener("click", () => autoRun(render));

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
