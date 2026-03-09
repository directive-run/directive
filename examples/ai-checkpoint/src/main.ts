/**
 * AI Pipeline Checkpoint — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import { el } from "@directive-run/el";
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
// Render
// ============================================================================

function render(): void {
  const stage = system.facts.currentStage;
  const completion = system.read("completionPercentage");
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
    const emptyMsg = el("div", "No checkpoints saved");
    emptyMsg.style.cssText = "color:var(--brand-text-faint);font-size:0.65rem;font-style:italic";
    checkpointList.replaceChildren(emptyMsg);
  } else {
    checkpointList.replaceChildren(
      ...checkpoints.map((cp) => {
        const time = new Date(cp.createdAt);
        const timeStr = time.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const restoreBtn = el("button", { className: "cp-btn-sm" }, "Restore");
        restoreBtn.setAttribute("data-restore", cp.id);

        const deleteBtn = el("button", { className: "cp-btn-sm danger" }, "Del");
        deleteBtn.setAttribute("data-delete", cp.id);

        const entry = el("div", { className: "cp-checkpoint-entry" },
          el("div", { className: "cp-checkpoint-info" },
            el("span", { className: "cp-checkpoint-label" }, cp.label),
            el("span", { className: "cp-checkpoint-time" }, timeStr),
          ),
          el("div", { className: "cp-checkpoint-actions" },
            restoreBtn,
            deleteBtn,
          ),
        );
        entry.setAttribute("data-testid", `cp-ckpt-${cp.id}`);

        return entry;
      }),
    );
  }

  // Timeline
  if (timeline.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "cp-timeline-empty" }, "Events appear after running the pipeline"),
    );
  } else {
    timelineEl.replaceChildren(
      ...timeline.map((entry) => {
        const time = new Date(entry.time);
        const timeStr = time.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return el("div", { className: `cp-timeline-entry ${entry.type}` },
          el("span", { className: "cp-timeline-time" }, timeStr),
          el("span", { className: "cp-timeline-event" }, entry.event),
          el("span", { className: "cp-timeline-detail" }, entry.detail),
        );
      }),
    );
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
