---
title: Type Builders
description: Complete reference for Directive's type builder API for defining schemas.
---

The `t` namespace provides chainable type builders for schema definitions. {% .lead %}

---

## Primitive Types

```typescript
import { t } from 'directive';

schema: {
  facts: {
    name: t.string(),
    age: t.number(),
    active: t.boolean(),
  },
}
```

---

## String Literals

Narrow string types with generics:

```typescript
schema: {
  facts: {
    status: t.string<"idle" | "loading" | "success" | "error">(),
    theme: t.string<"light" | "dark" | "system">(),
    role: t.string<"admin" | "user" | "guest">(),
  },
}
```

---

## Objects

Define typed objects:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

schema: {
  facts: {
    user: t.object<User>(),
    settings: t.object<{ theme: string; locale: string }>(),
  },
}
```

---

## Arrays

```typescript
schema: {
  facts: {
    ids: t.array(t.number()),
    users: t.array(t.object<User>()),
    tags: t.array(t.string()),
  },
}
```

---

## Modifiers

### Nullable

Allow null values:

```typescript
schema: {
  facts: {
    user: t.object<User>().nullable(),     // User | null
    error: t.string().nullable(),           // string | null
  },
}
```

### Optional

Allow undefined values:

```typescript
schema: {
  facts: {
    preference: t.string().optional(),     // string | undefined
    metadata: t.object<Meta>().optional(), // Meta | undefined
  },
}
```

### Default Values

Provide default values:

```typescript
schema: {
  facts: {
    count: t.number().default(0),
    theme: t.string<"light" | "dark">().default("light"),
    items: t.array(t.string()).default([]),
  },
}
```

---

## Void Type

For events without payloads:

```typescript
schema: {
  events: {
    LOGOUT: t.void(),
    RESET: t.void(),
  },
}
```

---

## Chaining

Modifiers can be chained:

```typescript
schema: {
  facts: {
    user: t.object<User>().nullable().default(null),
    items: t.array(t.object<Item>()).default([]),
  },
}
```

---

## Next Steps

- See Schema Overview for structure
- See Zod Integration for runtime validation
- See Type Assertions for custom validation
