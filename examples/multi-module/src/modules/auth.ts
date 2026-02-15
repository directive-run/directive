/**
 * Auth Module
 *
 * Handles authentication state: login, logout, token validation.
 *
 * With namespaced modules, facts use clean names (token, user, isAuthenticated)
 * instead of prefixed names (auth_token, auth_user, auth_isAuthenticated).
 * The namespace is applied automatically by the system.
 */

import { createModule, t, type ModuleSchema } from "@directive-run/core";
import type { User } from "../types";

// Clean schema - no namespace prefix needed!
export const authSchema = {
  facts: {
    token: t.string().nullable(),
    user: t.any<User | null>(),
    isAuthenticated: t.boolean(),
    isValidating: t.boolean(),
  },
  derivations: {
    status: t.string<"authenticated" | "unauthenticated" | "validating">(),
    displayName: t.string(),
  },
  events: {
    login: { token: t.string() },
    logout: {},
  },
  requirements: {
    VALIDATE_TOKEN: { token: t.string() },
  },
} satisfies ModuleSchema;

export const authModule = createModule("auth", {
  schema: authSchema,

  init: (facts) => {
    // Clean access - no prefix needed!
    facts.token = null;
    facts.user = null;
    facts.isAuthenticated = false;
    facts.isValidating = false;
  },

  derive: {
    status: (facts) => {
      if (facts.isValidating) return "validating";
      if (facts.isAuthenticated) return "authenticated";
      return "unauthenticated";
    },
    displayName: (facts) => {
      return facts.user?.name ?? "Guest";
    },
  },

  events: {
    login: (facts, { token }) => {
      facts.token = token;
      facts.isValidating = true;
    },
    logout: (facts) => {
      facts.token = null;
      facts.user = null;
      facts.isAuthenticated = false;
      facts.isValidating = false;
    },
  },

  constraints: {
    validateToken: {
      // `facts` here is the module's own facts - clean access
      when: (facts) => facts.token !== null && facts.isValidating,
      require: (facts) => ({
        type: "VALIDATE_TOKEN",
        token: facts.token!,
      }),
    },
  },

  resolvers: {
    validateToken: {
      requirement: "VALIDATE_TOKEN",
      key: (req) => `validate-${req.token}`,
      timeout: 5000,
      retry: {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 500,
      },
      resolve: async (req, context) => {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Simulate validation (in real app, call your auth API)
        if (req.token === "valid-token") {
          context.facts.user = {
            id: "user-123",
            name: "John Doe",
            email: "john@example.com",
          };
          context.facts.isAuthenticated = true;
        } else {
          context.facts.user = null;
          context.facts.isAuthenticated = false;
        }
        context.facts.isValidating = false;
      },
    },
  },
});
