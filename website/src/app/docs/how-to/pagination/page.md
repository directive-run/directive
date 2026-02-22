---
title: How to Build Pagination & Infinite Scroll
description: Implement cursor-based pagination with infinite scroll, filter-aware resets, and duplicate-free page appending using Directive.
---

Cursor-based pagination with infinite scroll, automatic loading, and filter-aware resets — no duplicate fetches, no lost data. {% .lead %}

---

## The Problem

The data fetching guide shows single-entity fetch. Real apps need paginated lists: modeling `cursor`/`hasMore`, appending pages without losing previous data, preventing duplicate fetches during rapid scrolling, and resetting to page 1 when filters change. Imperative approaches scatter this across scroll handlers, state hooks, and effect cleanup — leading to race conditions and stale data.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { loggingPlugin } from '@directive-run/core/plugins';

interface ListItem {
  id: string;
  title: string;
  category: string;
}

const filters = createModule('filters', {
  schema: {
    search: t.string(),
    sortBy: t.string<'newest' | 'oldest' | 'title'>(),
    category: t.string(),
  },

  init: (facts) => {
    facts.search = '';
    facts.sortBy = 'newest';
    facts.category = 'all';
  },

  events: {
    setSearch: (facts, { value }: { value: string }) => {
      facts.search = value;
    },
    setSortBy: (facts, { value }: { value: 'newest' | 'oldest' | 'title' }) => {
      facts.sortBy = value;
    },
    setCategory: (facts, { value }: { value: string }) => {
      facts.category = value;
    },
  },
});

const list = createModule('list', {
  schema: {
    items: t.object<ListItem[]>(),
    cursor: t.string(),
    hasMore: t.boolean(),
    isLoadingMore: t.boolean(),
    scrollNearBottom: t.boolean(),
    lastFilterHash: t.string(),
  },

  init: (facts) => {
    facts.items = [];
    facts.cursor = '';
    facts.hasMore = true;
    facts.isLoadingMore = false;
    facts.scrollNearBottom = false;
    facts.lastFilterHash = '';
  },

  derive: {
    totalLoaded: (facts) => facts.items.length,
    isEmpty: (facts) => facts.items.length === 0 && !facts.hasMore,
  },

  constraints: {
    loadMore: {
      crossModuleDeps: ['filters.search', 'filters.sortBy', 'filters.category'],
      when: (facts) => {
        return facts.hasMore && !facts.isLoadingMore && facts.scrollNearBottom;
      },
      require: (facts) => ({
        type: 'LOAD_PAGE',
        cursor: facts.cursor,
      }),
    },
    filterChanged: {
      crossModuleDeps: ['filters.search', 'filters.sortBy', 'filters.category'],
      when: (facts, derive, cross) => {
        const hash = `${cross.filters.search}|${cross.filters.sortBy}|${cross.filters.category}`;

        return hash !== facts.lastFilterHash;
      },
      require: { type: 'RESET_AND_LOAD' },
    },
  },

  resolvers: {
    loadPage: {
      requirement: 'LOAD_PAGE',
      resolve: async (req, context) => {
        context.facts.isLoadingMore = true;
        const res = await fetch(`/api/items?cursor=${req.cursor}&limit=20`);
        const data = await res.json();

        context.facts.items = [...context.facts.items, ...data.items];
        context.facts.cursor = data.nextCursor || '';
        context.facts.hasMore = data.hasMore;
        context.facts.isLoadingMore = false;
      },
    },
    resetAndLoad: {
      requirement: 'RESET_AND_LOAD',
      resolve: async (req, context) => {
        context.facts.items = [];
        context.facts.cursor = '';
        context.facts.hasMore = true;
        context.facts.isLoadingMore = true;
        context.facts.lastFilterHash = `${context.facts.search}|${context.facts.sortBy}|${context.facts.category}`;

        const res = await fetch('/api/items?cursor=&limit=20');
        const data = await res.json();

        context.facts.items = data.items;
        context.facts.cursor = data.nextCursor || '';
        context.facts.hasMore = data.hasMore;
        context.facts.isLoadingMore = false;
      },
    },
  },

  effects: {
    observeScroll: {
      run: (facts, prev, { dispatch }) => {
        const sentinel = document.getElementById('scroll-sentinel');
        if (!sentinel) {
          return;
        }

        const observer = new IntersectionObserver(
          ([entry]) => {
            dispatch({ type: 'SET_SCROLL_NEAR_BOTTOM', value: entry.isIntersecting });
          },
          { rootMargin: '200px' },
        );
        observer.observe(sentinel);

        return () => observer.disconnect();
      },
    },
  },

  events: {
    setScrollNearBottom: (facts, { value }: { value: boolean }) => {
      facts.scrollNearBottom = value;
    },
  },
});

const system = createSystem({
  modules: { filters, list },
  plugins: [loggingPlugin()],
});
```

```tsx
function InfiniteList({ system }) {
  const { facts, derived } = useDirective(system);
  const items = facts['list::items'];

  return (
    <div>
      <SearchBar
        value={facts['filters::search']}
        onChange={(v) => system.events.setSearch({ value: v })}
      />
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
      {facts['list::isLoadingMore'] && <Spinner />}
      {facts['list::hasMore'] && <div id="scroll-sentinel" />}
      {derived['list::isEmpty'] && <EmptyState />}
    </div>
  );
}
```

## Step by Step

1. **Two modules** — `filters` owns search/sort/category, `list` owns items and pagination state. Filter changes trigger a full reset via the `filterChanged` constraint.

2. **IntersectionObserver effect** watches a sentinel element at the bottom of the list. When it enters the viewport, `scrollNearBottom` becomes true, triggering the `loadMore` constraint.

3. **`loadMore` constraint** only fires when `hasMore && !isLoadingMore && scrollNearBottom` — three conditions that prevent duplicate fetches during rapid scrolling.

4. **Page appending** — the resolver spreads existing items with new ones: `[...context.facts.items, ...data.items]`. The cursor advances, and `hasMore` is updated from the API response.

5. **Filter reset** — `filterChanged` uses a hash of current filter values to detect changes. The resolver clears items, resets the cursor, and fetches page 1 with the new filters.

6. **`loggingPlugin`** logs every constraint evaluation and resolver execution, making it easy to debug pagination timing in the console.

## Common Variations

### Offset-based pagination

Replace cursor with page number:

```typescript
schema: {
  page: t.number(),
  totalPages: t.number(),
},
constraints: {
  loadMore: {
    when: (facts) => facts.page < facts.totalPages && !facts.isLoadingMore,
    require: (facts) => ({ type: 'LOAD_PAGE', page: facts.page + 1 }),
  },
},
```

### Manual "Load More" button

Remove the IntersectionObserver effect and add a button that dispatches `scrollNearBottom = true`:

```tsx
<button onClick={() => system.events.setScrollNearBottom({ value: true })}>
  Load More
</button>
```

### Optimistic filter resets

Show a skeleton UI immediately while the reset resolver fetches:

```typescript
events: {
  resetForFilter: (facts) => {
    facts.items = [];
    facts.isLoadingMore = true;
  },
},
```

## Related

- [Interactive Example](/docs/examples/pagination) — try it in your browser
- [Loading & Error States](/docs/how-to/loading-states) — status tracking patterns
- [Batch Mutations](/docs/how-to/batch-mutations) — coalescing multiple updates
- [Effects](/docs/effects) — cleanup and IntersectionObserver pattern
- [Choosing Primitives](/docs/choosing-primitives) — constraints vs effects
