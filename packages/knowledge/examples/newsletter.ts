// Example: newsletter
// Source: examples/newsletter/src/module.ts
// Pure module file — no DOM wiring

/**
 * Newsletter Signup — Directive Module
 *
 * Demonstrates all six primitives with the simplest possible module:
 * - Facts: email, touched, status, errorMessage, lastSubmittedAt
 * - Derivations: emailError (touch-gated), isValid, canSubmit (rate-limited)
 * - Events: updateEmail, touchEmail, submit
 * - Constraints: subscribe (status === 'submitting'), resetAfterSuccess
 * - Resolvers: simulated async subscribe, auto-reset after delay
 * - Effects: logging status transitions
 *
 * Uses a simulated setTimeout instead of a real API so no account is needed.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Constants
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 10_000; // 10 seconds (shorter for demo)

// ============================================================================
// Logs (external mutable array, same pattern as fraud-analysis)
// ============================================================================

export const logs: string[] = [];

export function addLog(msg: string): void {
  console.log(`[newsletter] ${msg}`);
  logs.push(`${new Date().toLocaleTimeString()}: ${msg}`);
}

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    email: t.string(),
    touched: t.boolean(),
    status: t.string<"idle" | "submitting" | "success" | "error">(),
    errorMessage: t.string(),
    lastSubmittedAt: t.number(),
  },
  derivations: {
    emailError: t.string(),
    isValid: t.boolean(),
    canSubmit: t.boolean(),
  },
  events: {
    updateEmail: { value: t.string() },
    touchEmail: {},
    submit: {},
  },
  requirements: {
    SUBSCRIBE: {},
    RESET_AFTER_DELAY: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const newsletter = createModule("newsletter", {
  schema,

  init: (facts) => {
    facts.email = "";
    facts.touched = false;
    facts.status = "idle";
    facts.errorMessage = "";
    facts.lastSubmittedAt = 0;
  },

  derive: {
    emailError: (facts) => {
      if (!facts.touched) {
        return "";
      }
      if (!facts.email.trim()) {
        return "Email is required";
      }
      if (!EMAIL_REGEX.test(facts.email)) {
        return "Enter a valid email address";
      }

      return "";
    },

    isValid: (facts) => EMAIL_REGEX.test(facts.email),

    canSubmit: (facts, derived) => {
      if (!derived.isValid) {
        return false;
      }
      if (facts.status !== "idle") {
        return false;
      }
      if (
        facts.lastSubmittedAt > 0 &&
        Date.now() - facts.lastSubmittedAt < RATE_LIMIT_MS
      ) {
        return false;
      }

      return true;
    },
  },

  events: {
    updateEmail: (facts, { value }) => {
      facts.email = value;
    },

    touchEmail: (facts) => {
      facts.touched = true;
    },

    submit: (facts) => {
      facts.touched = true;
      facts.status = "submitting";
    },
  },

  constraints: {
    subscribe: {
      when: (facts) => facts.status === "submitting",
      require: { type: "SUBSCRIBE" },
    },

    resetAfterSuccess: {
      when: (facts) => facts.status === "success",
      require: { type: "RESET_AFTER_DELAY" },
    },
  },

  resolvers: {
    // Simulated submission — no API account needed
    subscribe: {
      requirement: "SUBSCRIBE",
      resolve: async (req, context) => {
        addLog(`Subscribing: ${context.facts.email}`);

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Simulate occasional failure (20% chance)
        if (Math.random() < 0.2) {
          context.facts.status = "error";
          context.facts.errorMessage =
            "Simulated error — try again (20% failure rate for demo).";
          addLog("Subscription failed (simulated)");

          return;
        }

        context.facts.status = "success";
        context.facts.lastSubmittedAt = Date.now();
        addLog("Subscription succeeded");
      },
    },

    resetAfterDelay: {
      requirement: "RESET_AFTER_DELAY",
      resolve: async (req, context) => {
        addLog("Auto-resetting in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        context.facts.email = "";
        context.facts.touched = false;
        context.facts.status = "idle";
        context.facts.errorMessage = "";
        addLog("Form reset");
      },
    },
  },

  effects: {
    logSubscription: {
      deps: ["status"],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        if (facts.status !== prev.status) {
          addLog(`Status: ${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: newsletter,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "newsletter" })],
});
