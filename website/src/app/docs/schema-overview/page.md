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

---

## Facts Schema

Define the shape of your module's state:

```typescript
schema: {
  facts: {
    userId: t.number(),
    user: t.object<User>().nullable(),
    items: t.array(t.object<CartItem>()),
    preferences: t.object<Preferences>().optional(),
    status: t.string<"idle" | "loading" | "error">(),
  },
}
```

---

## Events Schema

Define type-safe event payloads:

```typescript
schema: {
  events: {
    USER_LOGGED_IN: t.object<{ userId: string; method: string }>(),
    USER_LOGGED_OUT: t.void(),
    ERROR_OCCURRED: t.object<{ code: string; message: string }>(),
  },
}
```

---

## Requirements Schema

Define requirement payloads for constraints:

```typescript
schema: {
  requirements: {
    FETCH_USER: t.object<{ userId: number }>(),
    UPDATE_SETTINGS: t.object<{ key: string; value: unknown }>(),
    SEND_NOTIFICATION: t.object<{ title: string; body: string }>(),
  },
}
```

---

## Type Inference

Schemas enable full TypeScript inference:

```typescript
// Facts are typed
system.facts.userId = 123;        // OK
system.facts.userId = "invalid";  // Type error

// Events are typed
system.on("USER_LOGGED_IN", (payload) => {
  console.log(payload.userId);    // string - inferred
  console.log(payload.invalid);   // Type error
});

// Requirements are typed
context.dispatch("FETCH_USER", { userId: 123 });  // OK
context.dispatch("FETCH_USER", {});               // Type error
```

---

## Next Steps

- See Type Builders for the complete `t.*` API
- See Zod Integration for runtime validation
- See Facts for working with state
