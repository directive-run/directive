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
    name: t.string(),      // Text values
    age: t.number(),       // Numeric values
    active: t.boolean(),   // True/false flags
  },
}
```

---

## String Literals

Narrow string types with generics:

```typescript
schema: {
  facts: {
    // Generic parameter narrows the type to specific allowed values
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
    // Pass your interface as the generic to get full type safety
    user: t.object<User>(),

    // Inline types work too
    settings: t.object<{ theme: string; locale: string }>(),
  },
}
```

### Object Modifiers

```typescript
// Validate specific properties at runtime (dev mode)
t.object<User>().shape({
  name: t.string(),
  age: t.number(),
})

// Ensure the value is never null or undefined
t.object<User>().nonNull()

// Require certain keys to be present
t.object<User>().hasKeys("id", "name")
```

---

## Arrays

Arrays use a generic type parameter. Use `.of()` for element validation:

```typescript
schema: {
  facts: {
    // Generic sets the array type; .of() adds element validation
    ids: t.array<number>().of(t.number()),
    users: t.array<User>().of(t.object<User>()),
    tags: t.array<string>().of(t.string()),
  },
}
```

### Array Modifiers

```typescript
t.array<string>().nonEmpty()        // Reject empty arrays
t.array<string>().minLength(2)      // At least 2 elements
t.array<string>().maxLength(50)     // No more than 50 elements
```

---

## Enums

String literal unions with runtime validation:

```typescript
schema: {
  facts: {
    // Pass allowed values as arguments – validated at runtime
    status: t.enum("idle", "loading", "success", "error"),
    // TypeScript infers: "idle" | "loading" | "success" | "error"
  },
}
```

---

## Literals

Exact value matching:

```typescript
schema: {
  facts: {
    type: t.literal("user"),     // Only the string "user" is valid
    version: t.literal(1),       // Only the number 1 is valid
    enabled: t.literal(true),    // Only true is valid
  },
}
```

---

## Unions

Combine multiple types:

```typescript
schema: {
  facts: {
    // Accept either a string or a number
    value: t.union(t.string(), t.number()),

    // Three-way union
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
    // String keys with string values – like a dictionary
    metadata: t.record(t.string()),     // Record<string, string>

    // String keys with numeric values – like a scoreboard
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
    // Each position has a specific type – like a labeled pair
    coord: t.tuple(t.string(), t.number()),        // [string, number]

    // 3D coordinates: x, y, z
    position: t.tuple(t.number(), t.number(), t.number()),  // [number, number, number]
  },
}
```

---

## Specialized Types

```typescript
schema: {
  facts: {
    // Built-in format validators for common patterns
    id: t.uuid(),              // "550e8400-e29b-41d4-a716-446655440000"
    email: t.email(),          // "user@example.com"
    website: t.url(),          // "https://example.com"
    createdAt: t.date(),       // Date instance
    largeNum: t.bigint(),      // BigInt for large numbers
  },
}
```

---

## Any Type

Bypass all validation (use sparingly):

```typescript
schema: {
  facts: {
    // Typed but not validated – use for external data you can't control
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
    // .nullable() adds null to the type – common for "not yet loaded" state
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
    // .optional() adds undefined – for values that may not exist
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
    // .default() sets the initial value – no need to set it in init()
    count: t.number().default(0),
    theme: t.string<"light" | "dark">().default("light"),
    items: t.array<string>().default([]),
  },
}
```

### Number Constraints

```typescript
// Enforce numeric boundaries (validated in dev mode)
t.number().min(0)             // No negative numbers
t.number().max(100)           // Cap at 100
t.number().min(0).max(100)    // Valid range: 0 to 100
```

---

## Custom Validation

Add validation and refinements to any type:

```typescript
// Custom validator – runs in dev mode, tree-shaken in production
t.string().validate(s => s.length > 0)

// Refinement – like validate, but with a descriptive error message
t.string().refine(s => s.includes("@"), "Must be an email")

// Transform – automatically modify values when they're set
t.string().transform(s => s.trim())

// Branded types – prevent mixing up strings that mean different things
t.string().brand<"UserId">()  // Branded<string, "UserId">

// Description – shows up in devtools and introspection output
t.string().describe("The user's display name")
```

---

## Chaining

Modifiers can be chained:

```typescript
schema: {
  facts: {
    // Nullable + default: starts as null, can be set to User later
    user: t.object<User>().nullable().default(null),

    // Array + element validation + default: starts empty, validates items
    items: t.array<Item>().of(t.object<Item>()).default([]),

    // Numeric range + default: bounded counter starting at 0
    count: t.number().min(0).max(100).default(0),

    // Refinement + nullable: validated when present, allowed to be null
    email: t.string().refine(s => s.includes("@"), "Must be email").nullable(),
  },
}
```

---

## Type Assertions

For zero-overhead typing without runtime validation, use the type assertion pattern. This gives full TypeScript inference with no runtime cost:

```typescript
import { createModule } from 'directive';

const myModule = createModule("example", {
  schema: {
    // Declare fact shapes with plain TypeScript – no runtime cost
    facts: {} as {
      userId: number;
      user: User | null;
      items: CartItem[];
    },

    // Derived values get the same treatment
    derivations: {} as {
      displayName: string;
      total: number;
    },

    // Events carry typed payloads
    events: {} as {
      addItem: { item: CartItem };
      clear: {};
    },

    // Requirements describe what the system needs fulfilled
    requirements: {} as {
      FETCH_USER: { userId: number };
    },
  },
  // ...
});
```

Type assertions are ideal when:
- You want maximum TypeScript control
- Runtime validation isn't needed
- You're working with complex or external types

---

## Transforms

Transform values on assignment:

```typescript
schema: {
  facts: {
    // Strip whitespace automatically on every assignment
    name: t.string().transform(s => s.trim()),

    // Normalize tags to lowercase for consistent storage
    tags: t.string().transform(s => s.toLowerCase()),
  },
}
```

---

## Async Validation

For validation that requires async work (API calls, database lookups), use constraints and resolvers instead:

```typescript
// Constraint fires when an email is present but hasn't been validated yet
constraints: {
  validateEmail: {
    when: (facts) => facts.email && !facts.emailValidated,
    require: { type: "VALIDATE_EMAIL" },
  },
},

// Resolver performs the async verification and stores the result
resolvers: {
  validateEmail: {
    requirement: "VALIDATE_EMAIL",
    resolve: async (req, context) => {
      const isValid = await emailService.verify(context.facts.email);
      context.facts.emailValidated = isValid;
    },
  },
}
```

---

## Next Steps

- **[Schema Overview](/docs/schema-overview)** – Schema structure
- **[Facts](/docs/facts)** – Working with state
- **[Derivations](/docs/derivations)** – Computed values
