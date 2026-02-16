/**
 * Data Module
 *
 * Handles data fetching: users list, loading states, errors.
 *
 * This module demonstrates cross-module constraints with `crossModuleDeps`:
 * - Declare dependencies on other modules' schemas for type-safe access
 * - Own facts are accessed flat: `facts.users`
 * - Cross-module facts are namespaced: `facts.auth.isAuthenticated`
 * - No @ts-expect-error needed - types flow automatically!
 */

import { createModule, t, type ModuleSchema } from "@directive-run/core";
import type { UserData } from "../types";
import { authSchema } from "./auth";

// Clean schema - no namespace prefix needed!
export const dataSchema = {
  facts: {
    users: t.array<UserData>(),
    isLoading: t.boolean(),
    error: t.string().nullable(),
    lastFetched: t.object<Date | null>(),
  },
  derivations: {
    userCount: t.number(),
    status: t.string<"idle" | "loading" | "success" | "error">(),
  },
  events: {
    refresh: {},
    clear: {},
  },
  requirements: {
    FETCH_USERS: {},
  },
} satisfies ModuleSchema;

export const dataModule = createModule("data", {
  schema: dataSchema,

  // Declare cross-module dependencies for type-safe access
  // facts.self.* for own module, facts.auth.* for cross-module
  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.users = [];
    facts.isLoading = false;
    facts.error = null;
    facts.lastFetched = null;
  },

  // Derivations with cross-module access
  // - Own module: facts.self.*
  // - Cross-module: facts.auth.*
  derive: {
    userCount: (facts) => facts.self.users.length,
    status: (facts) => {
      if (facts.self.isLoading) return "loading";
      if (facts.self.error) return "error";
      if (facts.self.lastFetched) return "success";
      return "idle";
    },
  },

  events: {
    refresh: (facts) => {
      // Mark as needing refresh by clearing lastFetched
      facts.lastFetched = null;
      facts.error = null;
    },
    clear: (facts) => {
      facts.users = [];
      facts.lastFetched = null;
      facts.error = null;
    },
  },

  constraints: {
    // Cross-module constraint: fetch users when authenticated and no data
    // - Own module: facts.self.users, facts.self.isLoading
    // - Cross-module: facts.auth.isAuthenticated
    fetchUsersWhenAuthenticated: {
      when: (facts) => {
        // Type-safe cross-module access!
        return (
          facts.auth.isAuthenticated === true &&
          facts.self.users.length === 0 &&
          !facts.self.isLoading &&
          !facts.self.error
        );
      },
      require: { type: "FETCH_USERS" },
    },
  },

  resolvers: {
    fetchUsers: {
      requirement: "FETCH_USERS",
      timeout: 10000,
      retry: {
        attempts: 3,
        backoff: "exponential",
        initialDelay: 500,
      },
      resolve: async (_req, context) => {
        context.facts.isLoading = true;
        context.facts.error = null;

        try {
          // Simulate API call
          await new Promise((resolve) => setTimeout(resolve, 800));

          // Simulate response
          context.facts.users = [
            { id: "1", name: "Alice Johnson", department: "Engineering" },
            { id: "2", name: "Bob Smith", department: "Design" },
            { id: "3", name: "Carol Williams", department: "Product" },
            { id: "4", name: "David Brown", department: "Engineering" },
            { id: "5", name: "Eve Davis", department: "Marketing" },
          ];
          context.facts.lastFetched = new Date();
        } catch (error) {
          context.facts.error =
            error instanceof Error ? error.message : "Failed to fetch users";
        } finally {
          context.facts.isLoading = false;
        }
      },
    },
  },
});
