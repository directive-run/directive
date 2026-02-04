/**
 * Schema Pattern 1: t.*() Schema Builders
 *
 * Uses schema builders for type definitions with optional runtime validation.
 */

import { createModule, createSystem, t } from "directive";

// ============================================================================
// Types
// ============================================================================

type Status = "idle" | "loading" | "success" | "error";

interface User {
  id: number;
  name: string;
  email: string;
}

// ============================================================================
// Module with t.*() Schema Builders
// ============================================================================

const userModule = createModule("user", {
  schema: {
    // Facts with schema builders
    facts: {
      userId: t.number(),
      user: t.any<User | null>(),
      status: t.string<Status>(),
      errorMessage: t.string(),
    },

    // Derivations with schema builders
    derivations: {
      isLoading: t.boolean(),
      hasUser: t.boolean(),
      displayName: t.string(),
      statusMessage: t.string(),
    },

    // Events with schema builders
    events: {
      setUserId: { userId: t.number() },
      reset: {},
    },

    // Requirements with schema builders
    requirements: {
      FETCH_USER: { userId: t.number() },
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.status = "idle";
    facts.errorMessage = "";
  },

  derive: {
    isLoading: (facts) => facts.status === "loading",
    hasUser: (facts) => facts.user !== null,
    displayName: (facts) => facts.user?.name ?? "Guest",
    statusMessage: (facts) => {
      switch (facts.status) {
        case "idle": return "Ready";
        case "loading": return "Loading...";
        case "success": return `Welcome, ${facts.user?.name}!`;
        case "error": return `Error: ${facts.errorMessage}`;
      }
    },
  },

  events: {
    setUserId: (facts, { userId }) => {
      // userId is typed as number from schema
      facts.userId = userId;
      facts.status = "loading";
    },
    reset: (facts) => {
      facts.userId = 0;
      facts.user = null;
      facts.status = "idle";
      facts.errorMessage = "";
    },
  },

  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && facts.user === null && facts.status === "loading",
      require: (facts) => ({
        type: "FETCH_USER",
        userId: facts.userId, // typed as number
      }),
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, ctx) => {
        // req.userId is typed as number from schema
        console.log(`[Resolver] Fetching user ${req.userId}`);

        // Simulate API call
        await new Promise((r) => setTimeout(r, 100));

        ctx.facts.user = {
          id: req.userId,
          name: `User ${req.userId}`,
          email: `user${req.userId}@example.com`,
        };
        ctx.facts.status = "success";
      },
    },
  },
});

// ============================================================================
// Test the Module
// ============================================================================

async function main() {
  console.log("=== Pattern 1: t.*() Schema Builders ===\n");

  const system = createSystem({ modules: [userModule] });
  system.start();

  // Test facts typing
  console.log("Initial state:");
  console.log("  userId:", system.facts.userId); // number
  console.log("  user:", system.facts.user); // User | null
  console.log("  status:", system.facts.status); // Status

  // Test derivations typing
  console.log("\nDerivations:");
  console.log("  isLoading:", system.derive.isLoading); // boolean
  console.log("  hasUser:", system.derive.hasUser); // boolean
  console.log("  displayName:", system.derive.displayName); // string
  console.log("  statusMessage:", system.derive.statusMessage); // string

  // Test event dispatch typing
  console.log("\nDispatching setUserId event...");
  system.dispatch({ type: "setUserId", userId: 42 }); // userId typed as number

  // Wait for resolution
  await system.settle();

  console.log("\nAfter fetch:");
  console.log("  user:", system.facts.user);
  console.log("  statusMessage:", system.derive.statusMessage);

  // Test reset event
  console.log("\nDispatching reset event...");
  system.dispatch({ type: "reset" });
  console.log("  status:", system.facts.status);

  system.stop();
  console.log("\n=== Pattern 1 Complete ===");
}

main().catch(console.error);
