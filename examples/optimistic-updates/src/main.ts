/**
 * Optimistic Updates — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the todo list, status bar, toast notifications,
 * state inspector, config sliders, and event timeline.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  optimisticUpdatesModule,
  optimisticUpdatesSchema,
  type TodoItem,
  type SyncQueueEntry,
  type EventLogEntry,
} from "./optimistic-updates.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: optimisticUpdatesModule,
  plugins: [devtoolsPlugin({ name: "optimistic-updates" })],
});
system.start();

const allKeys = [
  ...Object.keys(optimisticUpdatesSchema.facts),
  ...Object.keys(optimisticUpdatesSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

// Status bar
const pendingBadge = document.getElementById("ou-pending-count")!;
const pendingText = document.getElementById("ou-pending-text")!;

// Add form
const addInput = document.getElementById("ou-add-input") as HTMLInputElement;
const addBtn = document.getElementById("ou-add-btn") as HTMLButtonElement;

// Todo list
const todoList = document.getElementById("ou-todo-list")!;
const todoFooter = document.getElementById("ou-todo-footer")!;

// Toast
const toastEl = document.getElementById("ou-toast")!;
const toastText = document.getElementById("ou-toast-text")!;
const toastDismiss = document.getElementById("ou-toast-dismiss")!;

// Inspector
const derivTotal = document.getElementById("ou-deriv-total")!;
const derivDone = document.getElementById("ou-deriv-done")!;
const derivPending = document.getElementById("ou-deriv-pending")!;
const derivCanAdd = document.getElementById("ou-deriv-can-add")!;
const derivSyncing = document.getElementById("ou-deriv-syncing")!;

// Config sliders
const serverDelaySlider = document.getElementById("ou-server-delay") as HTMLInputElement;
const delayVal = document.getElementById("ou-delay-val")!;
const failRateSlider = document.getElementById("ou-fail-rate") as HTMLInputElement;
const failVal = document.getElementById("ou-fail-val")!;

// Timeline
const timelineEl = document.getElementById("ou-timeline")!;

// ============================================================================
// Render State
// ============================================================================

let prevItems: TodoItem[] = [];
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Render
// ============================================================================

function renderBoolDeriv(el: HTMLElement, value: boolean, pulseClass?: string): void {
  const indicator = value
    ? `<span class="ou-deriv-indicator ${pulseClass || "true"}"></span>`
    : '<span class="ou-deriv-indicator false"></span>';
  el.innerHTML = `${indicator} ${value}`;
}

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const items = facts.items as TodoItem[];
  const syncQueue = facts.syncQueue as SyncQueueEntry[];
  const toastMessage = facts.toastMessage as string;
  const toastType = facts.toastType as string;
  const totalCount = derive.totalCount as number;
  const doneCount = derive.doneCount as number;
  const pendingCount = derive.pendingCount as number;
  const canAdd = derive.canAdd as boolean;
  const isSyncing = derive.isSyncing as boolean;
  const eventLog = facts.eventLog as EventLogEntry[];

  // Build set of pending item IDs
  const pendingItemIds = new Set(syncQueue.map((e) => e.itemId));

  // --- Status bar ---
  if (pendingCount > 0) {
    pendingBadge.classList.add("visible");
    pendingText.textContent = `${pendingCount} syncing`;
  } else {
    pendingBadge.classList.remove("visible");
  }

  // --- Add button ---
  addBtn.disabled = !canAdd;

  // --- Todo list ---
  // Track which items reappeared or reverted for rollback flash
  const prevItemMap = new Map<string, TodoItem>();
  for (const item of prevItems) {
    prevItemMap.set(item.id, item);
  }

  const currentItemIds = new Set(items.map((i) => i.id));
  const rollbackIds = new Set<string>();

  // Check for reappeared items (were deleted, now back)
  for (const item of items) {
    const prev = prevItemMap.get(item.id);
    if (!prev) {
      // Item is new — check if it was in the previous list (reappeared after failed delete)
      // We can't distinguish "new add" from "reappeared" here without more state,
      // but rollback only happens when pending items revert, which we detect via done state
    } else if (prev.done !== item.done && !pendingItemIds.has(item.id)) {
      // done state reverted and item is no longer pending — rollback
      rollbackIds.add(item.id);
    }
  }

  // Check for items that reappeared (were in prev but not current, now back)
  for (const prev of prevItems) {
    if (!currentItemIds.has(prev.id)) {
      // Item was removed — if it comes back in the next render, that's a rollback
      // We'll handle this by checking items that exist now but didn't in the render before last
    }
  }

  // Re-detect: items that exist now but were missing from previous render
  const prevItemIds = new Set(prevItems.map((i) => i.id));
  for (const item of items) {
    if (!prevItemIds.has(item.id) && prevItems.length > 0) {
      // This item was not in previous render — could be rollback of a delete or a new add
      // If it's not pending (no syncQueue entry), it's a rollback reappearance
      if (!pendingItemIds.has(item.id)) {
        rollbackIds.add(item.id);
      }
    }
  }

  todoList.innerHTML = "";
  for (const item of items) {
    const isPending = pendingItemIds.has(item.id);
    const el = document.createElement("div");
    el.className = "ou-todo-item";
    el.setAttribute("data-testid", `ou-item-${item.id}`);

    if (isPending) {
      el.classList.add("pending");
      el.setAttribute("data-pending", "true");
    }
    if (item.done) {
      el.classList.add("done");
    }
    if (rollbackIds.has(item.id)) {
      el.classList.add("ou-item-rollback");
      setTimeout(() => el.classList.remove("ou-item-rollback"), 600);
    }

    el.innerHTML = `
      <input
        type="checkbox"
        class="ou-todo-checkbox"
        data-testid="ou-toggle-${item.id}"
        data-action="toggle"
        data-id="${item.id}"
        ${item.done ? "checked" : ""}
        ${isPending ? "disabled" : ""}
      />
      <span class="ou-todo-text">${escapeHtml(item.text)}</span>
      <button
        class="ou-todo-delete"
        data-testid="ou-delete-${item.id}"
        data-action="delete"
        data-id="${item.id}"
        ${isPending ? "disabled" : ""}
      >\u{1F5D1}</button>
    `;

    todoList.appendChild(el);
  }

  prevItems = items.map((i) => ({ ...i }));

  // --- Footer ---
  todoFooter.textContent = `${totalCount} todo${totalCount !== 1 ? "s" : ""} \u00b7 ${doneCount} done \u00b7 ${pendingCount} pending`;

  // --- Toast ---
  if (toastMessage) {
    toastEl.className = `ou-toast visible ${toastType}`;
    toastText.textContent = toastMessage;

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      system.events.dismissToast();
      toastTimer = null;
    }, 3000);
  } else {
    toastEl.className = "ou-toast";
  }

  // --- Inspector ---
  derivTotal.textContent = `${totalCount}`;
  derivDone.textContent = `${doneCount}`;
  derivPending.textContent = `${pendingCount}`;
  renderBoolDeriv(derivCanAdd, canAdd);
  renderBoolDeriv(derivSyncing, isSyncing, isSyncing ? "syncing" : undefined);

  // --- Slider labels ---
  delayVal.textContent = `${facts.serverDelay}ms`;
  failVal.textContent = `${facts.failRate}%`;

  // --- Timeline ---
  if (eventLog.length === 0) {
    timelineEl.innerHTML = '<div class="ou-timeline-empty">Events will appear here after actions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (let i = eventLog.length - 1; i >= 0; i--) {
      const entry = eventLog[i];
      const el = document.createElement("div");
      el.className = `ou-timeline-entry ${entry.event}`;

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="ou-timeline-time">${timeStr}</span>
        <span class="ou-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="ou-timeline-detail">${escapeHtml(entry.detail)}</span>
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

// Add form
addInput.addEventListener("input", () => {
  system.events.setNewItemText({ value: addInput.value });
});

addInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleAdd();
  }
});

function handleAdd(): void {
  const text = (system.facts.newItemText as string).trim();
  if (!text) {
    return;
  }

  system.events.addItem();
  addInput.value = "";
}

addBtn.addEventListener("click", handleAdd);

// Delegated click handling for todo items
todoList.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const itemId = target.dataset.id;
  if (!itemId) {
    return;
  }

  if (target.dataset.action === "toggle") {
    e.preventDefault();
    system.events.toggleItem({ id: itemId });
  }

  if (target.dataset.action === "delete") {
    system.events.deleteItem({ id: itemId });
  }
});

// Toast dismiss
toastDismiss.addEventListener("click", () => {
  system.events.dismissToast();
});

// Sliders
serverDelaySlider.addEventListener("input", () => {
  system.events.setServerDelay({ value: Number(serverDelaySlider.value) });
});

failRateSlider.addEventListener("input", () => {
  system.events.setFailRate({ value: Number(failRateSlider.value) });
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
document.body.setAttribute("data-optimistic-updates-ready", "true");
