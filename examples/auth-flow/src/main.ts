/**
 * Auth Flow — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the status bar, login form, config sliders,
 * and event timeline. A 500ms timer drives reactive token countdown.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { authFlowModule, authFlowSchema } from "./auth-flow.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: authFlowModule,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "auth-flow" })],
});
system.start();

const allKeys = [
  ...Object.keys(authFlowSchema.facts),
  ...Object.keys(authFlowSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

// Status bar
const statusBadge = document.getElementById("af-status-badge")!;
const userDisplay = document.getElementById("af-user-display")!;
const countdownFill = document.getElementById("af-countdown-fill")!;
const countdownText = document.getElementById("af-countdown-text")!;

// Login & Actions
const emailInput = document.getElementById("af-email") as HTMLInputElement;
const passwordInput = document.getElementById(
  "af-password",
) as HTMLInputElement;
const loginBtn = document.getElementById("af-login-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("af-logout-btn") as HTMLButtonElement;
const forceExpireBtn = document.getElementById(
  "af-force-expire-btn",
) as HTMLButtonElement;
const loginError = document.getElementById("af-login-error")!;

// Config sliders
const ttlSlider = document.getElementById("af-token-ttl") as HTMLInputElement;
const ttlVal = document.getElementById("af-ttl-val")!;
const bufferSlider = document.getElementById(
  "af-refresh-buffer",
) as HTMLInputElement;
const bufferVal = document.getElementById("af-buffer-val")!;
const loginFailSlider = document.getElementById(
  "af-login-failrate",
) as HTMLInputElement;
const loginFailVal = document.getElementById("af-login-fail-val")!;
const refreshFailSlider = document.getElementById(
  "af-refresh-failrate",
) as HTMLInputElement;
const refreshFailVal = document.getElementById("af-refresh-fail-val")!;

// Timeline
const timelineEl = document.getElementById("af-timeline")!;

// ============================================================================
// Render
// ============================================================================

let lastLoginError = "";

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const status = facts.status;
  const token = facts.token;
  const user = facts.user;
  const tokenTimeRemaining = derive.tokenTimeRemaining;
  const canLogin = derive.canLogin;
  const eventLog = facts.eventLog;

  // --- Status bar ---
  statusBadge.textContent = status;
  statusBadge.className = `af-status-badge ${status}`;

  if (user) {
    userDisplay.textContent = `${user.name} (${user.role})`;
  } else {
    userDisplay.innerHTML = "&mdash;";
  }

  // Countdown
  if (token !== "") {
    const ttl = facts.tokenTTL;
    const pct = Math.min(100, Math.round((tokenTimeRemaining / ttl) * 100));
    countdownFill.style.width = `${pct}%`;
    countdownFill.className = "af-countdown-fill";
    if (pct <= 20) {
      countdownFill.classList.add("danger");
    } else if (pct <= 50) {
      countdownFill.classList.add("warning");
    }
    countdownText.textContent = `${tokenTimeRemaining}s remaining`;
  } else {
    countdownFill.style.width = "0%";
    countdownFill.className = "af-countdown-fill";
    countdownText.innerHTML = "&mdash;";
  }

  // --- Login form state ---
  loginBtn.disabled = !canLogin;
  logoutBtn.disabled = status === "idle" || status === "expired";
  forceExpireBtn.disabled = token === "";

  // Show login error from event log
  const latestError = eventLog
    .slice()
    .reverse()
    .find((e) => e.event === "login-error");
  const errorMsg = latestError ? latestError.detail : "";
  if (errorMsg !== lastLoginError) {
    lastLoginError = errorMsg;
    loginError.textContent = errorMsg;
    loginError.classList.toggle("visible", errorMsg !== "");
  }

  // --- Slider labels ---
  ttlVal.textContent = `${facts.tokenTTL}s`;
  bufferVal.textContent = `${facts.refreshBuffer}s`;
  loginFailVal.textContent = `${facts.loginFailRate}%`;
  refreshFailVal.textContent = `${facts.refreshFailRate}%`;

  // --- Timeline ---
  if (eventLog.length === 0) {
    timelineEl.innerHTML =
      '<div class="af-timeline-empty">Events will appear here after login</div>';
  } else {
    timelineEl.innerHTML = "";
    for (let i = eventLog.length - 1; i >= 0; i--) {
      const entry = eventLog[i];
      const el = document.createElement("div");
      el.className = `af-timeline-entry ${entry.event}`;

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="af-timeline-time">${timeStr}</span>
        <span class="af-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="af-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// Timer — tick every 500ms for reactive countdown
const tickInterval = setInterval(() => {
  system.events.tick();
}, 500);

// ============================================================================
// Controls
// ============================================================================

// Login
function handleLogin(): void {
  loginError.classList.remove("visible");
  lastLoginError = "";
  system.events.requestLogin();
}

loginBtn.addEventListener("click", handleLogin);

emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleLogin();
  }
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleLogin();
  }
});

emailInput.addEventListener("input", () => {
  system.events.setEmail({ value: emailInput.value });
});

passwordInput.addEventListener("input", () => {
  system.events.setPassword({ value: passwordInput.value });
});

// Logout
logoutBtn.addEventListener("click", () => {
  loginError.classList.remove("visible");
  lastLoginError = "";
  system.events.logout();
});

// Force Expire
forceExpireBtn.addEventListener("click", () => {
  system.events.forceExpire();
});

// Quick-login chips
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains("af-chip") && target.dataset.email) {
    emailInput.value = target.dataset.email;
    passwordInput.value = target.dataset.password || "password";
    system.events.setEmail({ value: emailInput.value });
    system.events.setPassword({ value: passwordInput.value });
  }
});

// Sliders
ttlSlider.addEventListener("input", () => {
  system.events.setTokenTTL({ value: Number(ttlSlider.value) });
});

bufferSlider.addEventListener("input", () => {
  system.events.setRefreshBuffer({ value: Number(bufferSlider.value) });
});

loginFailSlider.addEventListener("input", () => {
  system.events.setLoginFailRate({ value: Number(loginFailSlider.value) });
});

refreshFailSlider.addEventListener("input", () => {
  system.events.setRefreshFailRate({ value: Number(refreshFailSlider.value) });
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

// Set initial values from pre-filled inputs
system.events.setEmail({ value: emailInput.value });
system.events.setPassword({ value: passwordInput.value });

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-auth-flow-ready", "true");
