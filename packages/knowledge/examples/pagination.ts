// Example: pagination
// Source: examples/pagination/src/pagination.ts
// Pure module file — no DOM wiring

/**
 * Pagination & Infinite Scroll — Directive Modules
 *
 * Two modules: `filters` owns search/sort/category,
 * `list` owns items and pagination state with crossModuleDeps.
 *
 * Constraints:
 * - loadMore: appends next page when scrollNearBottom
 * - filterChanged: resets and re-fetches when filters change
 *
 * Effects:
 * - observeScroll: IntersectionObserver on sentinel element
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin, loggingPlugin } from "@directive-run/core/plugins";
import { type ListItem, fetchPage } from "./mock-api.js";

// ============================================================================
// Filters Module
// ============================================================================

export const filtersSchema = {
  facts: {
    search: t.string(),
    sortBy: t.string<"newest" | "oldest" | "title">(),
    category: t.string(),
  },
  events: {
    setSearch: { value: t.string() },
    setSortBy: { value: t.string() },
    setCategory: { value: t.string() },
  },
} satisfies ModuleSchema;

export const filtersModule = createModule("filters", {
  schema: filtersSchema,

  init: (facts) => {
    facts.search = "";
    facts.sortBy = "newest";
    facts.category = "all";
  },

  events: {
    setSearch: (facts, { value }) => {
      facts.search = value;
    },
    setSortBy: (facts, { value }) => {
      facts.sortBy = value;
    },
    setCategory: (facts, { value }) => {
      facts.category = value;
    },
  },
});

// ============================================================================
// List Module
// ============================================================================

export const listSchema = {
  facts: {
    items: t.object<ListItem[]>(),
    cursor: t.string(),
    hasMore: t.boolean(),
    isLoadingMore: t.boolean(),
    scrollNearBottom: t.boolean(),
    lastFilterHash: t.string(),
  },
  derivations: {
    totalLoaded: t.number(),
    isEmpty: t.boolean(),
  },
  events: {
    setScrollNearBottom: { value: t.boolean() },
  },
  requirements: {
    LOAD_PAGE: {
      cursor: t.string(),
      search: t.string(),
      sortBy: t.string(),
      category: t.string(),
    },
    RESET_AND_LOAD: {
      search: t.string(),
      sortBy: t.string(),
      category: t.string(),
    },
  },
} satisfies ModuleSchema;

export const listModule = createModule("list", {
  schema: listSchema,

  crossModuleDeps: { filters: filtersSchema },

  init: (facts) => {
    facts.items = [];
    facts.cursor = "";
    facts.hasMore = true;
    facts.isLoadingMore = false;
    facts.scrollNearBottom = false;
    facts.lastFilterHash = "";
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    totalLoaded: (facts) => facts.self.items.length,
    isEmpty: (facts) => facts.self.items.length === 0 && !facts.self.hasMore,
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setScrollNearBottom: (facts, { value }) => {
      facts.scrollNearBottom = value;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    loadMore: {
      when: (facts) => {
        return (
          facts.self.hasMore &&
          !facts.self.isLoadingMore &&
          facts.self.scrollNearBottom
        );
      },
      require: (facts) => ({
        type: "LOAD_PAGE",
        cursor: facts.self.cursor,
        search: facts.filters.search,
        sortBy: facts.filters.sortBy,
        category: facts.filters.category,
      }),
    },

    filterChanged: {
      when: (facts) => {
        const hash = `${facts.filters.search}|${facts.filters.sortBy}|${facts.filters.category}`;

        return hash !== facts.self.lastFilterHash;
      },
      require: (facts) => ({
        type: "RESET_AND_LOAD",
        search: facts.filters.search,
        sortBy: facts.filters.sortBy,
        category: facts.filters.category,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    loadPage: {
      requirement: "LOAD_PAGE",
      resolve: async (req, context) => {
        context.facts.isLoadingMore = true;

        try {
          const data = await fetchPage(req.cursor, 20, {
            search: req.search,
            sortBy: req.sortBy,
            category: req.category,
          });

          context.facts.items = [...context.facts.items, ...data.items];
          context.facts.cursor = data.nextCursor;
          context.facts.hasMore = data.hasMore;
        } finally {
          context.facts.isLoadingMore = false;
        }
      },
    },

    resetAndLoad: {
      requirement: "RESET_AND_LOAD",
      resolve: async (req, context) => {
        const hash = `${req.search}|${req.sortBy}|${req.category}`;

        context.facts.items = [];
        context.facts.cursor = "";
        context.facts.hasMore = true;
        context.facts.isLoadingMore = true;
        context.facts.lastFilterHash = hash;

        try {
          const data = await fetchPage("", 20, {
            search: req.search,
            sortBy: req.sortBy,
            category: req.category,
          });

          context.facts.items = data.items;
          context.facts.cursor = data.nextCursor;
          context.facts.hasMore = data.hasMore;
        } finally {
          context.facts.isLoadingMore = false;
        }
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    observeScroll: {
      run: (facts) => {
        const sentinel = document.getElementById("pg-scroll-sentinel");
        if (!sentinel) {
          return;
        }

        const observer = new IntersectionObserver(
          ([entry]) => {
            facts.self.scrollNearBottom = entry.isIntersecting;
          },
          { rootMargin: "200px" },
        );
        observer.observe(sentinel);

        return () => observer.disconnect();
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: { filters: filtersModule, list: listModule },
  plugins: [loggingPlugin(), devtoolsPlugin({ name: "pagination" })],
});
