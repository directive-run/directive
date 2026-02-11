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
    facts: { ... },        // Your observable state – required
    derivations: { ... },  // Computed value return types (optional)
    events: { ... },       // Typed event payloads (optional)
    requirements: { ... }, // Requirement payloads for constraints (optional)
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
    userId: t.number(),                                    // Simple primitive
    user: t.object<User>().nullable(),                     // null until loaded
    items: t.array<CartItem>().of(t.object<CartItem>()),   // Typed array with element validation
    preferences: t.object<Preferences>().optional(),       // May not exist yet
    status: t.string<"idle" | "loading" | "error">(),     // Narrowed string literal union
  },
}
```

---

## Derivations Schema

Declare the return types for computed values:

```typescript
schema: {
  derivations: {
    displayName: t.string(),    // Computed from user facts
    isLoggedIn: t.boolean(),    // Derived from whether user exists
    itemCount: t.number(),      // Derived from items array length
  },
}
```

---

## Events Schema

Define event names and their payload shapes. Each event maps to an object describing its payload properties. An empty object `{}` means no payload:

```typescript
schema: {
  events: {
    // Event with a typed payload – who logged in and how
    USER_LOGGED_IN: { userId: t.string(), method: t.string() },

    // Empty object means this event carries no data
    USER_LOGGED_OUT: {},

    // Structured error information
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
    // Each requirement defines the data its resolver needs
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
// Facts are typed – assignment is checked at compile time
system.facts.userId = 123;        // OK
system.facts.userId = "invalid";  // Type error: string not assignable to number

// Events are typed via system.events accessor
system.events.USER_LOGGED_IN({ userId: "abc", method: "email" }); // OK
system.events.USER_LOGGED_OUT();  // OK – no payload required

// Requirement payloads are typed in constraints
constraints: {
  needsUser: {
    when: (facts) => facts.userId > 0 && !facts.user,

    // TypeScript ensures the payload matches the schema
    require: { type: "FETCH_USER", userId: 123 },
  },
},
```

---

## Type Assertion Pattern

For maximum TypeScript control with no runtime validation, use type assertions:

```typescript
// Use type assertions for zero-cost type safety (no runtime validation)
const myModule = createModule("my-module", {
  schema: {
    facts: {} as { userId: number; user: User | null },
    derivations: {} as { displayName: string; isLoggedIn: boolean },
    events: {} as { increment: {}; setPhase: { phase: "a" | "b" } },
    requirements: {} as { FETCH: { id: string } },
  },
});
// Full TypeScript inference, but nothing is validated at runtime
```

This provides full type inference without any runtime overhead.

---

## Next Steps

- **[Type Builders](/docs/type-builders)** – Complete `t.*` API reference
- **[Facts](/docs/facts)** – Working with state
- **[Events](/docs/events)** – Dispatching events
