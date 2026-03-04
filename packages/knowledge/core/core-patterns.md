# Core Patterns

How to think about building with Directive: modules, systems, and the constraint-resolver pattern.

## Decision Tree: "Where does this logic go?"

```
User wants to...
├── Store state → schema.facts + init()
├── Compute derived values → schema.derivations + derive
├── React to state changes → effects
├── Trigger side effects when conditions are met → constraints + resolvers
├── Handle user actions → schema.events + events handlers
└── Coordinate multiple modules → createSystem({ modules: {} })
```

## Module Shape (Canonical Object Syntax)

```typescript
// CORRECT – full module definition
import { createModule, t } from "@directive-run/core";

const myModule = createModule("name", {
  schema: {
    facts: {
      count: t.number(),
      phase: t.string<"idle" | "loading" | "done">(),
      user: t.object<{ id: string; name: string } | null>(),
    },
    derivations: {
      isLoading: t.boolean(),
      displayName: t.string(),
    },
    events: {
      increment: {},
      setUser: { user: t.object<{ id: string; name: string }>() },
    },
    requirements: {
      FETCH_USER: { userId: t.string() },
    },
  },

  init: (facts) => {
    facts.count = 0;
    facts.phase = "idle";
    facts.user = null;
  },

  derive: {
    isLoading: (facts) => facts.phase === "loading",
    displayName: (facts) => {
      if (!facts.user) {
        return "Guest";
      }

      return facts.user.name;
    },
  },

  effects: {
    logPhase: {
      run: (facts, prev) => {
        if (prev?.phase !== facts.phase) {
          console.log(`Phase: ${facts.phase}`);
        }
      },
    },
  },

  constraints: {
    fetchWhenReady: {
      when: (facts) => facts.phase === "idle" && facts.count > 0,
      require: (facts) => ({ type: "FETCH_USER", userId: "user-1" }),
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.phase = "loading";
        const res = await fetch(`/api/users/${req.userId}`);
        const data = await res.json();
        context.facts.user = data;
        context.facts.phase = "done";
      },
    },
  },

  events: {
    increment: (facts) => {
      facts.count += 1;
    },
    setUser: (facts, payload) => {
      facts.user = payload.user;
    },
  },
});
```

## System Creation

```typescript
import { createSystem } from "@directive-run/core";
import { loggingPlugin, devtoolsPlugin } from "@directive-run/core/plugins";

// Single module – direct access: system.facts.count
const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin(), devtoolsPlugin()],
  debug: { timeTravel: true, maxSnapshots: 100 },
});

// Multi-module – namespaced access: system.facts.auth.token
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
  plugins: [devtoolsPlugin()],
});

// Lifecycle
system.start();
await system.settle(); // Wait for all resolvers to complete
// ... use the system ...
system.stop();
system.destroy();
```

## Decision Tree: "User says 'fetch data when authenticated'"

WRONG thinking: "I'll put the fetch call in a resolver that checks auth."

```typescript
// WRONG – resolver doing condition checking + data fetching
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      if (!context.facts.isAuthenticated) {
        return; // Resolver should not check conditions
      }
      const data = await fetch("/api/data");
      context.facts.data = await data.json();
    },
  },
},
```

CORRECT thinking: "Constraint declares WHEN, resolver declares HOW."

```typescript
// CORRECT – constraint declares the need, resolver fulfills it
constraints: {
  fetchWhenAuthenticated: {
    when: (facts) => facts.isAuthenticated && !facts.data,
    require: { type: "FETCH_DATA" },
  },
},

resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      const data = await fetch("/api/data");
      context.facts.data = await data.json();
    },
  },
},
```

## Reading System State

```typescript
// Facts – mutable state
system.facts.count = 5;
const val = system.facts.count;

// Derivations – read-only computed values
const loading = system.derive.isLoading;

// Events – dispatch user actions
system.events.increment();
system.events.setUser({ user: { id: "1", name: "Alice" } });

// Subscribe to changes
const unsub = system.subscribe(["count", "isLoading"], () => {
  console.log(system.facts.count, system.derive.isLoading);
});

// Watch individual values
system.watch("count", (newVal, oldVal) => {
  console.log(`Count: ${oldVal} -> ${newVal}`);
});

// Wait for a condition
await system.when((facts) => facts.phase === "done");
await system.when((facts) => facts.phase === "done", { timeout: 5000 });
```

## Schema Patterns

Only `facts` is required in the schema. Other sections are optional:

```typescript
// Minimal module – facts only
const minimal = createModule("minimal", {
  schema: {
    facts: { count: t.number() },
  },
  init: (facts) => {
    facts.count = 0;
  },
});

// Type assertion pattern (alternative to t.* builders)
const typed = createModule("typed", {
  schema: {
    facts: {} as { count: number; name: string },
    derivations: {} as { doubled: number },
  },
  init: (facts) => {
    facts.count = 0;
    facts.name = "";
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
});
```
