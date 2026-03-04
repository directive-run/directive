---
title: How to Debounce Constraint Evaluation
description: Prevent constraints from firing too frequently during rapid input with Directive.
---

Prevent constraints from firing too frequently during rapid user input. {% .lead %}

---

## The Problem

When a user types in a search box, each keystroke updates a fact, which triggers constraint evaluation, which emits a requirement, which fires a resolver. Without debouncing, a 10-character search query fires 10 API calls. The first 9 are wasted work, and their responses may arrive out of order, showing stale results.

## The Solution

```typescript
import { createModule, t } from '@directive-run/core';

const search = createModule('search', {
  schema: {
    facts: {
      query: t.string(),
      debouncedQuery: t.string(),
      results: t.array<{ id: string; title: string }>(),
      isSearching: t.boolean(),
    },
  },

  init: (facts) => {
    facts.query = '';
    facts.debouncedQuery = '';
    facts.results = [];
    facts.isSearching = false;
  },

  // Note: This effect intentionally writes to facts. The debounce pattern is
  // a valid exception to the "effects shouldn't mutate facts" guideline – the
  // delayed copy is specifically designed to throttle downstream constraint
  // evaluation without triggering re-entrant loops.
  effects: {
    // Debounce: copy query → debouncedQuery after 300ms of inactivity
    debounceQuery: {
      deps: ['query'],
      run: (facts) => {
        const timer = setTimeout(() => {
          facts.debouncedQuery = facts.query;
        }, 300);

        // Cleanup cancels the timer if query changes again
        return () => clearTimeout(timer);
      },
    },
  },

  constraints: {
    // Fires only on debouncedQuery, not raw keystrokes
    needsSearch: {
      when: (facts) =>
        facts.debouncedQuery.length >= 2 &&
        !facts.isSearching,
      require: (facts) => ({
        type: 'SEARCH',
        query: facts.debouncedQuery,
      }),
    },
  },

  resolvers: {
    search: {
      requirement: 'SEARCH',
      // Key by query – if debouncedQuery changes while in-flight,
      // the old request is superseded
      key: (req) => `search-${req.query}`,
      resolve: async (req, context) => {
        context.facts.isSearching = true;
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(req.query)}`);
          if (!res.ok) {
            throw new Error(`Search failed: ${res.status}`);
          }

          const data = await res.json();
          // Only apply if this is still the current query
          if (context.facts.debouncedQuery === req.query) {
            context.facts.results = data.results;
          }
        } finally {
          context.facts.isSearching = false;
        }
      },
    },
  },
});
```

```tsx
function SearchBox({ system }) {
  const { facts } = useDirective(system);

  return (
    <div>
      <input
        value={facts.query}
        onChange={(e) => { system.facts.query = e.target.value; }}
        placeholder="Search..."
      />
      {facts.isSearching && <Spinner />}
      <ul>
        {facts.results.map((r) => (
          <li key={r.id}>{r.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Step by Step

1. **`query` updates on every keystroke** – the input writes directly to `facts.query`, giving instant feedback in the text field.

2. **Effect debounces** – `debounceQuery` sets a 300ms timer. Each new keystroke triggers cleanup (cancels the old timer) and starts a new one. Only when typing pauses for 300ms does `debouncedQuery` update.

3. **Constraint watches `debouncedQuery`** – since `needsSearch` reads `debouncedQuery` (not `query`), it only evaluates after the debounce settles.

4. **Resolver key prevents stale results** – `key: (req) => \`search-${req.query}\`` ensures each unique query gets its own resolution. If the user types again before the previous search completes, the old result is ignored.

## Common Variations

### Throttle instead of debounce

```typescript
effects: {
  throttleQuery: {
    deps: ['query'],
    run: (facts) => {
      // Fire immediately, then ignore for 500ms
      facts.debouncedQuery = facts.query;
      let blocked = true;
      const timer = setTimeout(() => { blocked = false; }, 500);

      return () => clearTimeout(timer);
    },
  },
},
```

### Minimum character guard in the constraint

```typescript
constraints: {
  needsSearch: {
    when: (facts) =>
      facts.debouncedQuery.length >= 3 && // Min 3 chars
      facts.debouncedQuery !== facts.lastSearchedQuery, // Don't re-search same query
    require: (facts) => ({
      type: 'SEARCH',
      query: facts.debouncedQuery,
    }),
  },
},
```

## Related

- [Effects](/docs/effects) – cleanup functions and dependency tracking
- [Constraints](/docs/constraints) – evaluation lifecycle
- [Resolvers](/docs/resolvers) – `key` for deduplication
- [Batch Mutations](/docs/guides/batch-mutations) – atomic updates
