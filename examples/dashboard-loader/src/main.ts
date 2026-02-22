/**
 * Dashboard Loader — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * and renders the resource cards, controls, and event timeline.
 */

import { createSystem } from "@directive-run/core";
import {
  dashboardLoaderModule,
  dashboardLoaderSchema,
  type ResourceState,
  type EventLogEntry,
} from "./dashboard-loader.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: dashboardLoaderModule,
});
system.start();

const allKeys = [
  ...Object.keys(dashboardLoaderSchema.facts),
  ...Object.keys(dashboardLoaderSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

const userInput = document.getElementById("dl-user-input") as HTMLInputElement;
const startBtn = document.getElementById("dl-start-btn") as HTMLButtonElement;
const reloadBtn = document.getElementById("dl-reload-btn") as HTMLButtonElement;

const combinedStatusEl = document.getElementById("dl-combined-status")!;
const progressFill = document.getElementById("dl-progress-fill")!;
const loadedCountEl = document.getElementById("dl-loaded-count")!;

const profileBody = document.getElementById("dl-profile-body")!;
const profileStatus = document.getElementById("dl-profile-status")!;
const profileTiming = document.getElementById("dl-profile-timing")!;
const profileAttempts = document.getElementById("dl-profile-attempts")!;

const prefsBody = document.getElementById("dl-prefs-body")!;
const prefsStatus = document.getElementById("dl-prefs-status")!;
const prefsTiming = document.getElementById("dl-prefs-timing")!;
const prefsAttempts = document.getElementById("dl-prefs-attempts")!;

const permsBody = document.getElementById("dl-perms-body")!;
const permsStatus = document.getElementById("dl-perms-status")!;
const permsTiming = document.getElementById("dl-perms-timing")!;
const permsAttempts = document.getElementById("dl-perms-attempts")!;

const timelineEl = document.getElementById("dl-timeline")!;

// Slider elements
const profileDelaySlider = document.getElementById("dl-profile-delay") as HTMLInputElement;
const profileDelayVal = document.getElementById("dl-profile-delay-val")!;
const profileFailrateSlider = document.getElementById("dl-profile-failrate") as HTMLInputElement;
const profileFailrateVal = document.getElementById("dl-profile-failrate-val")!;

const prefsDelaySlider = document.getElementById("dl-prefs-delay") as HTMLInputElement;
const prefsDelayVal = document.getElementById("dl-prefs-delay-val")!;
const prefsFailrateSlider = document.getElementById("dl-prefs-failrate") as HTMLInputElement;
const prefsFailrateVal = document.getElementById("dl-prefs-failrate-val")!;

const permsDelaySlider = document.getElementById("dl-perms-delay") as HTMLInputElement;
const permsDelayVal = document.getElementById("dl-perms-delay-val")!;
const permsFailrateSlider = document.getElementById("dl-perms-failrate") as HTMLInputElement;
const permsFailrateVal = document.getElementById("dl-perms-failrate-val")!;

// ============================================================================
// Render
// ============================================================================

function formatElapsed(res: ResourceState<unknown>): string {
  if (!res.startedAt) {
    return "";
  }

  const end = res.completedAt ?? Date.now();
  const elapsed = ((end - res.startedAt) / 1000).toFixed(1);

  return `${elapsed}s`;
}

function renderCard(
  res: ResourceState<unknown>,
  bodyEl: HTMLElement,
  statusEl: HTMLElement,
  timingEl: HTMLElement,
  attemptsEl: HTMLElement,
  retryTestId: string,
  resourceKey: string,
): void {
  // Badge
  statusEl.textContent = res.status;
  statusEl.className = `dl-status-badge ${res.status}`;

  // Timing
  timingEl.textContent = formatElapsed(res);

  // Attempts
  if (res.attempts > 1) {
    attemptsEl.textContent = `Attempt ${res.attempts}`;
  } else {
    attemptsEl.textContent = "";
  }

  // Body
  if (res.status === "idle") {
    bodyEl.innerHTML = '<span class="dl-loading-msg" style="color: var(--brand-text-faint); font-style: italic;">Waiting to start</span>';
  } else if (res.status === "loading") {
    bodyEl.innerHTML = '<span class="dl-loading-msg"><span class="dl-spinner"></span> Fetching data...</span>';
  } else if (res.status === "success" && res.data) {
    const data = res.data as Record<string, unknown>;
    let preview = "";
    for (const [key, val] of Object.entries(data)) {
      const displayVal = Array.isArray(val) ? val.join(", ") : String(val);
      preview += `<div><span class="dl-data-label">${escapeHtml(key)}</span> ${escapeHtml(displayVal)}</div>`;
    }
    bodyEl.innerHTML = `<div class="dl-data-preview">${preview}</div>`;
  } else if (res.status === "error") {
    bodyEl.innerHTML = `
      <span class="dl-error-msg">${escapeHtml(res.error ?? "Unknown error")}</span>
      <button class="dl-btn retry-btn" data-testid="${retryTestId}" data-resource="${resourceKey}">Retry</button>
    `;
  }
}

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const profile = facts.profile as ResourceState<unknown>;
  const prefs = facts.preferences as ResourceState<unknown>;
  const perms = facts.permissions as ResourceState<unknown>;
  const loaded = derive.loadedCount as number;
  const combined = derive.combinedStatus as string;
  const canStart = derive.canStart as boolean;
  const anyLoading = derive.anyLoading as boolean;
  const anyError = derive.anyError as boolean;
  const allLoaded = derive.allLoaded as boolean;
  const eventLog = facts.eventLog as EventLogEntry[];

  // Status bar
  combinedStatusEl.textContent = combined;
  loadedCountEl.textContent = `${loaded} / 3`;

  const pct = Math.round((loaded / 3) * 100);
  progressFill.style.width = `${pct}%`;
  progressFill.className = "dl-progress-fill";
  if (allLoaded) {
    progressFill.classList.add("complete");
  } else if (anyError) {
    progressFill.classList.add("has-error");
  }

  // Buttons
  startBtn.disabled = !canStart;
  reloadBtn.disabled = [profile, prefs, perms].every((r: any) => r.status === "idle");

  // Cards
  renderCard(profile, profileBody, profileStatus, profileTiming, profileAttempts, "dashboard-loader-profile-retry", "profile");
  renderCard(prefs, prefsBody, prefsStatus, prefsTiming, prefsAttempts, "dashboard-loader-prefs-retry", "preferences");
  renderCard(perms, permsBody, permsStatus, permsTiming, permsAttempts, "dashboard-loader-perms-retry", "permissions");

  // Slider value labels
  profileDelayVal.textContent = `${facts.profileDelay}ms`;
  profileFailrateVal.textContent = `${facts.profileFailRate}%`;
  prefsDelayVal.textContent = `${facts.preferencesDelay}ms`;
  prefsFailrateVal.textContent = `${facts.preferencesFailRate}%`;
  permsDelayVal.textContent = `${facts.permissionsDelay}ms`;
  permsFailrateVal.textContent = `${facts.permissionsFailRate}%`;

  // Timeline
  if (eventLog.length === 0) {
    timelineEl.innerHTML = '<div class="dl-timeline-empty">Events will appear here when loading starts</div>';
  } else {
    timelineEl.innerHTML = "";
    // Show newest first
    for (let i = eventLog.length - 1; i >= 0; i--) {
      const entry = eventLog[i];
      const el = document.createElement("div");
      el.className = `dl-timeline-entry ${entry.event}`;

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="dl-timeline-time">${timeStr}</span>
        <span class="dl-timeline-resource">${escapeHtml(entry.resource)}</span>
        <span class="dl-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

// Start loading
function handleStart(): void {
  const value = userInput.value.trim();
  if (value.length === 0) {
    return;
  }

  system.events.setUserId({ value });
  system.events.start();
}

startBtn.addEventListener("click", handleStart);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleStart();
  }
});

userInput.addEventListener("input", () => {
  system.events.setUserId({ value: userInput.value });
});

// Reload all
reloadBtn.addEventListener("click", () => {
  system.events.reloadAll();
});

// Retry buttons (delegated)
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains("retry-btn") && target.dataset.resource) {
    system.events.retryResource({ resource: target.dataset.resource });
  }
});

// Sliders — Profile
profileDelaySlider.addEventListener("input", () => {
  system.events.setDelay({ resource: "profile", value: Number(profileDelaySlider.value) });
});

profileFailrateSlider.addEventListener("input", () => {
  system.events.setFailRate({ resource: "profile", value: Number(profileFailrateSlider.value) });
});

// Sliders — Preferences
prefsDelaySlider.addEventListener("input", () => {
  system.events.setDelay({ resource: "preferences", value: Number(prefsDelaySlider.value) });
});

prefsFailrateSlider.addEventListener("input", () => {
  system.events.setFailRate({ resource: "preferences", value: Number(prefsFailrateSlider.value) });
});

// Sliders — Permissions
permsDelaySlider.addEventListener("input", () => {
  system.events.setDelay({ resource: "permissions", value: Number(permsDelaySlider.value) });
});

permsFailrateSlider.addEventListener("input", () => {
  system.events.setFailRate({ resource: "permissions", value: Number(permsFailrateSlider.value) });
});

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Initial Render
// ============================================================================

// Set initial userId from the pre-filled input
system.events.setUserId({ value: userInput.value });

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-dashboard-loader-ready", "true");
