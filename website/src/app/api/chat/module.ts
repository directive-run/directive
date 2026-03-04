/**
 * Directive module for AI docs chatbot server-side state.
 *
 * Replaces the imperative rateLimitMap / evictExpired / isRateLimited with
 * reactive facts, derivations, events, constraints, and effects.
 */
import { createModule, t } from "@directive-run/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 5;
const DAILY_TOKEN_BUDGET = 500_000;
const MAX_RATE_LIMIT_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const docsChatbot = createModule("docs-chatbot", {
  schema: {
    facts: {
      requestCounts: t.object<Record<string, RateLimitEntry>>(),
      totalRequests: t.number(),
      totalTokensUsed: t.number(),
      consecutiveErrors: t.number(),
      lastErrorAt: t.number(),
    },
    derivations: {
      isHealthy: t.boolean(),
      tokenBudgetPercent: t.number(),
      isOverBudget: t.boolean(),
      activeIPs: t.number(),
    },
    events: {
      incomingRequest: { ip: t.string() },
      requestCompleted: { tokens: t.number() },
      requestFailed: {},
      evictExpired: {},
    },
    requirements: {
      LOG_BUDGET_WARNING: {},
    },
  },

  init: (facts) => {
    facts.requestCounts = {};
    facts.totalRequests = 0;
    facts.totalTokensUsed = 0;
    facts.consecutiveErrors = 0;
    facts.lastErrorAt = 0;
  },

  derive: {
    isHealthy: (facts) =>
      facts.consecutiveErrors < 5 && facts.totalTokensUsed < DAILY_TOKEN_BUDGET,
    tokenBudgetPercent: (facts) =>
      (facts.totalTokensUsed / DAILY_TOKEN_BUDGET) * 100,
    isOverBudget: (facts) => facts.totalTokensUsed >= DAILY_TOKEN_BUDGET,
    activeIPs: (facts) => Object.keys(facts.requestCounts).length,
  },

  events: {
    incomingRequest: (facts, { ip }) => {
      const now = Date.now();
      const counts = { ...facts.requestCounts };
      const entry = counts[ip];

      if (!entry || now > entry.resetAt) {
        counts[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW };
      } else {
        counts[ip] = { ...entry, count: entry.count + 1 };
      }

      facts.requestCounts = counts;
      facts.totalRequests += 1;

      // Trigger eviction when map grows too large
      if (Object.keys(counts).length > MAX_RATE_LIMIT_ENTRIES) {
        const cleaned = { ...counts };
        for (const [key, val] of Object.entries(cleaned)) {
          if (now > val.resetAt) delete cleaned[key];
        }
        facts.requestCounts = cleaned;
      }
    },

    requestCompleted: (facts, { tokens }) => {
      facts.totalTokensUsed += tokens;
      facts.consecutiveErrors = 0;
    },

    requestFailed: (facts) => {
      facts.consecutiveErrors += 1;
      facts.lastErrorAt = Date.now();
    },

    evictExpired: (facts) => {
      const now = Date.now();
      const counts = { ...facts.requestCounts };
      let changed = false;
      for (const [ip, entry] of Object.entries(counts)) {
        if (now > entry.resetAt) {
          delete counts[ip];
          changed = true;
        }
      }
      if (changed) facts.requestCounts = counts;
    },
  },

  constraints: {
    budgetExceeded: {
      when: (facts) => facts.totalTokensUsed >= DAILY_TOKEN_BUDGET,
      require: { type: "LOG_BUDGET_WARNING" },
    },
  },

  resolvers: {
    logBudgetWarning: {
      requirement: "LOG_BUDGET_WARNING",
      resolve: async (req, context) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[docs-chatbot] Daily token budget exceeded: ${context.facts.totalTokensUsed} tokens used`,
          );
        }
      },
    },
  },

  effects: {
    logMetrics: {
      deps: ["totalRequests", "totalTokensUsed", "consecutiveErrors"],
      run: (facts) => {
        if (process.env.NODE_ENV !== "development") {
          return undefined;
        }
        if (facts.totalRequests > 0) {
          console.log(
            `[docs-chatbot] requests=${facts.totalRequests} tokens=${facts.totalTokensUsed} errors=${facts.consecutiveErrors}`,
          );
        }

        return undefined;
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Helpers (used by route.ts)
// ---------------------------------------------------------------------------

export { MAX_REQUESTS_PER_WINDOW, RATE_LIMIT_WINDOW };
