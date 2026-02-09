---
title: Schema Overview
description: Define type-safe schemas for facts, derivations, events, and requirements in your Directive modules.
---

Schemas provide compile-time and runtime type safety for your Directive modules. {% .lead %}

---

## Schema Structure

Every module can define a schema with four sections:

```typescript
const myModule = createModule("my-module", {
  schema: {
    facts: { ... },        // State values
    derivations: { ... },  // Computed values (optional)
    events: { ... },       // Typed events (optional)
    requirements: { ... }, // Requirement payloads (optional)
  },
});
```

Only `facts` is required. Other sections default to empty.

---

## Facts Schema

Define the shape of your module's state using `t` type builders:

```typescript
schema: {
  facts: {
    userId: t.number(),
    user: t.object<User>().nullable(),
    items: t.array<CartItem>().of(t.object<CartItem>()),
    preferences: t.object<Preferences>().optional(),
    status: t.string<"idle" | "loading" | "error">(),
  },
}
```

---

## Derivations Schema

Declare the return types for computed values:

```typescript
schema: {
  derivations: {
    displayName: t.string(),
    isLoggedIn: t.boolean(),
    itemCount: t.number(),
  },
}
```

---

## Events Schema

Define event names and their payload shapes. Each event maps to an object describing its payload properties. An empty object `{}` means no payload:

```typescript
schema: {
  events: {
    USER_LOGGED_IN: { userId: t.string(), method: t.string() },
    USER_LOGGED_OUT: {},  // No payload
    ERROR_OCCURRED: { code: t.string(), message: t.string() },
  },
}
```

---

## Requirements Schema

Define requirement names and their payload shapes. Each requirement maps to an object describing its additional properties:

```typescript
schema: {
  requirements: {
    FETCH_USER: { userId: t.number() },
    UPDATE_SETTINGS: { key: t.string() },
    SEND_NOTIFICATION: { title: t.string(), body: t.string() },
  },
}
```

---

## Type Inference

Schemas enable full TypeScript inference throughout the system:

```typescript
// Facts are typed
system.facts.userId = 123;        // OK
system.facts.userId = "invalid";  // Type error

// Events are typed via system.events accessor
system.events.USER_LOGGED_IN({ userId: "abc", method: "email" }); // OK
system.events.USER_LOGGED_OUT();  // OK — no payload

// Requirements are typed in constraints
constraints: {
  needsUser: {
    when: (facts) => facts.userId > 0 && !facts.user,
    require: { type: "FETCH_USER", userId: 123 },  // Typed payload
  },
},
```

---

## Type Assertion Pattern

For maximum TypeScript control with no runtime validation, use type assertions:

```typescript
const myModule = createModule("my-module", {
  schema: {
    facts: {} as { userId: number; user: User | null },
    derivations: {} as { displayName: string; isLoggedIn: boolean },
    events: {} as { increment: {}; setPhase: { phase: "a" | "b" } },
    requirements: {} as { FETCH: { id: string } },
  },
});
```

This provides full type inference without any runtime overhead.

---

## Next Steps

- **[Type Builders](/docs/type-builders)** — Complete `t.*` API reference
- **[Facts](/docs/facts)** — Working with state
- **[Events](/docs/events)** — Dispatching events
