/**
 * Schema Pattern 3: Zod Schemas
 *
 * Uses Zod for type definitions with full runtime validation.
 */

import { createModule, createSystem } from "@directive-run/core";
import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

const StatusSchema = z.enum(["idle", "loading", "success", "error"]);
type Status = z.infer<typeof StatusSchema>;

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});
type User = z.infer<typeof UserSchema>;

// ============================================================================
// Module with Zod Schemas
// ============================================================================

const userModule = createModule("user", {
  schema: {
    // Facts with Zod schemas
    facts: {
      userId: z.number().min(0),
      user: UserSchema.nullable(),
      status: StatusSchema,
      errorMessage: z.string(),
    },

    // Derivations with Zod schemas
    derivations: {
      isLoading: z.boolean(),
      hasUser: z.boolean(),
      displayName: z.string(),
      statusMessage: z.string(),
    },

    // Events with Zod schemas
    events: {
      setUserId: { userId: z.number().positive() },
      reset: {},
    },

    // Requirements with Zod schemas
    requirements: {
      FETCH_USER: { userId: z.number().positive() },
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
        case "idle":
          return "Ready";
        case "loading":
          return "Loading...";
        case "success":
          return `Welcome, ${facts.user?.name}!`;
        case "error":
          return `Error: ${facts.errorMessage}`;
      }
    },
  },

  events: {
    setUserId: (facts, { userId }) => {
      // userId is typed as number from Zod schema
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
      when: (facts) =>
        facts.userId > 0 && facts.user === null && facts.status === "loading",
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
        // req.userId is typed as number from Zod schema
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
  console.log("=== Pattern 3: Zod Schemas ===\n");

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

  // Test Zod validation (with validate: true)
  console.log("\n--- Testing Zod Validation ---");

  // This would fail validation if validate: true was enabled
  // because userId must be positive according to the Zod schema
  console.log("Setting userId to valid value (100)...");
  system.facts.userId = 100;
  console.log("  userId:", system.facts.userId);

  // Test reset event
  console.log("\nDispatching reset event...");
  system.dispatch({ type: "reset" });
  console.log("  status:", system.facts.status);

  system.stop();
  console.log("\n=== Pattern 3 Complete ===");
}

main().catch(console.error);
