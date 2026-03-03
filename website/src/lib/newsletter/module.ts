// @ts-nocheck
/**
 * Newsletter Signup Directive Module
 *
 * The simplest Directive module — one field, one submission, one reset.
 * Still demonstrates all six primitives: facts, derivations, constraints,
 * resolvers, effects, and events.
 *
 * Real async submission via Buttondown, rate limiting via derivation,
 * auto-reset after success via constraint → resolver chain.
 */
import { createModule, t } from "@directive-run/core";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 60_000; // 60 seconds between submissions

export const newsletter = createModule("newsletter", {
  schema: {
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
  },

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

    canSubmit: (facts, derive) => {
      if (!derive.isValid) {
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
    subscribe: {
      requirement: "SUBSCRIBE",
      resolve: async (req, context) => {
        try {
          const response = await fetch("/api/newsletter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: context.facts.email }),
          });

          if (response.ok) {
            context.facts.status = "success";
            context.facts.lastSubmittedAt = Date.now();
          } else {
            const data = await response.json().catch(() => ({}));
            context.facts.status = "error";
            context.facts.errorMessage =
              data.error ?? "Something went wrong. Please try again.";
          }
        } catch {
          context.facts.status = "error";
          context.facts.errorMessage =
            "Network error. Check your connection and try again.";
        }
      },
    },

    resetAfterDelay: {
      requirement: "RESET_AFTER_DELAY",
      resolve: async (req, context) => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        context.facts.email = "";
        context.facts.touched = false;
        context.facts.status = "idle";
        context.facts.errorMessage = "";
      },
    },
  },

  effects: {
    logSubscription: {
      deps: ["status"],
      run: (facts, prev) => {
        if (process.env.NODE_ENV !== "development") {
          return;
        }
        if (!prev) {
          return;
        }
        if (facts.status !== prev.status) {
          console.log(`[newsletter] status: ${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});
