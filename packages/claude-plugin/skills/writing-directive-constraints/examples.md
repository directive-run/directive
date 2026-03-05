# Examples

> Auto-generated from extracted examples. Do not edit manually.

## auth-flow

```typescript
// Example: auth-flow
// Source: examples/auth-flow/src/auth-flow.ts
// Pure module file — no DOM wiring

/**
 * Auth Flow — Directive Module
 *
 * Demonstrates constraint `after` ordering, auto-tracked derivations
 * driving constraints, resolvers with retry, effects for cleanup,
 * and time-based reactivity (token expiry countdown).
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type User,
  mockFetchUser,
  mockLogin,
  mockRefresh,
} from "./mock-auth.js";

// ============================================================================
// Types
// ============================================================================

export type AuthStatus =
  | "idle"
  | "authenticating"
  | "authenticated"
  | "refreshing"
  | "expired";

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Schema
// ============================================================================

export const authFlowSchema = {
  facts: {
    email: t.string(),
    password: t.string(),
    token: t.string(),
    refreshToken: t.string(),
    expiresAt: t.number(),
    user: t.object<User | null>(),
    status: t.string<AuthStatus>(),
    loginRequested: t.boolean(),
    now: t.number(),
    tokenTTL: t.number(),
    refreshBuffer: t.number(),
    loginFailRate: t.number(),
    refreshFailRate: t.number(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
    isExpiringSoon: t.boolean(),
    canRefresh: t.boolean(),
    tokenTimeRemaining: t.number(),
    canLogin: t.boolean(),
  },
  events: {
    setEmail: { value: t.string() },
    setPassword: { value: t.string() },
    requestLogin: {},
    logout: {},
    forceExpire: {},
    setTokenTTL: { value: t.number() },
    setRefreshBuffer: { value: t.number() },
    setLoginFailRate: { value: t.number() },
    setRefreshFailRate: { value: t.number() },
    tick: {},
  },
  requirements: {
    LOGIN: { email: t.string(), password: t.string() },
    REFRESH_TOKEN: { refreshToken: t.string() },
    FETCH_USER: { token: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, detail });
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const authFlowModule = createModule("auth-flow", {
  schema: authFlowSchema,

  init: (facts) => {
    facts.email = "alice@test.com";
    facts.password = "password";
    facts.token = "";
    facts.refreshToken = "";
    facts.expiresAt = 0;
    facts.user = null;
    facts.status = "idle";
    facts.loginRequested = false;
    facts.now = Date.now();
    facts.tokenTTL = 30;
    facts.refreshBuffer = 5;
    facts.loginFailRate = 0;
    facts.refreshFailRate = 0;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    isAuthenticated: (facts) => facts.status === "authenticated",

    isExpiringSoon: (facts) => {
      if (facts.token === "") {
        return false;
      }

      return facts.now > facts.expiresAt - facts.refreshBuffer * 1000;
    },

    canRefresh: (facts) => {
      return facts.refreshToken !== "" && facts.status !== "refreshing";
    },

    tokenTimeRemaining: (facts) => {
      if (facts.token === "") {
        return 0;
      }

      return Math.max(0, Math.round((facts.expiresAt - facts.now) / 1000));
    },

    canLogin: (facts) => {
      return (
        facts.email.trim() !== "" &&
        facts.password.trim() !== "" &&
        (facts.status === "idle" || facts.status === "expired")
      );
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setEmail: (facts, { value }) => {
      facts.email = value;
    },

    setPassword: (facts, { value }) => {
      facts.password = value;
    },

    requestLogin: (facts) => {
      facts.loginRequested = true;
      facts.status = "authenticating";
      facts.token = "";
      facts.refreshToken = "";
      facts.expiresAt = 0;
      facts.user = null;
      facts.eventLog = [];
    },

    logout: (facts) => {
      facts.token = "";
      facts.refreshToken = "";
      facts.expiresAt = 0;
      facts.user = null;
      facts.status = "idle";
      facts.loginRequested = false;
    },

    forceExpire: (facts) => {
      facts.expiresAt = 0;
    },

    setTokenTTL: (facts, { value }) => {
      facts.tokenTTL = value;
    },

    setRefreshBuffer: (facts, { value }) => {
      facts.refreshBuffer = value;
    },

    setLoginFailRate: (facts, { value }) => {
      facts.loginFailRate = value;
    },

    setRefreshFailRate: (facts, { value }) => {
      facts.refreshFailRate = value;
    },

    tick: (facts) => {
      facts.now = Date.now();
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsLogin: {
      priority: 100,
      when: (facts) => {
        return facts.loginRequested && facts.status === "authenticating";
      },
      require: (facts) => ({
        type: "LOGIN",
        email: facts.email,
        password: facts.password,
      }),
    },

    refreshNeeded: {
      priority: 90,
      when: (facts) => {
        const isExpiringSoon =
          facts.token !== "" &&
          facts.now > facts.expiresAt - facts.refreshBuffer * 1000;
        const canRefresh =
          facts.refreshToken !== "" && facts.status !== "refreshing";

        return isExpiringSoon && canRefresh && facts.status === "authenticated";
      },
      require: (facts) => ({
        type: "REFRESH_TOKEN",
        refreshToken: facts.refreshToken,
      }),
    },

    needsUser: {
      priority: 80,
      after: ["refreshNeeded"],
      when: (facts) => {
        return (
          facts.token !== "" &&
          facts.user === null &&
          facts.status !== "authenticating"
        );
      },
      require: (facts) => ({
        type: "FETCH_USER",
        token: facts.token,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    login: {
      requirement: "LOGIN",
      timeout: 10000,
      resolve: async (req, context) => {
        addLogEntry(context.facts, "login", "Authenticating...");

        try {
          const tokens = await mockLogin(
            req.email,
            req.password,
            context.facts.loginFailRate,
            context.facts.tokenTTL,
          );
          context.facts.token = tokens.token;
          context.facts.refreshToken = tokens.refreshToken;
          context.facts.expiresAt = Date.now() + tokens.expiresIn * 1000;
          context.facts.status = "authenticated";
          context.facts.user = null; // trigger needsUser constraint
          addLogEntry(
            context.facts,
            "login-success",
            `Token: ${tokens.token.slice(0, 12)}...`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.status = "idle";
          context.facts.loginRequested = false;
          addLogEntry(context.facts, "login-error", msg);
          throw err;
        }
      },
    },

    refreshToken: {
      requirement: "REFRESH_TOKEN",
      retry: { attempts: 2, backoff: "exponential" },
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.status = "refreshing";
        addLogEntry(context.facts, "refresh", "Refreshing token...");

        try {
          const tokens = await mockRefresh(
            req.refreshToken,
            context.facts.refreshFailRate,
            context.facts.tokenTTL,
          );
          context.facts.token = tokens.token;
          context.facts.refreshToken = tokens.refreshToken;
          context.facts.expiresAt = Date.now() + tokens.expiresIn * 1000;
          context.facts.status = "authenticated";
          addLogEntry(
            context.facts,
            "refresh-success",
            `New token: ${tokens.token.slice(0, 12)}...`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.token = "";
          context.facts.refreshToken = "";
          context.facts.expiresAt = 0;
          context.facts.status = "expired";
          addLogEntry(context.facts, "refresh-error", msg);
          throw err;
        }
      },
    },

    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        addLogEntry(context.facts, "fetch-user", "Fetching user profile...");

        try {
          const user = await mockFetchUser(req.token);
          context.facts.user = user;
          addLogEntry(
            context.facts,
            "fetch-user-success",
            `${user.name} (${user.role})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          addLogEntry(context.facts, "fetch-user-error", msg);
        }
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logStatusChange: {
      deps: ["status"],
      run: (facts, prev) => {
        if (prev && prev.status !== facts.status) {
          addLogEntry(facts, "status", `${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});
```

## async-chains

```typescript
// Example: async-chains
// Source: examples/async-chains/src/async-chains.ts
// Pure module file — no DOM wiring

/**
 * Async Chains — Three Directive Modules
 *
 * Demonstrates cross-module constraint chaining with `after` ordering:
 *   Auth → Permissions → Dashboard
 *
 * Each step only fires after the previous step's resolver completes.
 * Cross-module derivations drive the `when()` conditions.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type DashboardWidget,
  fetchDashboard,
  fetchPermissions,
  validateSession,
} from "./mock-api.js";

// ============================================================================
// Auth Module
// ============================================================================

export const authSchema = {
  facts: {
    token: t.string(),
    status: t.string<"idle" | "validating" | "valid" | "expired">(),
    userId: t.string(),
    failRate: t.number(),
  },
  derivations: {
    isValid: t.boolean(),
  },
  events: {
    setToken: { value: t.string() },
    setFailRate: { value: t.number() },
    reset: {},
  },
  requirements: {
    VALIDATE_SESSION: { token: t.string() },
  },
} satisfies ModuleSchema;

export const authModule = createModule("auth", {
  schema: authSchema,

  init: (facts) => {
    facts.token = "";
    facts.status = "idle";
    facts.userId = "";
    facts.failRate = 0;
  },

  derive: {
    isValid: (facts) => facts.status === "valid",
  },

  events: {
    setToken: (facts, { value }) => {
      facts.token = value;
      facts.status = "idle";
      facts.userId = "";
    },
    setFailRate: (facts, { value }) => {
      facts.failRate = value;
    },
    reset: (facts) => {
      facts.token = "";
      facts.status = "idle";
      facts.userId = "";
    },
  },

  constraints: {
    validateSession: {
      when: (facts) => facts.token !== "" && facts.status === "idle",
      require: (facts) => ({
        type: "VALIDATE_SESSION",
        token: facts.token,
      }),
    },
  },

  resolvers: {
    validateSession: {
      requirement: "VALIDATE_SESSION",
      key: (req) => `validate-${req.token}`,
      retry: {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 300,
      },
      resolve: async (req, context) => {
        context.facts.status = "validating";

        try {
          const result = await validateSession(
            req.token,
            context.facts.failRate,
          );
          if (result.valid) {
            context.facts.status = "valid";
            context.facts.userId = result.userId;
          } else {
            context.facts.status = "expired";
          }
        } catch {
          context.facts.status = "expired";
        }
      },
    },
  },
});

// ============================================================================
// Permissions Module
// ============================================================================

export const permissionsSchema = {
  facts: {
    role: t.string(),
    permissions: t.array<string>(),
    loaded: t.boolean(),
    failRate: t.number(),
  },
  derivations: {
    canEdit: t.boolean(),
    canPublish: t.boolean(),
    canManageUsers: t.boolean(),
  },
  events: {
    setFailRate: { value: t.number() },
    reset: {},
  },
  requirements: {
    LOAD_PERMISSIONS: {},
  },
} satisfies ModuleSchema;

export const permissionsModule = createModule("permissions", {
  schema: permissionsSchema,

  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.role = "";
    facts.permissions = [];
    facts.loaded = false;
    facts.failRate = 0;
  },

  derive: {
    canEdit: (facts) => facts.self.permissions.includes("write"),
    canPublish: (facts) =>
      facts.self.permissions.includes("write") && facts.self.role !== "viewer",
    canManageUsers: (facts) => facts.self.permissions.includes("manage-users"),
  },

  events: {
    setFailRate: (facts, { value }) => {
      facts.failRate = value;
    },
    reset: (facts) => {
      facts.role = "";
      facts.permissions = [];
      facts.loaded = false;
    },
  },

  constraints: {
    loadPermissions: {
      after: ["auth::validateSession"],
      when: (facts) => {
        // Use the fact directly — derivation values aren't available in the
        // facts proxy passed to constraints (they live in the derive layer).
        return facts.auth.status === "valid" && !facts.self.loaded;
      },
      require: { type: "LOAD_PERMISSIONS" },
    },
  },

  resolvers: {
    loadPermissions: {
      requirement: "LOAD_PERMISSIONS",
      retry: {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 200,
      },
      resolve: async (_req, context) => {
        try {
          const result = await fetchPermissions(context.facts.failRate);
          context.facts.role = result.role;
          context.facts.permissions = result.permissions;
          context.facts.loaded = true;
        } catch {
          context.facts.loaded = false;
        }
      },
    },
  },
});

// ============================================================================
// Dashboard Module
// ============================================================================

export const dashboardSchema = {
  facts: {
    widgets: t.array<DashboardWidget>(),
    loaded: t.boolean(),
    failRate: t.number(),
  },
  derivations: {
    widgetCount: t.number(),
  },
  events: {
    setFailRate: { value: t.number() },
    reset: {},
  },
  requirements: {
    LOAD_DASHBOARD: { role: t.string() },
  },
} satisfies ModuleSchema;

export const dashboardModule = createModule("dashboard", {
  schema: dashboardSchema,

  crossModuleDeps: { permissions: permissionsSchema },

  init: (facts) => {
    facts.widgets = [];
    facts.loaded = false;
    facts.failRate = 0;
  },

  derive: {
    widgetCount: (facts) => facts.self.widgets.length,
  },

  events: {
    setFailRate: (facts, { value }) => {
      facts.failRate = value;
    },
    reset: (facts) => {
      facts.widgets = [];
      facts.loaded = false;
    },
  },

  constraints: {
    loadDashboard: {
      after: ["permissions::loadPermissions"],
      when: (facts) => {
        return facts.permissions.role !== "" && !facts.self.loaded;
      },
      require: (facts) => ({
        type: "LOAD_DASHBOARD",
        role: facts.permissions.role,
      }),
    },
  },

  resolvers: {
    loadDashboard: {
      requirement: "LOAD_DASHBOARD",
      key: (req) => `dashboard-${req.role}`,
      retry: {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 300,
      },
      resolve: async (req, context) => {
        try {
          const result = await fetchDashboard(req.role, context.facts.failRate);
          context.facts.widgets = result.widgets;
          context.facts.loaded = true;
        } catch {
          context.facts.loaded = false;
        }
      },
    },
  },
});
```

## debounce-constraints

```typescript
// Example: debounce-constraints
// Source: examples/debounce-constraints/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Debounce Constraints — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the search input, debounce progress bar, results list,
 * stats, config sliders, and event timeline.
 * A 100ms timer drives reactive debounce countdown.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  debounceSearchModule,
  debounceSearchSchema,
} from "./debounce-search.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: debounceSearchModule,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "debounce-constraints" })],
});
system.start();

const allKeys = [
  ...Object.keys(debounceSearchSchema.facts),
  ...Object.keys(debounceSearchSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

// Status bar

// Search form
  "dc-search-input",

// Progress bar

// Query display

// Results

// Stats

// Config sliders
  "dc-debounce-delay",
  "dc-api-delay",
  "dc-min-chars",

// Timeline

// ============================================================================
// Render
// ============================================================================


// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// Timer — tick every 100ms for smooth debounce progress bar
const tickInterval = setInterval(() => {
  system.events.tick();
}, 100);

// ============================================================================
// Controls
// ============================================================================

// Search input — fire on every keystroke

// Clear

// Sliders


// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
```

## batch-resolver

```typescript
// Example: batch-resolver
// Source: examples/batch-resolver/src/module.ts
// Pure module file — no DOM wiring

/**
 * Batch Data Loader — Directive Module
 *
 * Types, schema, mock data, module definition, timeline, and system creation
 * for a batched user profile loader with schema validation.
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

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface TimelineEntry {
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

export const timeline: TimelineEntry[] = [];

export function addTimeline(
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

export const schema = {
  facts: {
    users: t.array<UserProfile>(),
    loadingIds: t.array<number>(),
    batchCount: t.number(),
    totalRequests: t.number(),
    batchWindowMs: t.number(),
    failItemId: t.number(),
    validationErrors: t.array<string>(),
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

export const system = createSystem({
  module: batchModule,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "batch-resolver" })],
});
```

## error-boundaries

```typescript
// Example: error-boundaries
// Source: examples/error-boundaries/src/module.ts
// Pure module file — no DOM wiring

/**
 * Resilient API Dashboard — Module Definition
 *
 * 3 simulated API services with configurable failure rates. Users inject errors
 * and watch recovery strategies, circuit breaker state transitions, retry-later
 * backoff, and performance metrics.
 */

import {
  type ModuleSchema,
  type RecoveryStrategy,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import {
  type CircuitState,
  createCircuitBreaker,
  devtoolsPlugin,
  performancePlugin,
} from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export interface ServiceState {
  name: string;
  status: "idle" | "loading" | "success" | "error";
  lastResult: string;
  errorCount: number;
  successCount: number;
  lastError: string;
}

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "info" | "error" | "retry" | "circuit" | "recovery" | "success";
}

// ============================================================================
// Timeline
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimeline(
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
// Circuit Breakers (one per service)
// ============================================================================

export const circuitBreakers = {
  users: createCircuitBreaker({
    name: "users-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
      addTimeline("circuit", `users: ${from} → ${to}`, "circuit");
    },
  }),
  orders: createCircuitBreaker({
    name: "orders-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
      addTimeline("circuit", `orders: ${from} → ${to}`, "circuit");
    },
  }),
  analytics: createCircuitBreaker({
    name: "analytics-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
      addTimeline("circuit", `analytics: ${from} → ${to}`, "circuit");
    },
  }),
};

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    usersService: t.object<ServiceState>(),
    ordersService: t.object<ServiceState>(),
    analyticsService: t.object<ServiceState>(),
    strategy: t.string<RecoveryStrategy>(),
    usersFailRate: t.number(),
    ordersFailRate: t.number(),
    analyticsFailRate: t.number(),
    retryQueueCount: t.number(),
    totalErrors: t.number(),
    totalRecoveries: t.number(),
  },
  derivations: {
    usersCircuitState: t.string<CircuitState>(),
    ordersCircuitState: t.string<CircuitState>(),
    analyticsCircuitState: t.string<CircuitState>(),
    errorRate: t.number(),
    allServicesHealthy: t.boolean(),
  },
  events: {
    fetchUsers: {},
    fetchOrders: {},
    fetchAnalytics: {},
    fetchAll: {},
    setStrategy: { value: t.string<RecoveryStrategy>() },
    setUsersFailRate: { value: t.number() },
    setOrdersFailRate: { value: t.number() },
    setAnalyticsFailRate: { value: t.number() },
    resetAll: {},
  },
  requirements: {
    FETCH_SERVICE: { service: t.string(), failRate: t.number() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const dashboardModule = createModule("dashboard", {
  schema,

  init: (facts) => {
    const defaultService: ServiceState = {
      name: "",
      status: "idle",
      lastResult: "",
      errorCount: 0,
      successCount: 0,
      lastError: "",
    };
    facts.usersService = { ...defaultService, name: "Users API" };
    facts.ordersService = { ...defaultService, name: "Orders API" };
    facts.analyticsService = { ...defaultService, name: "Analytics API" };
    facts.strategy = "retry-later";
    facts.usersFailRate = 0;
    facts.ordersFailRate = 0;
    facts.analyticsFailRate = 0;
    facts.retryQueueCount = 0;
    facts.totalErrors = 0;
    facts.totalRecoveries = 0;
  },

  derive: {
    usersCircuitState: () => circuitBreakers.users.getState(),
    ordersCircuitState: () => circuitBreakers.orders.getState(),
    analyticsCircuitState: () => circuitBreakers.analytics.getState(),
    errorRate: (facts) => {
      const total =
        facts.usersService.errorCount +
        facts.usersService.successCount +
        facts.ordersService.errorCount +
        facts.ordersService.successCount +
        facts.analyticsService.errorCount +
        facts.analyticsService.successCount;

      if (total === 0) {
        return 0;
      }

      const errors =
        facts.usersService.errorCount +
        facts.ordersService.errorCount +
        facts.analyticsService.errorCount;

      return Math.round((errors / total) * 100);
    },
    allServicesHealthy: (facts) =>
      facts.usersService.status !== "error" &&
      facts.ordersService.status !== "error" &&
      facts.analyticsService.status !== "error",
  },

  events: {
    fetchUsers: (facts) => {
      facts.usersService = { ...facts.usersService, status: "loading" };
    },
    fetchOrders: (facts) => {
      facts.ordersService = { ...facts.ordersService, status: "loading" };
    },
    fetchAnalytics: (facts) => {
      facts.analyticsService = { ...facts.analyticsService, status: "loading" };
    },
    fetchAll: (facts) => {
      facts.usersService = { ...facts.usersService, status: "loading" };
      facts.ordersService = { ...facts.ordersService, status: "loading" };
      facts.analyticsService = { ...facts.analyticsService, status: "loading" };
    },
    setStrategy: (facts, { value }) => {
      facts.strategy = value;
    },
    setUsersFailRate: (facts, { value }) => {
      facts.usersFailRate = value;
    },
    setOrdersFailRate: (facts, { value }) => {
      facts.ordersFailRate = value;
    },
    setAnalyticsFailRate: (facts, { value }) => {
      facts.analyticsFailRate = value;
    },
    resetAll: (facts) => {
      const defaultService: ServiceState = {
        name: "",
        status: "idle",
        lastResult: "",
        errorCount: 0,
        successCount: 0,
        lastError: "",
      };
      facts.usersService = { ...defaultService, name: "Users API" };
      facts.ordersService = { ...defaultService, name: "Orders API" };
      facts.analyticsService = { ...defaultService, name: "Analytics API" };
      facts.retryQueueCount = 0;
      facts.totalErrors = 0;
      facts.totalRecoveries = 0;
      circuitBreakers.users.reset();
      circuitBreakers.orders.reset();
      circuitBreakers.analytics.reset();
      timeline.length = 0;
    },
  },

  constraints: {
    usersNeedsLoad: {
      priority: 50,
      when: (facts) => facts.usersService.status === "loading",
      require: (facts) => ({
        type: "FETCH_SERVICE",
        service: "users",
        failRate: facts.usersFailRate,
      }),
    },
    ordersNeedsLoad: {
      priority: 50,
      when: (facts) => facts.ordersService.status === "loading",
      require: (facts) => ({
        type: "FETCH_SERVICE",
        service: "orders",
        failRate: facts.ordersFailRate,
      }),
    },
    analyticsNeedsLoad: {
      priority: 50,
      when: (facts) => facts.analyticsService.status === "loading",
      require: (facts) => ({
        type: "FETCH_SERVICE",
        service: "analytics",
        failRate: facts.analyticsFailRate,
      }),
    },
  },

  resolvers: {
    fetchService: {
      requirement: "FETCH_SERVICE",
      retry: { attempts: 2, backoff: "exponential", initialDelay: 200 },
      resolve: async (req, context) => {
        const { service, failRate } = req;
        const breaker =
          circuitBreakers[service as keyof typeof circuitBreakers];
        const serviceKey = `${service}Service` as
          | "usersService"
          | "ordersService"
          | "analyticsService";

        try {
          await breaker.execute(async () => {
            // Simulate API call
            await new Promise((resolve) =>
              setTimeout(resolve, 200 + Math.random() * 300),
            );

            if (Math.random() * 100 < failRate) {
              throw new Error(`${service} API: simulated failure`);
            }
          });

          // Success
          const current = context.facts[serviceKey];
          context.facts[serviceKey] = {
            ...current,
            status: "success",
            lastResult: `Loaded at ${new Date().toLocaleTimeString()}`,
            successCount: current.successCount + 1,
          };
          addTimeline("success", `${service} fetched`, "success");
        } catch (error) {
          const current = context.facts[serviceKey];
          const msg = error instanceof Error ? error.message : String(error);
          context.facts[serviceKey] = {
            ...current,
            status: "error",
            lastError: msg,
            errorCount: current.errorCount + 1,
          };
          context.facts.totalErrors = context.facts.totalErrors + 1;
          addTimeline("error", `${service}: ${msg.slice(0, 60)}`, "error");

          // Re-throw so the error boundary handles recovery
          throw error;
        }
      },
    },
  },
});

// ============================================================================
// Performance Plugin
// ============================================================================

export const perf = performancePlugin({
  onSlowResolver: (id, ms) => {
    addTimeline("perf", `slow resolver: ${id} (${Math.round(ms)}ms)`, "info");
  },
});

// ============================================================================
// System
// ============================================================================

let currentStrategy: RecoveryStrategy = "retry-later";

export const system = createSystem({
  module: dashboardModule,
  debug: { runHistory: true },
  plugins: [perf, devtoolsPlugin({ name: "error-boundaries" })],
  errorBoundary: {
    onResolverError: (_error, resolver) => {
      addTimeline(
        "recovery",
        `${resolver}: strategy=${currentStrategy}`,
        "recovery",
      );

      return currentStrategy;
    },
    onConstraintError: "skip",
    onEffectError: "skip",
    retryLater: {
      delayMs: 1000,
      maxRetries: 3,
      backoffMultiplier: 2,
    },
    onError: (error) => {
      addTimeline("error", `boundary: ${error.message.slice(0, 60)}`, "error");
    },
  },
});

// Track strategy changes to update error boundary (via re-dispatch)
system.subscribe(["strategy"], () => {
  const newStrategy = system.facts.strategy;
  if (newStrategy !== currentStrategy) {
    currentStrategy = newStrategy;
    addTimeline("recovery", `strategy → ${newStrategy}`, "recovery");
  }
});
```
