---
title: How to Sync State with the URL
description: Build bidirectional URL-state synchronization so filters, sort order, and pages survive refresh and are shareable via links.
---

Bidirectional URL↔state sync — filters, sort, and pagination in the URL bar, always in sync, always shareable. {% .lead %}

---

## The Problem

Every SPA with filterable lists or shareable views needs URL-state sync. Users expect to bookmark a filtered view, share it, and hit back/forward to navigate. The persist-state guide covers localStorage but not URL params. Naively syncing URL→state→URL creates infinite loops. Deciding which facts belong in the URL (filters: yes, loading state: no) requires careful separation.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

interface Filters {
  search: string;
  category: string;
  sortBy: string;
}

const url = createModule('url', {
  schema: {
    search: t.string(),
    category: t.string(),
    sortBy: t.string(),
    page: t.number(),
    syncingFromUrl: t.boolean(),
  },

  init: (facts) => {
    const params = new URLSearchParams(window.location.search);
    facts.search = params.get('q') || '';
    facts.category = params.get('cat') || 'all';
    facts.sortBy = params.get('sort') || 'newest';
    facts.page = parseInt(params.get('page') || '1', 10);
    facts.syncingFromUrl = false;
  },

  events: {
    setSearch: (facts, { value }: { value: string }) => {
      facts.search = value;
      facts.page = 1;
    },
    setCategory: (facts, { value }: { value: string }) => {
      facts.category = value;
      facts.page = 1;
    },
    setSortBy: (facts, { value }: { value: string }) => {
      facts.sortBy = value;
      facts.page = 1;
    },
    setPage: (facts, { value }: { value: number }) => {
      facts.page = value;
    },
    syncFromUrl: (facts, { search, category, sortBy, page }: Filters & { page: number }) => {
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

  effects: {
    urlToState: {
      run: (facts) => {
        const handler = () => {
          const params = new URLSearchParams(window.location.search);
          facts.syncingFromUrl = true;
          facts.search = params.get('q') || '';
          facts.category = params.get('cat') || 'all';
          facts.sortBy = params.get('sort') || 'newest';
          facts.page = parseInt(params.get('page') || '1', 10);
          // Break the loop: mark sync complete after mutations settle
          setTimeout(() => { facts.syncingFromUrl = false; }, 0);
        };
        window.addEventListener('popstate', handler);

        return () => window.removeEventListener('popstate', handler);
      },
    },
    stateToUrl: {
      deps: ['search', 'category', 'sortBy', 'page'],
      run: (facts) => {
        if (facts.syncingFromUrl) {
          return;
        }

        const params = new URLSearchParams();
        if (facts.search) {
          params.set('q', facts.search);
        }
        if (facts.category !== 'all') {
          params.set('cat', facts.category);
        }
        if (facts.sortBy !== 'newest') {
          params.set('sort', facts.sortBy);
        }
        if (facts.page > 1) {
          params.set('page', String(facts.page));
        }

        const url = `${window.location.pathname}${params.toString() ? '?' + params : ''}`;
        history.replaceState(null, '', url);
      },
    },
  },
});

const products = createModule('products', {
  schema: {
    items: t.object<Array<{ id: string; name: string; category: string }>>(),
    isLoading: t.boolean(),
  },

  init: (facts) => {
    facts.items = [];
    facts.isLoading = false;
  },

  constraints: {
    needsProducts: {
      crossModuleDeps: ['url.search', 'url.category', 'url.sortBy', 'url.page'],
      when: (facts) => !facts.isLoading,
      require: (facts, derive, cross) => ({
        type: 'FETCH_PRODUCTS',
        search: cross.url.search,
        category: cross.url.category,
        sortBy: cross.url.sortBy,
        page: cross.url.page,
      }),
    },
  },

  resolvers: {
    fetchProducts: {
      requirement: 'FETCH_PRODUCTS',
      resolve: async (req, context) => {
        context.facts.isLoading = true;
        const params = new URLSearchParams({
          q: req.search,
          cat: req.category,
          sort: req.sortBy,
          page: String(req.page),
        });
        const res = await fetch(`/api/products?${params}`);
        const data = await res.json();
        context.facts.items = data.items;
        context.facts.isLoading = false;
      },
    },
  },
});

const system = createSystem({
  modules: { url, products },
});
```

```tsx
function ProductList({ system }) {
  const search = useFact(system, 'url::search');
  const items = useFact(system, 'products::items');
  const isLoading = useFact(system, 'products::isLoading');

  return (
    <div>
      <input
        value={search}
        onChange={(e) => system.events.setSearch({ value: e.target.value })}
        placeholder="Search products..."
      />
      {isLoading ? <Spinner /> : (
        <ul>
          {items.map((item) => <li key={item.id}>{item.name}</li>)}
        </ul>
      )}
    </div>
  );
}
```

## Step by Step

1. **`syncingFromUrl` guard flag** prevents infinite loops. When `popstate` fires and updates facts, the `stateToUrl` effect sees `syncingFromUrl = true` and skips the URL write. After a microtask, `syncComplete` resets the flag.

2. **`init` reads URL params** — on first load, facts are populated from the current URL. No separate "initialize from URL" step needed.

3. **`stateToUrl` effect** only writes URL params that differ from defaults. A search of `""`, category of `"all"`, sort of `"newest"`, and page `1` produce a clean URL with no query string.

4. **Page resets on filter change** — the `setSearch`, `setCategory`, and `setSortBy` events all reset `page` to 1. Changing a filter always starts from the first page.

5. **Products module uses `crossModuleDeps`** to react to URL fact changes. The constraint re-evaluates whenever any URL fact changes, triggering a fresh fetch.

## Common Variations

### Using `history.pushState` for back/forward navigation

Replace `replaceState` with `pushState` when you want each filter change to create a browser history entry:

```typescript
history.pushState(null, '', url);
```

### Custom URL persistence plugin

Encapsulate the pattern as a reusable plugin:

```typescript
function urlSyncPlugin(config: { params: Record<string, { fact: string; default: string }> }) {
  return {
    name: 'url-sync',
    onInit: ({ system }) => { /* read URL → facts */ },
    onFactChange: ({ key, value }) => { /* facts → URL */ },
  };
}
```

### Transient state exclusion

Never put these in the URL: `isLoading`, `error`, `isSubmitting`, temporary UI state. Only sync facts that represent user intent (search, filters, sort, page).

## Related

- [Interactive Example](/docs/examples/url-sync) — try it in your browser
- [Persist State](/docs/guides/persist-state) — localStorage persistence
- [Effects](/docs/effects) — cleanup and subscriptions
- [Batch Mutations](/docs/guides/batch-mutations) — coalescing URL updates
- [Choosing Primitives](/docs/choosing-primitives) — effects vs events for sync
