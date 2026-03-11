# Anti-Patterns

19 most common mistakes when generating Directive code, ranked by AI hallucination frequency. Every code generation MUST be checked against this list.

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

## 4. Nonexistent Schema Builders

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

## 5. Abbreviating `context` to `ctx`

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

## 6. Flat Module Config (No schema Wrapper)

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

## 7. String-Based Event Dispatch

```typescript
// WRONG – events are not dispatched by string
system.dispatch("login", { token: "abc" });

// CORRECT – use the events accessor
system.events.login({ token: "abc" });
```

## 8. Direct Array/Object Mutation

```typescript
// WRONG – proxy cannot detect in-place mutations
facts.items.push(item);
facts.config.theme = "dark";

// CORRECT – replace the entire value
facts.items = [...facts.items, item];
facts.config = { ...facts.config, theme: "dark" };
```

## 9. Nonexistent `useDirective` Hook

```typescript
// WRONG – there is no useDirective hook
const state = useDirective(system);

// CORRECT – use useSelector with a selector function
const count = useSelector(system, (s) => s.facts.count);
const isLoading = useSelector(system, (s) => s.derive.isLoading);
```

## 10. Bracket Notation for Namespaced Facts

```typescript
// WRONG – internal separator is not part of the public API
const status = facts["auth::status"];
const token = facts["auth_token"];

// CORRECT – use dot notation through the namespace proxy
const status = facts.auth.status;
const token = facts.auth.token;
```

## 11. Returning Data from Resolvers

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

## 12. Async Logic in `init`

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

## 13. Missing `settle()` After `start()`

```typescript
// WRONG – constraints fire on start, resolvers are async
system.start();
console.log(system.facts.data); // May still be null

// CORRECT – wait for resolvers to complete
system.start();
await system.settle();
console.log(system.facts.data); // Resolved
```

## 14. Missing `crossModuleDeps` Declaration

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

## 15. String Literal for `require`

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

## 16. Passthrough Derivations

```typescript
// WRONG – derivation just returns a fact value unchanged
derive: {
  count: (facts) => facts.count,
},

// CORRECT – remove it, read the fact directly instead
// system.facts.count instead of system.derive.count
```

## 17. Deep Import Paths

```typescript
// WRONG – internal module paths are not public API
import { createModule } from "@directive-run/core/module";
import { createSystem } from "@directive-run/core/system";

// CORRECT – import from package root
import { createModule, createSystem } from "@directive-run/core";

// Exception: plugins have their own entry point
import { loggingPlugin } from "@directive-run/core/plugins";
```

## 18. Async `when()` Without `deps`

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

## 19. No Error Handling on Failing Resolvers

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
