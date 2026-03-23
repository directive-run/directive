# Examples

> Auto-generated from extracted examples. Do not edit manually.

## counter

```typescript
// Example: counter
// Source: examples/counter/src/module.ts
// Pure module file — no DOM wiring

/**
 * Counter — The simplest Directive module.
 *
 * Demonstrates: facts, events, derivations, one constraint, one resolver.
 * Total: ~40 lines.
 */

import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";

const schema = {
  facts: {
    count: t.number(),
  },
  derivations: {
    doubled: t.number(),
    isPositive: t.boolean(),
  },
  events: {
    increment: {},
    decrement: {},
    reset: {},
  },
  requirements: {
    CLAMP_TO_ZERO: {},
  },
} satisfies ModuleSchema;

export const counterModule = createModule("counter", {
  schema,

  init: (facts) => {
    facts.count = 0;
  },

  derive: {
    doubled: (facts) => facts.count * 2,
    isPositive: (facts) => facts.count > 0,
  },

  events: {
    increment: (facts) => { facts.count += 1; },
    decrement: (facts) => { facts.count -= 1; },
    reset: (facts) => { facts.count = 0; },
  },

  // When count goes negative, automatically fix it
  constraints: {
    noNegative: {
      when: (facts) => facts.count < 0,
      require: { type: "CLAMP_TO_ZERO" },
    },
  },

  resolvers: {
    clamp: {
      requirement: "CLAMP_TO_ZERO",
      resolve: async (req, context) => {
        context.facts.count = 0;
      },
    },
  },
});

export const system = createSystem({ module: counterModule });
```

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
