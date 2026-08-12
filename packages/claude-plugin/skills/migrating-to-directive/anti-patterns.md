# Anti-Patterns

> Covers `@directive-run/core` and `@directive-run/react` — hallucination-prone API patterns to avoid.

22 most common mistakes when generating Directive code, ranked by AI hallucination frequency. Every code generation MUST be checked against this list.

## 1. Unnecessary Type Casting on Facts/Derivations

```typescript
// WRONG – schema already provides the type
const profile = system.facts.profile as ResourceState<Profile>;

// CORRECT – trust the schema
const profile = system.facts.profile;
```

## 2. Flat Schema (Missing facts Wrapper)

```typescript
// WRONG – facts must be nested under schema.facts
createModule("counter", {
  schema: {
    phase: t.string(),
    count: t.number(),
  },
});

// CORRECT
createModule("counter", {
  schema: {
    facts: {
      phase: t.string(),
      count: t.number(),
    },
  },
});
```

## 3. Bare `facts.*` in Multi-Module Constraints

```typescript
// WRONG – multi-module constraints use facts.self for own module
constraints: {
  checkItems: {
    when: (facts) => facts.items.length > 0,
    require: { type: "PROCESS" },
  },
},

// CORRECT – use facts.self.* for own module facts
constraints: {
  checkItems: {
    when: (facts) => facts.self.items.length > 0,
    require: { type: "PROCESS" },
  },
},
```

## 4. Reaching Back Through `system.derive` Inside a Constraint or Effect

```typescript
// WRONG – closing over system.derive to read this module's own derivation
constraints: {
  trim: {
    when: () => system.derive.itemCount > 100,
    require: { type: "TRIM_CART" },
  },
},

effects: {
  warn: {
    run: (facts, prev) => {
      if (system.derive.itemCount > 100) {
        console.warn("cart is large");
      }
    },
  },
},

// CORRECT – derived is the second argument to when()/require(),
// and the third to run(), after facts and prev
constraints: {
  trim: {
    when: (_facts, derived) => derived.itemCount > 100,
    require: { type: "TRIM_CART" },
  },
},

effects: {
  warn: {
    run: (facts, prev, derived) => {
      if (derived.itemCount > 100) {
        console.warn("cart is large");
      }
    },
  },
},
```

**Why:** `system.derive` is the single-module accessor. `createSystem({ module })` puts a module's derivations directly on it; `createSystem({ modules })` puts a module *name* there and the derivations one level down. The identical read that returned a number alone returns `undefined` once composed — the gate goes falsy, nothing fires, nothing is logged. A module that worked standalone breaks silently the moment it joins a system. `derived` is scoped to the reading module, so it means the same thing in both shapes.

## 5. Nonexistent Schema Builders

```typescript
// WRONG – t.map(), t.set(), t.promise() do not exist
schema: {
  facts: {
    cache: t.map<string, User>(),
    tags: t.set<string>(),
    pending: t.promise<Data>(),
  },
},

// CORRECT – use t.object() with type parameter
schema: {
  facts: {
    cache: t.object<Map<string, User>>(),
    tags: t.object<Set<string>>(),
    pending: t.object<Promise<Data>>(),
  },
},
```

## 6. Abbreviating `context` to `ctx`

```typescript
// WRONG – never abbreviate context
resolve: async (req, ctx) => {
  ctx.facts.status = "done";
},

// CORRECT – always spell out context
resolve: async (req, context) => {
  context.facts.status = "done";
},
```

## 7. Flat Module Config (No schema Wrapper)

```typescript
// WRONG – properties must be inside schema.facts
createModule("timer", {
  phase: t.string(),
  elapsed: t.number(),
});

// CORRECT – wrap in schema: { facts: {} }
createModule("timer", {
  schema: {
    facts: {
      phase: t.string(),
      elapsed: t.number(),
    },
  },
});
```

## 8. String-Based Event Dispatch

```typescript
// WRONG – there is no two-argument string-keyed dispatch signature
system.dispatch("login", { token: "abc" });

// CORRECT – use the typed events accessor (preferred — autocomplete + payload typing)
system.events.login({ token: "abc" });

// ALSO VALID – the single-arg object form of dispatch() is supported when you
// need to forward a programmatically-built event. Prefer the events accessor
// for normal code.
system.dispatch({ type: "login", token: "abc" });
```

## 9. Direct Array/Object Mutation

```typescript
// WRONG – proxy cannot detect in-place mutations
facts.items.push(item);
facts.config.theme = "dark";

// CORRECT – replace the entire value
facts.items = [...facts.items, item];
facts.config = { ...facts.config, theme: "dark" };
```

## 10. Nonexistent `useDirective` Hook

```typescript
// WRONG – there is no useDirective hook
const state = useDirective(system);

// CORRECT – use useSelector with a selector function
const count = useSelector(system, (s) => s.facts.count);
const isLoading = useSelector(system, (s) => s.derive.isLoading);
```

## 11. Bracket Notation for Namespaced Facts

```typescript
// WRONG – internal separator is not part of the public API
const status = facts["auth::status"];
const token = facts["auth_token"];

// CORRECT – use dot notation through the namespace proxy
const status = facts.auth.status;
const token = facts.auth.token;
```

## 12. Returning Data from Resolvers

```typescript
// WRONG – resolvers return void, not data
resolve: async (req, context) => {
  const user = await fetchUser(req.userId);

  return user; // Return value is ignored
},

// CORRECT – mutate context.facts to store results
resolve: async (req, context) => {
  const user = await fetchUser(req.userId);
  context.facts.user = user;
},
```

## 13. Async Logic in `init`

```typescript
// WRONG – init is synchronous, facts assignment only
init: async (facts) => {
  const data = await fetch("/api/config");
  facts.config = await data.json();
},

// CORRECT – init sets defaults; use constraints/resolvers for async work
init: (facts) => {
  facts.config = null;
  facts.phase = "loading";
},

constraints: {
  loadConfig: {
    when: (facts) => facts.config === null,
    require: { type: "LOAD_CONFIG" },
  },
},
```

## 14. Missing `settle()` After `start()`

```typescript
// WRONG – constraints fire on start, resolvers are async
system.start();
console.log(system.facts.data); // May still be null

// CORRECT – wait for resolvers to complete
system.start();
await system.settle();
console.log(system.facts.data); // Resolved
```

## 15. Missing `crossModuleDeps` Declaration

```typescript
// WRONG – accessing auth facts without declaring dependency
const dataModule = createModule("data", {
  schema: { facts: { items: t.array(t.string()) } },
  constraints: {
    fetchWhenAuth: {
      when: (facts) => facts.auth.isAuthenticated, // Type error
      require: { type: "FETCH" },
    },
  },
});

// CORRECT – declare crossModuleDeps for type-safe cross-module access
const dataModule = createModule("data", {
  schema: { facts: { items: t.array(t.string()) } },
  crossModuleDeps: { auth: authSchema },
  constraints: {
    fetchWhenAuth: {
      when: (facts) => facts.auth.isAuthenticated,
      require: { type: "FETCH" },
    },
  },
});
```

## 16. String Literal for `require`

```typescript
// WRONG – require must be an object with type property
constraints: {
  check: {
    when: (facts) => facts.ready,
    require: "FETCH_DATA",
  },
},

// CORRECT – use object form with type
constraints: {
  check: {
    when: (facts) => facts.ready,
    require: { type: "FETCH_DATA" },
  },
},
```

## 17. Passthrough Derivations

```typescript
// WRONG – derivation just returns a fact value unchanged
derive: {
  count: (facts) => facts.count,
},

// CORRECT – remove it, read the fact directly instead
// system.facts.count instead of system.derive.count
```

## 18. Deep Import Paths

```typescript
// WRONG – internal module paths are not public API
import { createModule } from "@directive-run/core/module";
import { createSystem } from "@directive-run/core/system";

// CORRECT – import from package root
import { createModule, createSystem } from "@directive-run/core";

// Exception: plugins have their own entry point
import { loggingPlugin } from "@directive-run/core/plugins";
```

## 19. Async `when()` Without `deps`

```typescript
// WRONG – async constraints need explicit deps for tracking
constraints: {
  validate: {
    async: true,
    when: async (facts) => {
      const valid = await checkRemote(facts.token);

      return valid;
    },
    require: { type: "REFRESH_TOKEN" },
  },
},

// CORRECT – add deps array for async constraints
constraints: {
  validate: {
    async: true,
    deps: ["token"],
    when: async (facts) => {
      const valid = await checkRemote(facts.token);

      return valid;
    },
    require: { type: "REFRESH_TOKEN" },
  },
},
```

## 20. No Error Handling on Failing Resolvers

```typescript
// WRONG – unhandled errors crash the system
resolvers: {
  fetchData: {
    requirement: "FETCH",
    resolve: async (req, context) => {
      const res = await fetch("/api/data");
      context.facts.data = await res.json();
    },
  },
},

// CORRECT – use retry policy and/or module error boundary
resolvers: {
  fetchData: {
    requirement: "FETCH",
    retry: { attempts: 3, backoff: "exponential" },
    resolve: async (req, context) => {
      const res = await fetch("/api/data");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      context.facts.data = await res.json();
    },
  },
},

// Also set error boundary at system level
const system = createSystem({
  module: myModule,
  errorBoundary: {
    onResolverError: "retry-later",
  },
});
```

## 21. Hand-Rolled External Subscriptions Inside React/`useEffect`

When wrapping an external event stream (Supabase realtime, WebSocket, polling timer, browser listener) into a Directive system, do NOT write a React `useEffect` that owns the subscription and dispatches `sys.events.X()` from the callback — declare a `source` on the module instead. The runtime owns the mount / unmount lifecycle and observability. The component collapses to fact reads.

```typescript
// WRONG – subscription lives in component code; module never knows about it.
// On every remount you get duplicate channels; on unmount you can leak.
function Game({ system, gameId }: Props) {
  useEffect(() => {
    const ch = supabase
      .channel(`game:${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', table: 'games' }, (payload) => {
        system.events.realtimeUpdate({ snapshot: mapRow(payload.new) });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);
  return <Board snapshot={useFact(system, 'snapshot')} />;
}

// CORRECT – declare a `source` on the module. The runtime owns the
// mount / unmount lifecycle and observability. The component collapses
// to fact reads.
const gameModule = createModule('game', {
  schema: {
    facts: { snapshot: t.object<GameSnapshot>().nullable() },
    events: { realtimeUpdate: { snapshot: t.object<GameSnapshot>() } },
  },
  sources: {
    realtime: {
      attach: (publish) => {
        const ch = supabase
          .channel(`game:${gameId}`)
          .on('postgres_changes', { event: 'UPDATE', table: 'games' },
            (p) => publish('realtimeUpdate', { snapshot: mapRow(p.new) }))
          .subscribe();
        return () => { supabase.removeChannel(ch); };
      },
    },
  },
  on: { realtimeUpdate: (f, p) => { f.snapshot = p.snapshot; } },
});
```

**Why:** the hook-as-bridge pattern duplicates lifecycle code at every call site. Cleanup correctness drifts. `system.observe()` can't see the subscription. With a `source`, the engine attaches at `start()`, detaches at `stop()`, isolates failures, and emits `source.attach` / `.publish` / `.detach` / `.error` observation events for plugins.

**Don't subscribe in both an effect AND a source on the same channel** — the effect re-runs on fact changes, the source mounts once, you'll get 2× messages with silent duplicates. Pick one.

See [`sources.md`](./sources.md) for the full decision tree, recipes (Supabase / WebSocket / browser events / polling), and the typed-publish factory pattern.

## 22. Abbreviating Type Names (`*Def` instead of `*Definition`)

```typescript
// WRONG – `Def` is short for `Definition`. Same anti-pattern as `ctx`
// → `context` (entry #6). Source code reads better with spelled-out
// names; the minifier handles the bytes either way.
import type { ModuleDef, SourceDef, ResolverDef } from "@directive-run/core";

// CORRECT – use the spelled-out aliases. `*Def` stays canonical in 1.x
// for back-compat; consumers can migrate today.
import type {
  ModuleDefinition,
  SourceDefinition,
  ResolverDefinition,
} from "@directive-run/core";
```

The `*Definition` aliases ship in 1.x via `export type { X as XDefinition }`
in `packages/core/src/core/types/index.ts`, so generic forwarding +
TS inference rules (mapped types, conditional distribution, tagged-
union discrimination, barrel re-exports) match the canonical `*Def`
form bit-for-bit. **2.0 swaps:** `*Definition` becomes canonical and
`*Def` becomes the deprecated alias. Start writing `*Definition` in
new code today so the 2.0 migration is a no-op.

Per RFC 0006, this applies to:

- `ModuleDef` → `ModuleDefinition`
- `ConstraintDef` / `ConstraintsDef` → `ConstraintDefinition` / `ConstraintsDefinition`
- `ResolverDef` / `ResolversDef` → `ResolverDefinition` / `ResolversDefinition`
- `DerivationDef` / `DerivationsDef` → `DerivationDefinition` / `DerivationsDefinition`
- `EffectDef` / `EffectsDef` → `EffectDefinition` / `EffectsDefinition`
- `EventsDef` → `EventsDefinition`
- `SourceDef` / `SourcesDef` → `SourceDefinition` / `SourcesDefinition`
- `SourcePublish` → `SourcePublishFn`, `SourceUnsubscribe` → `SourceUnsubscribeFn`
- Plus all `Typed*Def`, `CrossModule*Def`, `Dynamic*Def` variants.

`EffectCleanup`, `MetaAccessor`, `EventsAccessor`, `DeriveAccessor`,
`Snapshot` are explicitly kept as-is (each has reasoning recorded in
RFC 0006).

## Quick Reference Checklist

Before generating any Directive code, verify:

1. Schema is nested: `schema: { facts: { ... } }` (not flat)
2. No `as` casts when reading facts or derivations
3. Resolver params are `(req, context)` not `(req, ctx)`
4. `require` is an object `{ type: "..." }` not a string
5. `init()` is synchronous
6. Resolvers return void and mutate `context.facts`
7. Arrays/objects replaced, not mutated in place
8. Multi-module uses `facts.self.*` for own facts
9. Imports from `@directive-run/core`, not deep paths
10. `await system.settle()` after `system.start()`
11. External event subscriptions live in `sources:`, not in `useEffect` or `onMount`
12. Constraints and effects read their own derivations through the `derived` parameter, never through a closed-over `system.derive`

## See also

- [`naming.md`](./naming.md) — the strict canonical-term rules AND the alias map for cross-paradigm searches
- [`sources.md`](./sources.md) — the source primitive (the right answer for #21)
- [`constraints.md`](./constraints.md) — the constraint shape these anti-patterns reference (`facts` not in scope inside static `require:`, etc.)
- [`resolvers.md`](./resolvers.md) — the resolver shape these anti-patterns reference (return `void`, mutate `context.facts`, `(req, context)` not `(req, ctx)`)
- [`schema-types.md`](./schema-types.md) — the `t.*()` builders that exist and the hallucinated ones (`t.map`, `t.set`, `t.promise`, `t.date`) that don't
- [`react-adapter.md`](./react-adapter.md) — the React hooks that exist and the hallucinated ones (`useEvent`, `useSystem`, `DirectiveProvider`) that don't
- [`error-boundaries.md`](./error-boundaries.md) — error-handling shapes AI assistants sometimes invent
