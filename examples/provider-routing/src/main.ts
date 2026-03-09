/**
 * Smart Provider Router — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import { el } from "@directive-run/el";
import type { CircuitState } from "@directive-run/core/plugins";

import {
  type ProviderStats,
  circuitBreakers,
  providerErrors,
  schema,
  sendRequest,
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

const inspOpenai = document.getElementById("pr-insp-openai")!;
const inspAnthropic = document.getElementById("pr-insp-anthropic")!;
const inspOllama = document.getElementById("pr-insp-ollama")!;
const timelineEl = document.getElementById("pr-timeline")!;

// ============================================================================
// Helpers
// ============================================================================

function circuitBadge(state: CircuitState): HTMLSpanElement {
  const cls =
    state === "CLOSED" ? "closed" : state === "OPEN" ? "open" : "half-open";

  return el("span", { className: `pr-circuit-badge ${cls}` }, state);
}

function renderProvider(
  container: HTMLElement,
  stats: ProviderStats,
  state: CircuitState,
): void {
  container.replaceChildren(
    circuitBadge(state),
    el("span", { style: "font-size:0.55rem;color:var(--brand-text-dim)" },
      `${stats.callCount} calls, ${stats.errorCount} err, $${stats.totalCost}`,
    ),
  );
}

// ============================================================================
// Render
// ============================================================================

function render(): void {
  renderProvider(
    inspOpenai,
    system.facts.openaiStats,
    circuitBreakers.openai.getState(),
  );
  renderProvider(
    inspAnthropic,
    system.facts.anthropicStats,
    circuitBreakers.anthropic.getState(),
  );
  renderProvider(
    inspOllama,
    system.facts.ollamaStats,
    circuitBreakers.ollama.getState(),
  );

  // Error inject checkboxes
  for (const id of ["openai", "anthropic", "ollama"]) {
    const cb = document.getElementById(`pr-err-${id}`) as HTMLInputElement;
    if (cb) {
      cb.checked = providerErrors[id] ?? false;
    }
  }

  // Timeline
  if (timeline.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "pr-timeline-empty" }, "Events appear after sending requests"),
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

        return el("div", { className: `pr-timeline-entry ${entry.type}` },
          el("span", { className: "pr-timeline-time" }, timeStr),
          el("span", { className: "pr-timeline-event" }, entry.event),
          el("span", { className: "pr-timeline-detail" }, entry.detail),
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

setInterval(render, 1000);

// ============================================================================
// Controls
// ============================================================================

document
  .getElementById("pr-send")!
  .addEventListener("click", () => sendRequest());

document.getElementById("pr-burst-10")!.addEventListener("click", async () => {
  for (let i = 0; i < 10; i++) {
    await sendRequest();
  }
});

for (const id of ["openai", "anthropic", "ollama"]) {
  document.getElementById(`pr-err-${id}`)!.addEventListener("change", () => {
    system.events.toggleProviderError({ provider: id });
  });
}

(document.getElementById("pr-budget") as HTMLInputElement).addEventListener(
  "input",
  (e) => {
    const value = Number((e.target as HTMLInputElement).value);
    document.getElementById("pr-budget-val")!.textContent = `$${value}`;
    system.events.setBudget({ value });
  },
);

document
  .getElementById("pr-prefer-cheapest")!
  .addEventListener("change", () => {
    system.events.togglePreferCheapest();
  });

document.getElementById("pr-reset")!.addEventListener("click", () => {
  system.events.resetStats();
});

// ============================================================================
// Initial Render
// ============================================================================

render();
document.body.setAttribute("data-provider-routing-ready", "true");
