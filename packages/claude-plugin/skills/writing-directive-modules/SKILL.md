---
name: writing-directive-modules
description: "Create and structure Directive modules with schema definitions, init functions, derivations, effects, events, constraints, and resolvers using the correct t.* type builders and naming conventions. Use when asked to build a Directive module, add facts/derivations/resolvers to an existing module, or scaffold any stateful domain with Directive."
---

# Writing Directive Modules

## Prerequisites

This skill applies when the project uses `@directive-run/core`. If not found in `package.json`, suggest installing it: `npm install @directive-run/core`.

## When Claude Should Use This Skill

**Auto-invoke when the user:**
- Says "create a module", "add a fact", "build with Directive", or "scaffold state"
- Asks to model a domain (auth, cart, user profile, game state, etc.) in Directive
- Shows a `createModule()` call and asks to extend it
- Asks about schema types, derivations, effects, resolvers, or events in Directive context

**Do NOT invoke when:**
- Working on system composition (see `building-directive-systems.md`)
- Writing tests (see `testing-directive-code.md`)
- Asking about constraints/resolver interaction patterns only (see `writing-directive-constraints.md`)

---

## Module Shape – Canonical Form

```typescript
import { createModule, t } from "@directive-run/core";

const myModule = createModule("name", {
  schema: {
    facts: {
      phase: t.string<"idle" | "loading" | "done">(),
      count: t.number(),
      user: t.object<{ id: string; name: string } | null>(),
    },
    derivations: {      // Optional – declare types here, define in derive
      isLoading: t.boolean(),
      displayName: t.string(),
    },
    events: {           // Optional – declare event payloads here
      increment: {},
      setUser: { user: t.object<{ id: string; name: string }>() },
    },
    requirements: {     // Optional – declare requirement payloads here
      FETCH_USER: { userId: t.string() },
    },
  },

  init: (facts) => {    // Synchronous. Sets all facts to initial values.
    facts.phase = "idle";
    facts.count = 0;
    facts.user = null;
  },

  derive: {             // Auto-tracked – no manual deps needed
    isLoading: (facts) => facts.phase === "loading",
    displayName: (facts) => {
      if (!facts.user) {
        return "Guest";
      }

      return facts.user.name;
    },
  },

  effects: {            // Fire-and-forget side effects
    logPhase: {
      run: (facts, prev) => {
        if (prev?.phase !== facts.phase) {
          console.log(`Phase: ${facts.phase}`);
        }
      },
    },
  },

  events: {             // Synchronous fact mutations driven by user actions
    increment: (facts) => {
      facts.count += 1;
    },
    setUser: (facts, payload) => {
      facts.user = payload.user;
    },
  },

  constraints: {        // WHEN conditions are true, REQUIRE something
    fetchWhenReady: {
      when: (facts) => facts.phase === "idle" && facts.count > 0,
      require: (facts) => ({ type: "FETCH_USER", userId: "user-1" }),
    },
  },

  resolvers: {          // HOW to fulfill requirements
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.phase = "loading";
        const res = await fetch(`/api/users/${req.userId}`);
        context.facts.user = await res.json();
        context.facts.phase = "done";
      },
    },
  },
});
```

---

## Decision Tree: Where Does This Logic Go?

```
What does this code do?
├── Store a value that changes over time
│   └── schema.facts + init()
├── Compute a value from other facts (synchronous, cached)
│   └── schema.derivations + derive
├── React to fact changes (side effect, fire-and-forget)
│   └── effects
├── Respond to a user action
│   └── schema.events + events
├── Declare "when X is true, the system needs Y"
│   └── constraints
└── Fulfill a requirement with async work
    └── resolvers
```

---

## Schema Type Builders

### Which builder to use

```
Value type?
├── string (possibly with union)  → t.string() or t.string<"a" | "b">()
├── number (possibly with bounds) → t.number() or t.number().min(0).max(100)
├── boolean                       → t.boolean()
├── object / record               → t.object<Shape>()
├── array                         → t.array<ItemType>()
├── string literal union          → t.enum("a", "b", "c")
├── exact value                   → t.literal(42)
├── T | null                      → t.nullable(t.string()) or t.object<T | null>()
├── T | undefined                 → t.optional(t.string())
└── Map / Set / Date              → t.object<Map<K,V>>() / t.object<Set<T>>() / t.object<Date>()
```

### Chainable modifiers (available on all types)

```typescript
t.string().default("light")         // Default if init doesn't set it
t.string().validate((v) => v.includes("@"))  // Dev-mode validation
t.string().transform((v) => v.trim())         // Runs on every set
t.string().brand<"UserId">()         // Nominal typing
t.number().min(0).max(100).describe("Player score")
t.array<string>().nonEmpty().maxLength(10)
t.object<{ url: string }>().nonNull()
```

### Type assertion alternative (for simple schemas)

```typescript
schema: {
  facts: {} as { count: number; name: string },
  derivations: {} as { doubled: number },
},
```

Gives full TypeScript inference, skips runtime validation.

---

## Key Patterns

### Derivation composition (derivation depending on another)

```typescript
derive: {
  isRed: (facts) => facts.phase === "red",
  status: (facts, derived) => ({   // Second param accesses other derivations
    phase: facts.phase,
    isRed: derived.isRed,
  }),
},
```

### Dynamic requirement from facts

```typescript
constraints: {
  fetchUser: {
    when: (facts) => facts.isAuthenticated && !facts.profile,
    require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
  },
},
```

### Returning null from require to suppress

```typescript
require: (facts) => {
  if (!facts.userId) {
    return null;  // No requirement emitted
  }

  return { type: "FETCH_USER", userId: facts.userId };
},
```

### Array/object mutation – always replace, never mutate in place

```typescript
// CORRECT
facts.items = [...facts.items, newItem];
facts.config = { ...facts.config, theme: "dark" };
```

---

## Critical Anti-Patterns

### 1. Missing facts wrapper in schema

```typescript
// WRONG
schema: { phase: t.string(), count: t.number() }

// CORRECT
schema: { facts: { phase: t.string(), count: t.number() } }
```

### 2. Nonexistent type builders

```typescript
// WRONG – these do not exist
t.map<string, User>()
t.set<string>()
t.date()
t.record<string, number>()
t.any()

// CORRECT
t.object<Map<string, User>>()
t.object<Set<string>>()
t.object<Date>()
t.object<Record<string, number>>()
t.object<unknown>()
```

### 3. Async init

```typescript
// WRONG – init is synchronous
init: async (facts) => { facts.config = await fetch("/api/config").then(r => r.json()); }

// CORRECT – init sets defaults; async work goes in constraints/resolvers
init: (facts) => { facts.config = null; }
```

### 4. Resolver parameter naming
Always use `(req, context)` – never `(req, ctx)` or `(request, context)`.

### 5. Resolver returning data

```typescript
// WRONG – return value is ignored
resolve: async (req, context) => { return await fetchUser(req.userId); }

// CORRECT – mutate context.facts
resolve: async (req, context) => { context.facts.user = await fetchUser(req.userId); }
```

### 6. Unnecessary type casting

```typescript
// WRONG
const profile = system.facts.profile as UserProfile;

// CORRECT – schema provides the type
const profile = system.facts.profile;
```

### 7. Passthrough derivations

```typescript
// WRONG – derivation just returns a fact unchanged
derive: { count: (facts) => facts.count }

// CORRECT – read the fact directly: system.facts.count
```

### 8. String require instead of object

```typescript
// WRONG
require: "FETCH_DATA"

// CORRECT
require: { type: "FETCH_DATA" }
```

### 9. Accessing facts.self in single-module context

```typescript
// facts.self.* is only for multi-module cross-module deps contexts
// In single-module resolvers: use context.facts.fieldName directly
```

### 10. Deep imports

```typescript
// WRONG
import { createModule } from "@directive-run/core/module";

// CORRECT
import { createModule } from "@directive-run/core";
// Exception: plugins use @directive-run/core/plugins
```

---

## Terminology Quick Reference

| Use | Never Use |
|-----|-----------|
| `facts` | state, store, atoms |
| `derivations` / `derive` | computed, selectors, getters, memos |
| `constraints` | rules, conditions, triggers |
| `resolvers` | handlers, actions, reducers |
| `requirements` | requests, commands |
| `effects` | watchers, subscriptions, reactions |
| `(req, context)` | `(req, ctx)` or `(request, context)` |

---

## Reference Files

- `core-patterns.md` – decision trees, full module example, system creation patterns
- `schema-types.md` – complete t.* builder reference, chainable methods, nonexistent types
- `naming.md` – req/context rules, return style, blank-line conventions, multi-module naming
- `anti-patterns.md` – 20 ranked anti-patterns with correct/wrong examples
