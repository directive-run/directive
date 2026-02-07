---
title: Facts
description: Facts are the observable state in Directive. Learn how to define, access, and update facts with full TypeScript support.
---

Facts are your source of truth — reactive state that constraints, derivations, and effects observe. {% .lead %}

---

## Defining Facts

Define facts in your module schema using `t` type builders:

```typescript
import { createModule, t } from 'directive';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      tags: t.array<string>().of(t.string()),
      status: t.enum("idle", "loading", "success", "error"),
    },
  },
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.tags = [];
    facts.status = "idle";
  },
});
```

---

## Type Builders

The `t` object provides type builders for schema definitions. All builders return chainable types with dev-mode validation:

| Builder | TypeScript Type | Example |
|---------|-----------------|---------|
| `t.string()` | `string` | `t.string()` |
| `t.string<T>()` | `T` (literal union) | `t.string<"red" \| "green">()` |
| `t.number()` | `number` | `t.number()` |
| `t.boolean()` | `boolean` | `t.boolean()` |
| `t.array<T>()` | `T[]` | `t.array<string>()` |
| `t.object<T>()` | `T` | `t.object<User>()` |
| `t.enum(...)` | string literal union | `t.enum("idle", "loading", "error")` |
| `t.literal(v)` | exact value | `t.literal("admin")`, `t.literal(42)` |
| `t.union(...)` | union of types | `t.union(t.string(), t.number())` |
| `t.record(v)` | `Record<string, V>` | `t.record(t.number())` |
| `t.any<T>()` | `T` (no validation) | `t.any<ExternalResponse>()` |

### Common Modifiers

All type builders support these chainable methods:

```typescript
// Nullability
t.string().nullable()          // string | null
t.number().optional()          // number | undefined

// Defaults
t.number().default(0)          // Default value used by init
t.array<string>().default([])  // Factory function also accepted: .default(() => [])

// Description (for devtools / introspection)
t.string().describe("The user's display name")

// Custom validation (dev-mode only)
t.string().validate(s => s.length > 0)
t.string().refine(s => s.includes("@"), "Must be an email")

// Transform values on set
t.string().transform(s => s.trim())

// Branded types (nominal typing)
t.string().brand<"UserId">()  // Branded<string, "UserId">
```

### Number-Specific

```typescript
t.number().min(0)             // Must be >= 0
t.number().max(100)           // Must be <= 100
t.number().min(0).max(100)    // Range
```

### Array-Specific

```typescript
t.array<string>().of(t.string())    // Validate each element
t.array<string>().nonEmpty()        // Must have at least 1 element
t.array<string>().minLength(2)      // Minimum length
t.array<string>().maxLength(50)     // Maximum length
```

### Object-Specific

```typescript
t.object<User>().shape({            // Validate specific properties
  name: t.string(),
  age: t.number(),
})
t.object<User>().nonNull()          // Must not be null or undefined
t.object<User>().hasKeys("id", "name")  // Must contain these keys
```

---

## Reading Facts

### Single Module

```typescript
const system = createSystem({ module: userModule });

system.facts.userId;       // number
system.facts.user?.name;   // string | undefined
system.facts.loading;      // boolean
```

### Multiple Modules (Namespaced)

```typescript
const system = createSystem({
  modules: { auth: authModule, data: dataModule },
});

system.facts.auth.token;   // Namespaced access
system.facts.data.items;
```

### In Constraints

Constraints receive a scoped facts proxy:

```typescript
constraints: {
  needsUser: {
    when: (facts) => facts.userId > 0 && !facts.user,
    require: { type: "FETCH_USER" },
  },
}
```

### In Derivations

Derivations receive a scoped facts proxy with auto-tracking:

```typescript
derive: {
  displayName: (facts) => facts.user?.name ?? "Guest",
}
```

### In Resolvers

Resolvers receive facts via `context.facts`:

```typescript
resolvers: {
  fetchUser: {
    requirement: (req) => req.type === "FETCH_USER",
    resolve: async (req, context) => {
      const userId = context.facts.userId;          // Read
      context.facts.user = await api.getUser(userId); // Write
      context.facts.loading = false;
    },
  },
}
```

---

## Writing Facts

Assign to facts directly — each assignment triggers the reconciliation loop (constraints evaluate, derivations invalidate, effects run):

```typescript
// Single update — triggers one reconciliation
system.facts.userId = 123;

// Multiple updates — each triggers a separate reconciliation
system.facts.userId = 123;
system.facts.loading = true;
```

### Batching Updates

Use `batch` to group updates into a single reconciliation:

```typescript
system.batch(() => {
  system.facts.userId = 123;
  system.facts.loading = true;
  system.facts.status = "loading";
});
// One reconciliation cycle for all three changes
```

### Replacing Arrays and Objects

Only top-level property assignment is tracked. Replace the entire value:

```typescript
// Replace the array (tracked)
system.facts.tags = [...system.facts.tags, "new-tag"];

// Replace the object (tracked)
system.facts.user = { ...system.facts.user, name: "New Name" };
```

{% callout type="warning" title="Deep mutations are NOT tracked" %}
The facts proxy only intercepts top-level property `set`. Mutating nested properties or calling array methods in-place won't trigger updates:
```typescript
// Won't trigger updates — the proxy doesn't see these
system.facts.user.name = "New";
system.facts.tags.push("new-tag");

// Do this instead — replace the whole value
system.facts.user = { ...system.facts.user, name: "New" };
system.facts.tags = [...system.facts.tags, "new-tag"];
```
{% /callout %}

---

## Initial Values

The `init` function runs once when `system.start()` is called:

```typescript
init: (facts) => {
  facts.userId = 0;
  facts.user = null;
  facts.loading = false;
  facts.tags = [];
},
```

You can also provide initial values when creating the system:

```typescript
// Single module
const system = createSystem({
  module: userModule,
  initialFacts: { userId: 42, loading: true },
});

// Multiple modules (namespaced)
const system = createSystem({
  modules: { auth: authModule, data: dataModule },
  initialFacts: {
    auth: { token: "abc123" },
    data: { items: [] },
  },
});
```

`initialFacts` are applied after `init()` runs, overriding any values set by `init`.

{% callout title="Always initialize" %}
Every fact in your schema should be initialized. Uninitialized facts will be `undefined`.
{% /callout %}

---

## Hydration

For SSR or restoring persisted state, use `hydrate()` before `start()`:

```typescript
const system = createSystem({ module: userModule });

await system.hydrate(async () => {
  const saved = await fetch('/api/state');
  return saved.json();
});

system.start();
```

Hydrated facts are applied after `init()` and `initialFacts`, taking highest precedence.

---

## TypeScript Integration

Facts are fully typed based on your schema:

```typescript
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
    },
  },
});

const system = createSystem({ module: userModule });

system.facts.userId = "123";  // Type error: string not assignable to number
system.facts.user?.name;      // string | undefined (correctly narrowed)
system.facts.nonExistent;     // Type error: property doesn't exist
```

---

## Next Steps

- **[Derivations](/docs/derivations)** — Computed values from facts
- **[Constraints](/docs/constraints)** — Rules that react to fact changes
- **[Effects](/docs/effects)** — Side effects from state changes
- **[Type Builders](/docs/type-builders)** — Full type builder reference
