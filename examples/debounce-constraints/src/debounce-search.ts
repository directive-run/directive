/**
 * Debounce Constraints — Directive Module
 *
 * Demonstrates debounced constraint evaluation via a ticking `now` fact,
 * resolver key deduplication for stale result prevention, configurable
 * debounce delay, and efficiency stats (keystrokes vs API calls).
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { type SearchResult, mockSearch } from "./mock-search.js";

// ============================================================================
// Types
// ============================================================================

export type { SearchResult } from "./mock-search.js";

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Schema
// ============================================================================

export const debounceSearchSchema = {
  facts: {
    query: t.string(),
    queryChangedAt: t.number(),
    debouncedQuery: t.string(),
    lastSearchedQuery: t.string(),
    results: t.array<SearchResult>(),
    isSearching: t.boolean(),
    now: t.number(),
    keystrokeCount: t.number(),
    apiCallCount: t.number(),
    debounceDelay: t.number(),
    apiDelay: t.number(),
    minChars: t.number(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    isDebouncing: t.boolean(),
    debounceProgress: t.number(),
    resultCount: t.number(),
    savedCalls: t.number(),
  },
  events: {
    setQuery: { value: t.string() },
    tick: {},
    clearSearch: {},
    setDebounceDelay: { value: t.number() },
    setApiDelay: { value: t.number() },
    setMinChars: { value: t.number() },
  },
  requirements: {
    SETTLE_DEBOUNCE: {},
    SEARCH: {
      query: t.string(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, detail });
  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const debounceSearchModule = createModule("debounce-search", {
  schema: debounceSearchSchema,

  init: (facts) => {
    facts.query = "";
    facts.queryChangedAt = 0;
    facts.debouncedQuery = "";
    facts.lastSearchedQuery = "";
    facts.results = [];
    facts.isSearching = false;
    facts.now = Date.now();
    facts.keystrokeCount = 0;
    facts.apiCallCount = 0;
    facts.debounceDelay = 300;
    facts.apiDelay = 500;
    facts.minChars = 2;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    isDebouncing: (facts) => {
      return facts.query !== facts.debouncedQuery && facts.queryChangedAt > 0;
    },

    debounceProgress: (facts, derive) => {
      if (!derive.isDebouncing) {
        return 0;
      }

      const elapsed = facts.now - facts.queryChangedAt;
      const delay = facts.debounceDelay;

      return Math.min(1, elapsed / delay);
    },

    resultCount: (facts) => facts.results.length,

    savedCalls: (facts) => {
      return Math.max(0, facts.keystrokeCount - facts.apiCallCount);
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setQuery: (facts, { value }) => {
      facts.query = value;
      facts.queryChangedAt = Date.now();
      facts.keystrokeCount = facts.keystrokeCount + 1;

      if (value === "") {
        facts.debouncedQuery = "";
        facts.results = [];
        facts.lastSearchedQuery = "";
        facts.queryChangedAt = 0;
      }
    },

    tick: (facts) => {
      facts.now = Date.now();
    },

    clearSearch: (facts) => {
      facts.query = "";
      facts.debouncedQuery = "";
      facts.results = [];
      facts.lastSearchedQuery = "";
      facts.queryChangedAt = 0;
    },

    setDebounceDelay: (facts, { value }) => {
      facts.debounceDelay = value;
    },

    setApiDelay: (facts, { value }) => {
      facts.apiDelay = value;
    },

    setMinChars: (facts, { value }) => {
      facts.minChars = value;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    debounceSettled: {
      priority: 100,
      when: (facts) => {
        return (
          facts.query !== facts.debouncedQuery &&
          facts.queryChangedAt > 0 &&
          facts.now - facts.queryChangedAt >= facts.debounceDelay
        );
      },
      require: () => ({
        type: "SETTLE_DEBOUNCE",
      }),
    },

    needsSearch: {
      priority: 90,
      when: (facts) => {
        return (
          facts.debouncedQuery.length >= facts.minChars &&
          facts.debouncedQuery !== facts.lastSearchedQuery &&
          !facts.isSearching
        );
      },
      require: (facts) => ({
        type: "SEARCH",
        query: facts.debouncedQuery,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    settleDebounce: {
      requirement: "SETTLE_DEBOUNCE",
      resolve: async (_req, context) => {
        const query = context.facts.query;
        context.facts.debouncedQuery = query;

        addLogEntry(context.facts, "debounce-settled", `"${query}"`);

        if (query === "" || query.length < context.facts.minChars) {
          context.facts.results = [];
          context.facts.lastSearchedQuery = "";
        }
      },
    },

    search: {
      requirement: "SEARCH",
      key: (req) => `search-${req.query}`,
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.isSearching = true;
        context.facts.apiCallCount = context.facts.apiCallCount + 1;

        addLogEntry(context.facts, "search-start", `"${req.query}"`);

        const apiDelay = context.facts.apiDelay;
        const results = await mockSearch(req.query, apiDelay);

        // Stale result prevention
        if (context.facts.debouncedQuery === req.query) {
          context.facts.results = results;
          context.facts.lastSearchedQuery = req.query;
          addLogEntry(
            context.facts,
            "search-complete",
            `${results.length} results for "${req.query}"`,
          );
        } else {
          addLogEntry(
            context.facts,
            "search-stale",
            `Discarded results for "${req.query}"`,
          );
        }

        context.facts.isSearching = false;
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logQueryChange: {
      deps: ["query"],
      run: (facts, prev) => {
        if (prev && prev.query !== facts.query && facts.query !== "") {
          addLogEntry(facts, "keystroke", `"${facts.query}"`);
        }
      },
    },
  },
});
