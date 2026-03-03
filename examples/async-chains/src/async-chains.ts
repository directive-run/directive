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
