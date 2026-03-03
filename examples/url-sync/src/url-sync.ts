/**
 * URL Sync — Directive Modules
 *
 * Two modules that synchronize URL query parameters with product filtering:
 * - **url module**: Reads/writes URL params, dispatches filter changes
 * - **products module**: Fetches filtered products via cross-module constraints
 *
 * Demonstrates bidirectional URL sync (popstate ↔ replaceState), cross-module
 * constraints, and resolver-driven data fetching with mock delay.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { type Product, allProducts, filterProducts } from "./mock-products.js";

// ============================================================================
// URL Module — Schema
// ============================================================================

export const urlSchema = {
  facts: {
    search: t.string(),
    category: t.string(),
    sortBy: t.string<"newest" | "price-asc" | "price-desc">(),
    page: t.number(),
    syncingFromUrl: t.boolean(),
  },
  derivations: {},
  events: {
    setSearch: { value: t.string() },
    setCategory: { value: t.string() },
    setSortBy: { value: t.string() },
    setPage: { value: t.number() },
    syncFromUrl: {
      search: t.string(),
      category: t.string(),
      sortBy: t.string(),
      page: t.number(),
    },
    syncComplete: {},
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// URL Module — Helpers
// ============================================================================

function readUrlParams(): {
  search: string;
  category: string;
  sortBy: string;
  page: number;
} {
  const params = new URLSearchParams(window.location.search);

  return {
    search: params.get("q") ?? "",
    category: params.get("cat") ?? "",
    sortBy: params.get("sort") ?? "newest",
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

// ============================================================================
// URL Module
// ============================================================================

export const urlModule = createModule("url", {
  schema: urlSchema,

  init: (facts) => {
    const params = readUrlParams();
    facts.search = params.search;
    facts.category = params.category;
    facts.sortBy = params.sortBy;
    facts.page = params.page;
    facts.syncingFromUrl = false;
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setSearch: (facts, { value }) => {
      facts.search = value;
      facts.page = 1;
    },

    setCategory: (facts, { value }) => {
      facts.category = value;
      facts.page = 1;
    },

    setSortBy: (facts, { value }) => {
      facts.sortBy = value;
      facts.page = 1;
    },

    setPage: (facts, { value }) => {
      facts.page = value;
    },

    syncFromUrl: (facts, { search, category, sortBy, page }) => {
      facts.syncingFromUrl = true;
      facts.search = search;
      facts.category = category;
      facts.sortBy = sortBy;
      facts.page = page;
    },

    syncComplete: (facts) => {
      facts.syncingFromUrl = false;
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    urlToState: {
      run: () => {
        const handler = () => {
          const params = readUrlParams();
          system.events.url.syncFromUrl({
            search: params.search,
            category: params.category,
            sortBy: params.sortBy,
            page: params.page,
          });
          system.events.url.syncComplete();
        };

        window.addEventListener("popstate", handler);

        return () => {
          window.removeEventListener("popstate", handler);
        };
      },
    },

    stateToUrl: {
      deps: ["search", "category", "sortBy", "page"],
      run: (facts) => {
        if (facts.syncingFromUrl) {
          return;
        }

        const params = new URLSearchParams();

        if (facts.search !== "") {
          params.set("q", facts.search as string);
        }
        if (facts.category !== "" && facts.category !== "all") {
          params.set("cat", facts.category as string);
        }
        if (facts.sortBy !== "newest") {
          params.set("sort", facts.sortBy as string);
        }
        if ((facts.page as number) > 1) {
          params.set("page", String(facts.page));
        }

        const search = params.toString();
        const newUrl = search
          ? `${window.location.pathname}?${search}`
          : window.location.pathname;

        if (newUrl !== `${window.location.pathname}${window.location.search}`) {
          history.replaceState(null, "", newUrl);
        }
      },
    },
  },
});

// ============================================================================
// Products Module — Schema
// ============================================================================

export const productsSchema = {
  facts: {
    items: t.object<Product[]>(),
    totalItems: t.number(),
    isLoading: t.boolean(),
    itemsPerPage: t.number(),
  },
  derivations: {
    totalPages: t.number(),
    currentPageDisplay: t.string(),
  },
  events: {
    setItemsPerPage: { value: t.number() },
  },
  requirements: {
    FETCH_PRODUCTS: {
      search: t.string(),
      category: t.string(),
      sortBy: t.string(),
      page: t.number(),
      itemsPerPage: t.number(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Products Module
// ============================================================================

export const productsModule = createModule("products", {
  schema: productsSchema,

  crossModuleDeps: { url: urlSchema },

  init: (facts) => {
    facts.items = [];
    facts.totalItems = 0;
    facts.isLoading = false;
    facts.itemsPerPage = 10;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    totalPages: (facts) => {
      if (facts.self.totalItems === 0) {
        return 0;
      }

      return Math.ceil(facts.self.totalItems / facts.self.itemsPerPage);
    },

    currentPageDisplay: (facts) => {
      const total = facts.self.totalItems;
      if (total === 0) {
        return "No results";
      }

      const page = facts.url.page;
      const perPage = facts.self.itemsPerPage;
      const start = (page - 1) * perPage + 1;
      const end = Math.min(page * perPage, total);

      return `${start}\u2013${end} of ${total}`;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setItemsPerPage: (facts, { value }) => {
      facts.itemsPerPage = value;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    fetchProducts: {
      priority: 100,
      when: () => true,
      require: (facts) => ({
        type: "FETCH_PRODUCTS",
        search: facts.url.search,
        category: facts.url.category,
        sortBy: facts.url.sortBy,
        page: facts.url.page,
        itemsPerPage: facts.self.itemsPerPage,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    fetchProducts: {
      requirement: "FETCH_PRODUCTS",
      key: (req) =>
        `fetch-${req.search}-${req.category}-${req.sortBy}-${req.page}-${req.itemsPerPage}`,
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.isLoading = true;

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 300));

        const result = filterProducts(allProducts, {
          search: req.search,
          category: req.category,
          sortBy: req.sortBy,
          page: req.page,
          itemsPerPage: req.itemsPerPage,
        });

        context.facts.items = result.items;
        context.facts.totalItems = result.totalItems;
        context.facts.isLoading = false;
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: {
    url: urlModule,
    products: productsModule,
  },
  plugins: [devtoolsPlugin({ name: "url-sync" })],
});
