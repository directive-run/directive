/**
 * A/B Testing Engine — DOM Rendering & System Wiring
 *
 * Imports from module, starts system, renders experiment cards and event timeline.
 */

import { el } from "@directive-run/el";
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
  const cards: HTMLElement[] = [];
  for (const exp of experiments) {
    const assigned = assignments[exp.id];
    const exposed = exposures[exp.id];

    const variantBtns = exp.variants.map((variant) => {
      const btn = el("button", {
        className: `variant-btn${assigned === variant.id ? " active" : ""}`,
      }, `${variant.label} (${variant.weight}%)`);

      btn.addEventListener("click", () => {
        system.events.assignVariant({
          experimentId: exp.id,
          variantId: variant.id,
        });
        addLog("event", `Manual assignment: ${exp.id} -> ${variant.id}`);
      });

      return btn;
    });

    const statusText = exp.active ? (system.facts.paused ? "Paused" : "Active") : "Inactive";

    cards.push(
      el("div", { className: "experiment" },
        el("div", { className: "experiment-name" }, exp.name),
        el("div", { className: "experiment-meta" },
          `ID: ${exp.id} \u00a0|\u00a0 Status: ${statusText} \u00a0|\u00a0 Assigned: ${assigned ?? "\u2013"} \u00a0|\u00a0 Exposed: ${exposed ? new Date(exposed).toLocaleTimeString() : "\u2013"}`,
        ),
        el("div", { className: "experiment-variants" }, ...variantBtns),
      ),
    );
  }
  experimentsEl.replaceChildren(...cards);

  // --- Timeline ---
  if (timeline.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "ab-timeline-empty" }, "Events appear after interactions"),
    );
  } else {
    const entries = timeline.map((entry) => {
      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      return el("div", { className: `ab-timeline-entry ${entry.type}` },
        el("span", { className: "ab-timeline-time" }, timeStr),
        el("span", { className: "ab-timeline-event" }, entry.event),
        el("span", { className: "ab-timeline-detail" }, entry.detail),
      );
    });

    timelineEl.replaceChildren(...entries);
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
