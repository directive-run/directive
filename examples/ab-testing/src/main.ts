/**
 * A/B Testing Engine — DOM Rendering & System Wiring
 *
 * Imports from module, starts system, renders experiment cards and event timeline.
 */

import { type Experiment, addLog, system, timeline } from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

// Stats
const experimentCountEl = document.getElementById("experiment-count")!;
const assignedCountEl = document.getElementById("assigned-count")!;
const exposedCountEl = document.getElementById("exposed-count")!;
const userIdEl = document.getElementById("user-id")!;
const experimentsEl = document.getElementById("experiments")!;
const pauseBtn = document.getElementById("btn-pause")!;
const resetBtn = document.getElementById("btn-reset")!;

// Timeline
const timelineEl = document.getElementById("ab-timeline")!;

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

function render() {
  const experiments = system.facts.experiments as Experiment[];
  const assignments = system.facts.assignments as Record<string, string>;
  const exposures = system.facts.exposures as Record<string, number>;
  const assignedCount = system.read("assignedCount") as number;
  const exposedCount = system.read("exposedCount") as number;

  // --- Stats ---
  experimentCountEl.textContent = String(experiments.length);
  assignedCountEl.textContent = String(assignedCount);
  exposedCountEl.textContent = String(exposedCount);
  userIdEl.textContent = system.facts.userId;

  pauseBtn.textContent = system.facts.paused ? "Resume All" : "Pause All";
  pauseBtn.className = system.facts.paused ? "ab-btn" : "ab-btn primary";

  // --- Experiment cards ---
  experimentsEl.innerHTML = "";
  for (const exp of experiments) {
    const div = document.createElement("div");
    div.className = "experiment";

    const assigned = assignments[exp.id];
    const exposed = exposures[exp.id];

    div.innerHTML = `
      <div class="experiment-name">${escapeHtml(exp.name)}</div>
      <div class="experiment-meta">
        ID: ${escapeHtml(exp.id)} &nbsp;|&nbsp;
        Status: ${exp.active ? (system.facts.paused ? "Paused" : "Active") : "Inactive"} &nbsp;|&nbsp;
        Assigned: ${assigned ?? "\u2013"} &nbsp;|&nbsp;
        Exposed: ${exposed ? new Date(exposed).toLocaleTimeString() : "\u2013"}
      </div>
      <div class="experiment-variants"></div>
    `;

    const variantsEl = div.querySelector(".experiment-variants")!;
    for (const variant of exp.variants) {
      const btn = document.createElement("button");
      btn.className = `variant-btn${assigned === variant.id ? " active" : ""}`;
      btn.textContent = `${variant.label} (${variant.weight}%)`;
      btn.addEventListener("click", () => {
        system.events.assignVariant({
          experimentId: exp.id,
          variantId: variant.id,
        });
        addLog("event", `Manual assignment: ${exp.id} → ${variant.id}`);
      });
      variantsEl.appendChild(btn);
    }

    experimentsEl.appendChild(div);
  }

  // --- Timeline ---
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="ab-timeline-empty">Events appear after interactions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `ab-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="ab-timeline-time">${timeStr}</span>
        <span class="ab-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="ab-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(
  [
    "experiments",
    "assignments",
    "exposures",
    "userId",
    "paused",
    "activeExperiments",
    "assignedCount",
    "exposedCount",
  ],
  render,
);

// ============================================================================
// Controls
// ============================================================================

// Button handlers
pauseBtn.addEventListener("click", () => {
  if (system.facts.paused) {
    system.events.resumeAll();
    addLog("event", "Resumed all experiments");
  } else {
    system.events.pauseAll();
    addLog("event", "Paused all experiments");
  }
});

resetBtn.addEventListener("click", () => {
  system.events.reset();
  timeline.length = 0;
  addLog("event", "Reset all assignments and exposures");
});

// ============================================================================
// Register Sample Experiments
// ============================================================================

system.events.registerExperiment({
  id: "theme-icons",
  name: "Theme Icons",
  variants: [
    { id: "custom-svg", weight: 50, label: "Custom SVG" },
    { id: "phosphor", weight: 50, label: "Phosphor" },
  ],
});
addLog("event", "Registered experiment: theme-icons");

system.events.registerExperiment({
  id: "cta-color",
  name: "CTA Button Color",
  variants: [
    { id: "brand", weight: 50, label: "Brand" },
    { id: "green", weight: 30, label: "Green" },
    { id: "orange", weight: 20, label: "Orange" },
  ],
});
addLog("event", "Registered experiment: cta-color");

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that initialization is complete
document.body.setAttribute("data-ab-testing-ready", "true");
