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

1. **Analyze** — Map your existing concepts to Directive equivalents
2. **Create module** — Define schema, init, events, derive, constraints, resolvers
3. **Bridge** — Run both systems side-by-side using a [state bridge](/docs/bridges/overview)
4. **Migrate UI** — Replace store hooks with Directive hooks
5. **Remove bridge** — Once fully migrated, remove the old store

---

## Automated Analysis

Directive provides analysis utilities that inspect your existing store and generate a migration plan:

```typescript
import { analyzeReduxSlice, generateMigrationChecklist } from 'directive';

const analysis = analyzeReduxSlice({
  name: 'todos',
  reducers: todosSlice.reducer,
  actions: todosSlice.actions,
});

const checklist = generateMigrationChecklist(analysis);
```

---

## Next Steps

- **Coming from Redux?** Start with [From Redux](/docs/migration/from-redux)
- **Prefer incremental adoption?** See [State Bridges](/docs/bridges/overview) to run both side-by-side
