/**
 * Batch Data Loader — DOM Rendering & System Wiring
 *
 * Imports from module, starts system, renders user list and event timeline.
 */

import { type UserProfile, schema, system, timeline } from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const userListEl = document.getElementById("bl-user-list")!;
const inspUserCount = document.getElementById("bl-insp-user-count")!;
const batchWindowVal = document.getElementById("bl-batch-window-val")!;
const failItemSelect = document.getElementById(
  "bl-fail-item",
) as HTMLSelectElement;
const timelineEl = document.getElementById("bl-timeline")!;

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

function render(): void {
  const facts = system.facts;
  const users = facts.users as UserProfile[];
  const loadingIds = facts.loadingIds as number[];

  // User list
  if (users.length === 0 && loadingIds.length === 0) {
    userListEl.innerHTML =
      '<div class="bl-empty">No users loaded. Click a button to start.</div>';
  } else {
    userListEl.innerHTML = "";

    // Loading indicators
    for (const id of loadingIds) {
      const el = document.createElement("div");
      el.className = "bl-user-item loading";
      el.innerHTML = `<span class="bl-user-id">#${id}</span> Loading...`;
      userListEl.appendChild(el);
    }

    // Loaded users
    for (const user of users) {
      const el = document.createElement("div");
      el.className = "bl-user-item";
      el.setAttribute("data-testid", `bl-user-${user.id}`);
      el.innerHTML = `
        <span class="bl-user-id">#${user.id}</span>
        <span class="bl-user-name">${escapeHtml(user.name)}</span>
        <span class="bl-user-role">${escapeHtml(user.role)}</span>
      `;
      userListEl.appendChild(el);
    }
  }

  // User count in header
  inspUserCount.textContent = String(system.read("userCount"));

  // Slider label
  batchWindowVal.textContent = `${facts.batchWindowMs}ms`;

  // Timeline
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="bl-timeline-empty">Events appear after interactions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `bl-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="bl-timeline-time">${timeStr}</span>
        <span class="bl-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="bl-timeline-detail">${escapeHtml(entry.detail)}</span>
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

// ============================================================================
// Controls
// ============================================================================

// Individual load buttons (1-5)
for (let i = 1; i <= 5; i++) {
  document.getElementById(`bl-load-${i}`)!.addEventListener("click", () => {
    system.events.loadUser({ id: i });
  });
}

document.getElementById("bl-load-all-5")!.addEventListener("click", () => {
  system.events.loadRange({ start: 1, count: 5 });
});

document.getElementById("bl-load-20")!.addEventListener("click", () => {
  system.events.loadRange({ start: 1, count: 20 });
});

document.getElementById("bl-inject-schema")!.addEventListener("click", () => {
  system.events.injectSchemaError();
});

document.getElementById("bl-clear")!.addEventListener("click", () => {
  system.events.clearUsers();
});

document.getElementById("bl-reset")!.addEventListener("click", () => {
  system.events.resetAll();
});

failItemSelect.addEventListener("change", () => {
  system.events.setFailItemId({ value: Number(failItemSelect.value) });
});

// ============================================================================
// Initial Render
// ============================================================================

render();
document.body.setAttribute("data-batch-resolver-ready", "true");
