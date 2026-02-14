---
title: Migration Guides
description: Step-by-step guides for migrating from Redux, Zustand, or XState to Directive.
---

Migrate your existing state management to Directive with concept-by-concept guides and automated analysis tools. {% .lead %}

---

## Available Guides

| From | Page | Key Mapping |
|------|------|------------|
| [Redux](/docs/migration/from-redux) | Slices → Modules, actions → events, selectors → derivations, thunks → resolvers |
| [Zustand](/docs/migration/from-zustand) | Stores → Modules, set → events, get → derivations, middleware → plugins |
| [XState](/docs/migration/from-xstate) | Machines → Modules, states → facts, transitions → events, services → resolvers |

---

## Migration Strategy

All three guides follow the same pattern:

1. **Analyze** – Map your existing concepts to Directive equivalents
2. **Create module** – Define schema, init, events, derive, constraints, resolvers
3. **Coexist** – Run both systems side-by-side using [subscribe/watch interop](/docs/works-with/overview)
4. **Migrate UI** – Replace store hooks with Directive hooks
5. **Remove old store** – Once fully migrated, remove the old state library

---

## Automated Analysis

Directive provides analysis utilities that inspect your existing store and generate a migration plan:

```typescript
import { analyzeReduxSlice, generateMigrationChecklist } from '@directive-run/core';

// Point the analyzer at your existing Redux slice
const analysis = analyzeReduxSlice({
  name: 'todos',
  reducers: todosSlice.reducer,
  actions: todosSlice.actions,
});

// Generate a step-by-step checklist mapping Redux concepts to Directive equivalents
const checklist = generateMigrationChecklist(analysis);
```

---

## Next Steps

- **Coming from Redux?** Start with [From Redux](/docs/migration/from-redux)
- **Coming from Zustand?** Start with [From Zustand](/docs/migration/from-zustand)
- **Coming from XState?** Start with [From XState](/docs/migration/from-xstate)
- **Prefer incremental adoption?** See [Works With](/docs/works-with/overview) to run both side-by-side
