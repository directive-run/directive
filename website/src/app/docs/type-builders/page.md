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

### Object Modifiers

```typescript
t.object<User>().shape({            // Validate specific properties
  name: t.string(),
  age: t.number(),
})
t.object<User>().nonNull()          // Must not be null or undefined
t.object<User>().hasKeys("id", "name")  // Must contain these keys
```

---

## Arrays

Arrays use a generic type parameter. Use `.of()` for element validation:

```typescript
schema: {
  facts: {
    ids: t.array<number>().of(t.number()),
    users: t.array<User>().of(t.object<User>()),
    tags: t.array<string>().of(t.string()),
  },
}
```

### Array Modifiers

```typescript
t.array<string>().nonEmpty()        // Must have at least 1 element
t.array<string>().minLength(2)      // Minimum length
t.array<string>().maxLength(50)     // Maximum length
```

---

## Enums

String literal unions with runtime validation:

```typescript
schema: {
  facts: {
    status: t.enum("idle", "loading", "success", "error"),
    // Type is inferred as "idle" | "loading" | "success" | "error"
  },
}
```

---

## Literals

Exact value matching:

```typescript
schema: {
  facts: {
    type: t.literal("user"),     // Exact string
    version: t.literal(1),       // Exact number
    enabled: t.literal(true),    // Exact boolean
  },
}
```

---

## Unions

Combine multiple types:

```typescript
schema: {
  facts: {
    value: t.union(t.string(), t.number()),
    data: t.union(t.string(), t.number(), t.boolean()),
  },
}
```

---

## Records

Dynamic key-value maps:

```typescript
schema: {
  facts: {
    metadata: t.record(t.string()),     // Record<string, string>
    scores: t.record(t.number()),       // Record<string, number>
  },
}
```

---

## Tuples

Fixed-length arrays with specific types per position:

```typescript
schema: {
  facts: {
    coord: t.tuple(t.string(), t.number()),        // [string, number]
    position: t.tuple(t.number(), t.number(), t.number()),  // [number, number, number]
  },
}
```

---

## Specialized Types

```typescript
schema: {
  facts: {
    id: t.uuid(),              // UUID string validation
    email: t.email(),          // Email format validation
    website: t.url(),          // URL format validation
    createdAt: t.date(),       // Date instance validation
    largeNum: t.bigint(),      // BigInt validation
  },
}
```

---

## Any Type

Bypass all validation (use sparingly):

```typescript
schema: {
  facts: {
    externalResponse: t.any<ExternalAPIResponse>(),
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
    items: t.array<string>().default([]),
  },
}
```

### Number Constraints

```typescript
t.number().min(0)             // Must be >= 0
t.number().max(100)           // Must be <= 100
t.number().min(0).max(100)    // Range
```

---

## Custom Validation

Add validation and refinements to any type:

```typescript
// Custom validator (dev-mode only)
t.string().validate(s => s.length > 0)

// Refinement with error message
t.string().refine(s => s.includes("@"), "Must be an email")

// Transform values on set
t.string().transform(s => s.trim())

// Branded types (nominal typing)
t.string().brand<"UserId">()  // Branded<string, "UserId">

// Description (for devtools / introspection)
t.string().describe("The user's display name")
```

---

## Chaining

Modifiers can be chained:

```typescript
schema: {
  facts: {
    user: t.object<User>().nullable().default(null),
    items: t.array<Item>().of(t.object<Item>()).default([]),
    count: t.number().min(0).max(100).default(0),
    email: t.string().refine(s => s.includes("@"), "Must be email").nullable(),
  },
}
```

---

## Next Steps

- **[Schema Overview](/docs/schema-overview)** — Schema structure
- **[Facts](/docs/facts)** — Working with state
- **[Derivations](/docs/derivations)** — Computed values
