/**
 * Notifications & Toasts — DOM Rendering & System Wiring
 *
 * Creates the Directive system with two modules (notifications + app),
 * subscribes to state changes, and renders the toast stack, control panel,
 * and config panel.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  notificationsModule,
  notificationsSchema,
  appModule,
  appSchema,
  type Notification,
} from "./notifications.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  modules: { notifications: notificationsModule, app: appModule },
  tickMs: 1000,
  plugins: [devtoolsPlugin({ name: "notifications" })],
});
system.start();

const allKeys = [
  ...Object.keys(notificationsSchema.facts).map((k) => `notifications::${k}`),
  ...Object.keys(notificationsSchema.derivations).map((k) => `notifications::${k}`),
  ...Object.keys(appSchema.facts).map((k) => `app::${k}`),
];

// ============================================================================
// DOM References
// ============================================================================

const toastStack = document.getElementById("nt-toast-stack")!;
const maxVisibleSlider = document.getElementById("nt-max-visible") as HTMLInputElement;
const maxVisibleVal = document.getElementById("nt-max-visible-val")!;
const actionLogEl = document.getElementById("nt-action-log")!;

const addInfoBtn = document.getElementById("nt-add-info") as HTMLButtonElement;
const addSuccessBtn = document.getElementById("nt-add-success") as HTMLButtonElement;
const addWarningBtn = document.getElementById("nt-add-warning") as HTMLButtonElement;
const addErrorBtn = document.getElementById("nt-add-error") as HTMLButtonElement;
const burstBtn = document.getElementById("nt-burst") as HTMLButtonElement;

// ============================================================================
// Notification Messages
// ============================================================================

const infoMessages = [
  "New update available",
  "Sync completed",
  "Session refreshed",
  "Data loaded successfully",
  "Connection restored",
];

const successMessages = [
  "Changes saved",
  "File uploaded",
  "Profile updated",
  "Payment processed",
  "Export complete",
];

const warningMessages = [
  "Storage almost full",
  "Session expiring soon",
  "Weak network connection",
  "API rate limit approaching",
  "Deprecated API in use",
];

const errorMessages = [
  "Failed to save changes",
  "Network request failed",
  "Permission denied",
  "Server error (500)",
  "Authentication expired",
];

function randomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

// ============================================================================
// Render
// ============================================================================

/** Set of notification IDs currently rendered, used for enter animations */
let renderedIds = new Set<string>();

function render(): void {
  const facts = system.facts as any;
  const derive = system.derive as any;

  const visible = derive.notifications.visibleNotifications as Notification[];
  const maxVisible = facts.notifications.maxVisible as number;
  const actionLog = facts.app.actionLog as string[];

  // --- Toast stack ---
  const currentIds = new Set(visible.map((n) => n.id));

  // Mark toasts that are leaving
  const existingToasts = toastStack.querySelectorAll<HTMLElement>(".nt-toast");
  for (const el of existingToasts) {
    const id = el.dataset.id;
    if (id && !currentIds.has(id)) {
      el.classList.add("nt-toast-exit");
      el.addEventListener(
        "animationend",
        () => {
          el.remove();
        },
        { once: true },
      );
    }
  }

  // Add or update toasts
  for (const notification of visible) {
    let el = toastStack.querySelector<HTMLElement>(`[data-id="${notification.id}"]`);

    if (!el) {
      el = document.createElement("div");
      el.className = `nt-toast nt-toast-${notification.level}`;
      el.dataset.id = notification.id;

      if (!renderedIds.has(notification.id)) {
        el.classList.add("nt-toast-enter");
      }

      const levelIcon = getLevelIcon(notification.level);

      el.innerHTML = `
        <span class="nt-toast-icon">${levelIcon}</span>
        <span class="nt-toast-message">${escapeHtml(notification.message)}</span>
        <button class="nt-toast-close" data-dismiss="${notification.id}" aria-label="Dismiss">&times;</button>
      `;

      toastStack.appendChild(el);
    }
  }

  renderedIds = currentIds;

  // --- Max visible slider ---
  maxVisibleVal.textContent = `${maxVisible}`;

  // --- Action log ---
  if (actionLog.length === 0) {
    actionLogEl.innerHTML =
      '<div class="nt-log-empty">Actions will appear here</div>';
  } else {
    actionLogEl.innerHTML = "";
    for (let i = actionLog.length - 1; i >= 0; i--) {
      const el = document.createElement("div");
      el.className = "nt-log-entry";
      el.textContent = actionLog[i];

      actionLogEl.appendChild(el);
    }
  }
}

function getLevelIcon(level: Notification["level"]): string {
  switch (level) {
    case "info":
      return "&#8505;";
    case "success":
      return "&#10003;";
    case "warning":
      return "&#9888;";
    case "error":
      return "&#10007;";
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

function addNotification(level: Notification["level"]): void {
  const messageMap: Record<string, string[]> = {
    info: infoMessages,
    success: successMessages,
    warning: warningMessages,
    error: errorMessages,
  };

  const message = randomMessage(messageMap[level]);

  // Log the action in the app module
  system.events.app.simulateAction({ message: `${level}: ${message}`, level });

  // Add the notification in the notifications module
  system.events.notifications.addNotification({ message, level });
}

addInfoBtn.addEventListener("click", () => {
  addNotification("info");
});

addSuccessBtn.addEventListener("click", () => {
  addNotification("success");
});

addWarningBtn.addEventListener("click", () => {
  addNotification("warning");
});

addErrorBtn.addEventListener("click", () => {
  addNotification("error");
});

burstBtn.addEventListener("click", () => {
  const levels: Notification["level"][] = ["info", "success", "warning", "error", "info"];
  for (const level of levels) {
    addNotification(level);
  }
});

// Toast dismiss (delegated)
toastStack.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const dismissId = target.dataset.dismiss;
  if (dismissId) {
    system.events.notifications.dismissNotification({ id: dismissId });
  }
});

// Max visible slider
maxVisibleSlider.addEventListener("input", () => {
  system.events.notifications.setMaxVisible({ value: Number(maxVisibleSlider.value) });
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
document.body.setAttribute("data-notifications-ready", "true");
