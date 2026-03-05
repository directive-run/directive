/**
 * Resilient API Dashboard — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import type { RecoveryStrategy } from "@directive-run/core";

import { type ServiceState, perf, schema, system, timeline } from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

// Service cards
const usersStatusEl = document.getElementById("eb-users-status")!;
const usersResultEl = document.getElementById("eb-users-result")!;
const usersErrorEl = document.getElementById("eb-users-error")!;
const ordersStatusEl = document.getElementById("eb-orders-status")!;
const ordersResultEl = document.getElementById("eb-orders-result")!;
const ordersErrorEl = document.getElementById("eb-orders-error")!;
const analyticsStatusEl = document.getElementById("eb-analytics-status")!;
const analyticsResultEl = document.getElementById("eb-analytics-result")!;
const analyticsErrorEl = document.getElementById("eb-analytics-error")!;

// Sliders
const usersFailSlider = document.getElementById(
  "eb-users-failrate",
) as HTMLInputElement;
const usersFailVal = document.getElementById("eb-users-fail-val")!;
const ordersFailSlider = document.getElementById(
  "eb-orders-failrate",
) as HTMLInputElement;
const ordersFailVal = document.getElementById("eb-orders-fail-val")!;
const analyticsFailSlider = document.getElementById(
  "eb-analytics-failrate",
) as HTMLInputElement;
const analyticsFailVal = document.getElementById("eb-analytics-fail-val")!;

// Strategy dropdown
const strategySelect = document.getElementById(
  "eb-strategy",
) as HTMLSelectElement;

// Timeline
const timelineEl = document.getElementById("eb-timeline")!;

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function renderServiceCard(
  statusEl: HTMLElement,
  resultEl: HTMLElement,
  errorEl: HTMLElement,
  service: ServiceState,
): void {
  statusEl.textContent = service.status;
  statusEl.className = `eb-service-status ${service.status}`;
  resultEl.textContent = service.lastResult || "\u2014";
  if (service.lastError) {
    errorEl.textContent = service.lastError.slice(0, 50);
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }
}

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;

  // Service cards
  renderServiceCard(
    usersStatusEl,
    usersResultEl,
    usersErrorEl,
    facts.usersService,
  );
  renderServiceCard(
    ordersStatusEl,
    ordersResultEl,
    ordersErrorEl,
    facts.ordersService,
  );
  renderServiceCard(
    analyticsStatusEl,
    analyticsResultEl,
    analyticsErrorEl,
    facts.analyticsService,
  );

  // Slider labels
  usersFailVal.textContent = `${facts.usersFailRate}%`;
  ordersFailVal.textContent = `${facts.ordersFailRate}%`;
  analyticsFailVal.textContent = `${facts.analyticsFailRate}%`;

  // Timeline
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="eb-timeline-empty">Events appear after interactions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `eb-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="eb-timeline-time">${timeStr}</span>
        <span class="eb-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="eb-timeline-detail">${escapeHtml(entry.detail)}</span>
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

// Periodic refresh for circuit breaker state transitions + retry queue
setInterval(() => {
  render();
}, 1000);

// ============================================================================
// Controls
// ============================================================================

// Fetch buttons
document.getElementById("eb-fetch-users")!.addEventListener("click", () => {
  system.events.fetchUsers();
});
document.getElementById("eb-fetch-orders")!.addEventListener("click", () => {
  system.events.fetchOrders();
});
document.getElementById("eb-fetch-analytics")!.addEventListener("click", () => {
  system.events.fetchAnalytics();
});
document.getElementById("eb-fetch-all")!.addEventListener("click", () => {
  system.events.fetchAll();
});
document.getElementById("eb-reset")!.addEventListener("click", () => {
  perf.reset();
  system.events.resetAll();
});

// Strategy selector
strategySelect.addEventListener("change", () => {
  system.events.setStrategy({
    value: strategySelect.value as RecoveryStrategy,
  });
});

// Sliders
usersFailSlider.addEventListener("input", () => {
  system.events.setUsersFailRate({ value: Number(usersFailSlider.value) });
});
ordersFailSlider.addEventListener("input", () => {
  system.events.setOrdersFailRate({ value: Number(ordersFailSlider.value) });
});
analyticsFailSlider.addEventListener("input", () => {
  system.events.setAnalyticsFailRate({
    value: Number(analyticsFailSlider.value),
  });
});

// ============================================================================
// Initial Render
// ============================================================================

render();
document.body.setAttribute("data-error-boundaries-ready", "true");
