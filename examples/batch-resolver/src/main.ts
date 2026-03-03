/**
 * Batch Data Loader — Batched Resolution & Schema Validation
 *
 * User directory that loads profiles. Multiple constraints fire simultaneously;
 * the batch resolver groups them into one call. Dev-mode schema validation
 * catches type mismatches.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "info" | "batch" | "error" | "success" | "validation";
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_USERS: Record<number, UserProfile> = {
  1: { id: 1, name: "Alice Chen", email: "alice@acme.com", role: "Admin" },
  2: { id: 2, name: "Bob Smith", email: "bob@acme.com", role: "Editor" },
  3: { id: 3, name: "Carol Davis", email: "carol@acme.com", role: "Viewer" },
  4: { id: 4, name: "Dave Wilson", email: "dave@acme.com", role: "Editor" },
  5: { id: 5, name: "Eve Brown", email: "eve@acme.com", role: "Admin" },
  6: { id: 6, name: "Frank Lee", email: "frank@acme.com", role: "Viewer" },
  7: { id: 7, name: "Grace Kim", email: "grace@acme.com", role: "Editor" },
  8: { id: 8, name: "Hank Moore", email: "hank@acme.com", role: "Viewer" },
  9: { id: 9, name: "Iris Park", email: "iris@acme.com", role: "Admin" },
  10: { id: 10, name: "Jack Turner", email: "jack@acme.com", role: "Editor" },
  11: { id: 11, name: "Kate Adams", email: "kate@acme.com", role: "Viewer" },
  12: { id: 12, name: "Leo Garcia", email: "leo@acme.com", role: "Editor" },
  13: { id: 13, name: "Mia Jones", email: "mia@acme.com", role: "Admin" },
  14: { id: 14, name: "Nick White", email: "nick@acme.com", role: "Viewer" },
  15: { id: 15, name: "Olivia Hall", email: "olivia@acme.com", role: "Editor" },
  16: { id: 16, name: "Pete Clark", email: "pete@acme.com", role: "Viewer" },
  17: { id: 17, name: "Quinn Ross", email: "quinn@acme.com", role: "Admin" },
  18: { id: 18, name: "Rosa Martin", email: "rosa@acme.com", role: "Editor" },
  19: { id: 19, name: "Steve Young", email: "steve@acme.com", role: "Viewer" },
  20: { id: 20, name: "Tina Allen", email: "tina@acme.com", role: "Admin" },
};

// ============================================================================
// Timeline
// ============================================================================

const timeline: TimelineEntry[] = [];

function addTimeline(
  event: string,
  detail: string,
  type: TimelineEntry["type"],
) {
  timeline.unshift({ time: Date.now(), event, detail, type });
  if (timeline.length > 50) {
    timeline.length = 50;
  }
}

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    users: t.object<UserProfile[]>(),
    loadingIds: t.object<number[]>(),
    batchCount: t.number(),
    totalRequests: t.number(),
    batchWindowMs: t.number(),
    failItemId: t.number(),
    validationErrors: t.object<string[]>(),
  },
  derivations: {
    userCount: t.number(),
    loadingCount: t.number(),
    batchEfficiency: t.string(),
    hasValidationErrors: t.boolean(),
  },
  events: {
    loadUser: { id: t.number() },
    loadRange: { start: t.number(), count: t.number() },
    setBatchWindow: { value: t.number() },
    setFailItemId: { value: t.number() },
    injectSchemaError: {},
    clearUsers: {},
    resetAll: {},
  },
  requirements: {
    LOAD_USER: { userId: t.number() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const batchModule = createModule("batch-loader", {
  schema,

  init: (facts) => {
    facts.users = [];
    facts.loadingIds = [];
    facts.batchCount = 0;
    facts.totalRequests = 0;
    facts.batchWindowMs = 50;
    facts.failItemId = 0;
    facts.validationErrors = [];
  },

  derive: {
    userCount: (facts) => facts.users.length,
    loadingCount: (facts) => facts.loadingIds.length,
    batchEfficiency: (facts) => {
      if (facts.totalRequests === 0) {
        return "N/A";
      }

      return `${facts.batchCount} batches / ${facts.totalRequests} requests`;
    },
    hasValidationErrors: (facts) => facts.validationErrors.length > 0,
  },

  events: {
    loadUser: (facts, { id }) => {
      if (
        !facts.loadingIds.includes(id) &&
        !facts.users.find((u: UserProfile) => u.id === id)
      ) {
        facts.loadingIds = [...facts.loadingIds, id];
        facts.totalRequests = facts.totalRequests + 1;
      }
    },
    loadRange: (facts, { start, count }) => {
      const newIds: number[] = [];
      for (let i = start; i < start + count; i++) {
        if (
          !facts.loadingIds.includes(i) &&
          !facts.users.find((u: UserProfile) => u.id === i)
        ) {
          newIds.push(i);
        }
      }
      if (newIds.length > 0) {
        facts.loadingIds = [...facts.loadingIds, ...newIds];
        facts.totalRequests = facts.totalRequests + newIds.length;
      }
    },
    setBatchWindow: (facts, { value }) => {
      facts.batchWindowMs = value;
    },
    setFailItemId: (facts, { value }) => {
      facts.failItemId = value;
    },
    injectSchemaError: (facts) => {
      // Intentionally write a bad type to trigger validation
      (facts as Record<string, unknown>).users = "not-an-array";
      facts.validationErrors = [
        ...facts.validationErrors,
        "schema: expected array for 'users', got string",
      ];
      addTimeline(
        "validation",
        "schema error: expected array for 'users'",
        "validation",
      );
      // Fix it immediately so the system keeps working
      facts.users = [];
    },
    clearUsers: (facts) => {
      facts.users = [];
    },
    resetAll: (facts) => {
      facts.users = [];
      facts.loadingIds = [];
      facts.batchCount = 0;
      facts.totalRequests = 0;
      facts.failItemId = 0;
      facts.validationErrors = [];
      timeline.length = 0;
    },
  },

  constraints: {
    needsLoad: {
      priority: 50,
      when: (facts) => facts.loadingIds.length > 0,
      require: (facts) => {
        // Emit one requirement per loading ID — the batch resolver groups them
        const id = facts.loadingIds[0];

        return { type: "LOAD_USER", userId: id };
      },
    },
  },

  resolvers: {
    loadUser: {
      requirement: "LOAD_USER",
      batch: {
        enabled: true,
        windowMs: 50,
      },
      resolveBatchWithResults: async (requirements, context) => {
        const ids = requirements.map((r) => r.userId);
        addTimeline(
          "batch",
          `batch formed: ${ids.length} items [${ids.join(", ")}]`,
          "batch",
        );
        context.facts.batchCount = context.facts.batchCount + 1;

        // Simulate API delay
        await new Promise((resolve) =>
          setTimeout(resolve, 150 + Math.random() * 100),
        );

        const failId = context.facts.failItemId;
        const results = ids.map((id) => {
          if (id === failId) {
            addTimeline("error", `user ${id}: simulated failure`, "error");

            return {
              success: false as const,
              error: new Error(`Failed to load user ${id}`),
            };
          }

          const user = MOCK_USERS[id];
          if (!user) {
            addTimeline("error", `user ${id}: not found`, "error");

            return {
              success: false as const,
              error: new Error(`User ${id} not found`),
            };
          }

          return { success: true as const };
        });

        // Add successful users to facts
        const successUsers = ids
          .filter((id) => id !== failId && MOCK_USERS[id])
          .map((id) => MOCK_USERS[id]!);

        if (successUsers.length > 0) {
          const existing = context.facts.users as UserProfile[];
          context.facts.users = [...existing, ...successUsers];
        }

        // Remove all processed IDs from loading
        const loadingIds = context.facts.loadingIds as number[];
        context.facts.loadingIds = loadingIds.filter(
          (lid: number) => !ids.includes(lid),
        );

        const successCount = results.filter((r) => r.success).length;
        addTimeline(
          "success",
          `batch resolved: ${successCount}/${ids.length} success`,
          "success",
        );

        return results;
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: batchModule,
  plugins: [devtoolsPlugin({ name: "batch-resolver" })],
});
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

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

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
