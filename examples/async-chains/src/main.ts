/**
 * Async Chains — DOM Rendering & System Wiring
 *
 * Creates a multi-module Directive system with three chained steps:
 *   Auth → Permissions → Dashboard
 *
 * Subscribes to state changes, renders the chain visualization,
 * controls, and event timeline.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin, loggingPlugin } from "@directive-run/core/plugins";
import {
  authModule,
  authSchema,
  dashboardModule,
  dashboardSchema,
  permissionsModule,
  permissionsSchema,
} from "./async-chains.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  modules: {
    auth: authModule,
    permissions: permissionsModule,
    dashboard: dashboardModule,
  },
  plugins: [
    loggingPlugin({ level: "info" }),
    devtoolsPlugin({ name: "async-chains", trace: true }),
  ],
  debug: {
    timeTravel: true,
    maxSnapshots: 50,
    runHistory: true,
  },
});
system.start();

// Build subscription keys from all module schemas
const allKeys = [
  ...Object.keys(authSchema.facts).map((k) => `auth.${k}`),
  ...Object.keys(authSchema.derivations).map((k) => `auth.${k}`),
  ...Object.keys(permissionsSchema.facts).map((k) => `permissions.${k}`),
  ...Object.keys(permissionsSchema.derivations).map((k) => `permissions.${k}`),
  ...Object.keys(dashboardSchema.facts).map((k) => `dashboard.${k}`),
  ...Object.keys(dashboardSchema.derivations).map((k) => `dashboard.${k}`),
];

// ============================================================================
// Timeline Log
// ============================================================================

interface TimelineEntry {
  timestamp: number;
  module: string;
  event: string;
  detail: string;
}

const timeline: TimelineEntry[] = [];

function addTimelineEntry(module: string, event: string, detail: string): void {
  timeline.push({
    timestamp: Date.now(),
    module,
    event,
    detail,
  });

  // Cap at 50 entries
  if (timeline.length > 50) {
    timeline.shift();
  }

  renderTimeline();
}

// ============================================================================
// DOM References
// ============================================================================

// Chain boxes
const authBox = document.getElementById("ac-auth-box")!;
const authStatusEl = document.getElementById("ac-auth-status")!;
const authDetailEl = document.getElementById("ac-auth-detail")!;

const permsBox = document.getElementById("ac-perms-box")!;
const permsStatusEl = document.getElementById("ac-perms-status")!;
const permsDetailEl = document.getElementById("ac-perms-detail")!;

const dashBox = document.getElementById("ac-dash-box")!;
const dashStatusEl = document.getElementById("ac-dash-status")!;
const dashDetailEl = document.getElementById("ac-dash-detail")!;

// Arrows
const arrow1 = document.getElementById("ac-arrow-1")!;
const arrow2 = document.getElementById("ac-arrow-2")!;

// Controls
const startBtn = document.getElementById("ac-start-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("ac-reset-btn") as HTMLButtonElement;
const authFailSlider = document.getElementById(
  "ac-auth-fail-rate",
) as HTMLInputElement;
const authFailVal = document.getElementById("ac-auth-fail-val")!;
const permsFailSlider = document.getElementById(
  "ac-perms-fail-rate",
) as HTMLInputElement;
const permsFailVal = document.getElementById("ac-perms-fail-val")!;
const dashFailSlider = document.getElementById(
  "ac-dash-fail-rate",
) as HTMLInputElement;
const dashFailVal = document.getElementById("ac-dash-fail-val")!;

// Timeline
const timelineEl = document.getElementById("ac-timeline")!;

// ============================================================================
// Previous state for change detection
// ============================================================================

let prevAuthStatus = "";
let prevPermsLoaded = false;
let prevDashLoaded = false;

// ============================================================================
// Render
// ============================================================================

function getStepStatus(
  module: "auth" | "permissions" | "dashboard",
): "idle" | "running" | "success" | "error" {
  if (module === "auth") {
    const status = system.facts.auth.status;
    if (status === "idle") {
      return "idle";
    }
    if (status === "validating") {
      return "running";
    }
    if (status === "valid") {
      return "success";
    }

    return "error";
  }

  if (module === "permissions") {
    const loaded = system.facts.permissions.loaded;
    const role = system.facts.permissions.role;
    const authValid = system.derive.auth.isValid;

    if (!authValid) {
      return "idle";
    }
    if (loaded && role !== "") {
      return "success";
    }
    if (!loaded && authValid) {
      return "running";
    }

    return "idle";
  }

  // dashboard
  const dashLoaded = system.facts.dashboard.loaded;
  const dashWidgets = system.facts.dashboard.widgets;
  const permsRole = system.facts.permissions.role;

  if (permsRole === "") {
    return "idle";
  }
  if (dashLoaded && dashWidgets.length > 0) {
    return "success";
  }
  if (!dashLoaded && permsRole !== "") {
    return "running";
  }

  return "idle";
}

function renderChainBox(
  box: HTMLElement,
  statusEl: HTMLElement,
  detailEl: HTMLElement,
  status: "idle" | "running" | "success" | "error",
  detail: string,
): void {
  box.className = `ac-chain-box ${status}`;
  statusEl.textContent = status;
  statusEl.className = `ac-chain-badge ${status}`;
  detailEl.textContent = detail;
}

function renderArrow(
  arrowEl: HTMLElement,
  active: boolean,
  done: boolean,
): void {
  arrowEl.className = "ac-arrow";
  if (done) {
    arrowEl.classList.add("done");
  } else if (active) {
    arrowEl.classList.add("active");
  }
}

function render(): void {
  const authFacts = system.facts.auth;
  const permsFacts = system.facts.permissions;
  const dashFacts = system.facts.dashboard;
  const dashDeriv = system.derive.dashboard;

  const authStatus = getStepStatus("auth");
  const permsStatus = getStepStatus("permissions");
  const dashStatus = getStepStatus("dashboard");

  // Auth box
  let authDetail = "";
  if (authStatus === "idle") {
    authDetail = "Waiting for token";
  } else if (authStatus === "running") {
    authDetail = "Validating session...";
  } else if (authStatus === "success") {
    authDetail = `User: ${authFacts.userId}`;
  } else {
    authDetail = "Session expired";
  }
  renderChainBox(authBox, authStatusEl, authDetailEl, authStatus, authDetail);

  // Permissions box
  let permsDetail = "";
  if (permsStatus === "idle") {
    permsDetail = "Waiting for auth";
  } else if (permsStatus === "running") {
    permsDetail = "Loading permissions...";
  } else if (permsStatus === "success") {
    permsDetail = `Role: ${permsFacts.role}`;
  } else {
    permsDetail = "Failed to load";
  }
  renderChainBox(
    permsBox,
    permsStatusEl,
    permsDetailEl,
    permsStatus,
    permsDetail,
  );

  // Dashboard box
  let dashDetail = "";
  if (dashStatus === "idle") {
    dashDetail = "Waiting for permissions";
  } else if (dashStatus === "running") {
    dashDetail = "Loading dashboard...";
  } else if (dashStatus === "success") {
    const count = dashDeriv.widgetCount;
    dashDetail = `${count} widgets loaded`;
  } else {
    dashDetail = "Failed to load";
  }
  renderChainBox(dashBox, dashStatusEl, dashDetailEl, dashStatus, dashDetail);

  // Arrows
  const authDone = authStatus === "success";
  const permsDone = permsStatus === "success";
  renderArrow(
    arrow1,
    authStatus === "running" || permsStatus === "running",
    authDone,
  );
  renderArrow(
    arrow2,
    permsStatus === "running" || dashStatus === "running",
    permsDone,
  );

  // Timeline entries for state transitions
  const currentAuthStatus = authFacts.status;
  if (currentAuthStatus !== prevAuthStatus) {
    if (prevAuthStatus !== "" && currentAuthStatus !== "idle") {
      addTimelineEntry("auth", currentAuthStatus, authDetail);
    }
    prevAuthStatus = currentAuthStatus;
  }

  const currentPermsLoaded = permsFacts.loaded;
  if (currentPermsLoaded !== prevPermsLoaded) {
    if (currentPermsLoaded) {
      addTimelineEntry("permissions", "loaded", `Role: ${permsFacts.role}`);
    } else if (prevPermsLoaded) {
      addTimelineEntry("permissions", "reset", "Permissions cleared");
    }
    prevPermsLoaded = currentPermsLoaded;
  }

  const currentDashLoaded = dashFacts.loaded;
  if (currentDashLoaded !== prevDashLoaded) {
    if (currentDashLoaded) {
      const count = dashDeriv.widgetCount;
      addTimelineEntry("dashboard", "loaded", `${count} widgets`);
    } else if (prevDashLoaded) {
      addTimelineEntry("dashboard", "reset", "Dashboard cleared");
    }
    prevDashLoaded = currentDashLoaded;
  }

  // Slider labels
  authFailVal.textContent = `${authFacts.failRate}%`;
  permsFailVal.textContent = `${permsFacts.failRate}%`;
  dashFailVal.textContent = `${dashFacts.failRate}%`;

  // Buttons
  const token = authFacts.token;
  startBtn.disabled = token !== "" && currentAuthStatus !== "idle";
  resetBtn.disabled =
    currentAuthStatus === "idle" && !currentPermsLoaded && !currentDashLoaded;
}

function renderTimeline(): void {
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="ac-timeline-empty">Events will appear here after starting the chain</div>';

    return;
  }

  timelineEl.innerHTML = "";

  // Newest first
  for (let i = timeline.length - 1; i >= 0; i--) {
    const entry = timeline[i]!;
    const el = document.createElement("div");
    el.className = `ac-timeline-entry ${entry.module}`;

    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    el.innerHTML = `
      <span class="ac-timeline-time">${timeStr}</span>
      <span class="ac-timeline-module">${escapeHtml(entry.module)}</span>
      <span class="ac-timeline-event">${escapeHtml(entry.event)}</span>
      <span class="ac-timeline-detail">${escapeHtml(entry.detail)}</span>
    `;

    timelineEl.appendChild(el);
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

function handleStart(): void {
  // Generate a random token to kick off the chain
  const token = `tok-${Math.random().toString(36).slice(2, 10)}`;
  addTimelineEntry("auth", "start", `Token: ${token}`);
  system.events.auth.setToken({ value: token });
}

startBtn.addEventListener("click", handleStart);

resetBtn.addEventListener("click", () => {
  system.events.auth.reset();
  system.events.permissions.reset();
  system.events.dashboard.reset();
  timeline.length = 0;
  prevAuthStatus = "";
  prevPermsLoaded = false;
  prevDashLoaded = false;
  addTimelineEntry("system", "reset", "All modules reset");
  render();
});

// Fail rate sliders
authFailSlider.addEventListener("input", () => {
  system.events.auth.setFailRate({ value: Number(authFailSlider.value) });
});

permsFailSlider.addEventListener("input", () => {
  system.events.permissions.setFailRate({
    value: Number(permsFailSlider.value),
  });
});

dashFailSlider.addEventListener("input", () => {
  system.events.dashboard.setFailRate({ value: Number(dashFailSlider.value) });
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

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-async-chains-ready", "true");
