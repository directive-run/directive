/**
 * Batch Data Loader — DOM Rendering & System Wiring
 *
 * Imports from module, starts system, renders user list and event timeline.
 */

import { el } from "@directive-run/el";

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
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;
  const users = facts.users as UserProfile[];
  const loadingIds = facts.loadingIds as number[];

  // User list
  if (users.length === 0 && loadingIds.length === 0) {
    userListEl.replaceChildren(
      el("div", { className: "bl-empty" }, "No users loaded. Click a button to start."),
    );
  } else {
    userListEl.replaceChildren(
      // Loading indicators
      ...loadingIds.map((id) =>
        el("div", { className: "bl-user-item loading" },
          el("span", { className: "bl-user-id" }, `#${id}`),
          " Loading...",
        ),
      ),
      // Loaded users
      ...users.map((user) => {
        const row = el("div", { className: "bl-user-item" },
          el("span", { className: "bl-user-id" }, `#${user.id}`),
          el("span", { className: "bl-user-name" }, user.name),
          el("span", { className: "bl-user-role" }, user.role),
        );
        row.setAttribute("data-testid", `bl-user-${user.id}`);

        return row;
      }),
    );
  }

  // User count in header
  inspUserCount.textContent = String(system.read("userCount"));

  // Slider label
  batchWindowVal.textContent = `${facts.batchWindowMs}ms`;

  // Timeline
  if (timeline.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "bl-timeline-empty" }, "Events appear after interactions"),
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

        return el("div", { className: `bl-timeline-entry ${entry.type}` },
          el("span", { className: "bl-timeline-time" }, timeStr),
          el("span", { className: "bl-timeline-event" }, entry.event),
          el("span", { className: "bl-timeline-detail" }, entry.detail),
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
