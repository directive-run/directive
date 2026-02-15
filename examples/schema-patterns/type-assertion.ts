/**
 * Schema Pattern 2: Type Assertion Type Assertions
 *
 * Uses {} as { ... } for type-only definitions without runtime validation.
 */

import { createModule, createSystem } from "@directive-run/core";

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
// Module with Type Assertion Schema
// ============================================================================

const userModule = createModule("user", {
  schema: {
    // Facts with Type Assertion type assertion
    facts: {} as {
      userId: number;
      user: User | null;
      status: Status;
      errorMessage: string;
    },

    // Derivations with Type Assertion type assertion
    derivations: {} as {
      isLoading: boolean;
      hasUser: boolean;
      displayName: string;
      statusMessage: string;
    },

    // Events with Type Assertion type assertion
    events: {} as {
      setUserId: { userId: number };
      reset: {};
    },

    // Requirements with Type Assertion type assertion
    requirements: {} as {
      FETCH_USER: { userId: number };
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
      resolve: async (req, context) => {
        // req.userId is typed as number from schema
        console.log(`[Resolver] Fetching user ${req.userId}`);

        // Simulate API call
        await new Promise((r) => setTimeout(r, 100));

        context.facts.user = {
          id: req.userId,
          name: `User ${req.userId}`,
          email: `user${req.userId}@example.com`,
        };
        context.facts.status = "success";
      },
    },
  },
});

// ============================================================================
// Test the Module
// ============================================================================

async function main() {
  console.log("=== Pattern 2: Type Assertion Type Assertions ===\n");

  const system = createSystem({ module: userModule });
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
  console.log("\n=== Pattern 2 Complete ===");
}

main().catch(console.error);
