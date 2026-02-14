---
title: Schema & Types
description: Define type-safe schemas for facts, derivations, events, and requirements using type builders, Zod, or plain TypeScript.
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

## Type Builders

The `t` namespace provides chainable type builders for schema definitions.

### Primitive Types

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

### String Literals

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

### Objects

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

Object modifiers:

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

### Arrays

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

Array modifiers:

```typescript
t.array<string>().nonEmpty()        // Reject empty arrays
t.array<string>().minLength(2)      // At least 2 elements
t.array<string>().maxLength(50)     // No more than 50 elements
```

### Enums

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

### Literals

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

### Unions

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

### Records

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

### Tuples

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

### Specialized Types

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

### Any Type

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

For zero-overhead typing without runtime validation, use the type assertion pattern:

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

    derivations: {} as {
      displayName: string;
      total: number;
    },

    events: {} as {
      addItem: { item: CartItem };
      clear: {};
    },

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

## Zod Integration

Directive natively supports Zod schemas – use them directly in your facts definition for full runtime validation.

### Basic Usage

Pass Zod schemas directly as fact types – no wrapper needed:

```typescript
import { z } from 'zod';
import { createModule, t } from 'directive';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const myModule = createModule("users", {
  schema: {
    facts: {
      user: UserSchema.nullable(),   // Zod schema, nullable for initial state
      users: z.array(UserSchema),    // Zod arrays work too
      count: t.number(),             // Mix with t.* builders freely
    },
  },

  init: (facts) => {
    facts.user = null;
    facts.users = [];
    facts.count = 0;
  },
});
```

Directive auto-detects Zod schemas at runtime and uses `safeParse` for validation.

### How It Works

Directive's type system supports three kinds of schema values:

1. **`t.*()` builders** – Directive's built-in type builders (detected via `_validators`)
2. **Zod schemas** – Auto-detected via `safeParse` + `_def` + `parse` (validated with `safeParse`)
3. **Type assertions** – Plain types via `{} as { ... }` (no runtime validation)

For TypeScript inference, Zod's `_output` type is extracted automatically.

### Validation Behavior

Validation runs automatically in development mode (`process.env.NODE_ENV !== 'production'`). In production, validation is tree-shaken away.

```typescript
// In development, invalid data throws with a descriptive error
system.facts.user = { id: 123 };
// => Error: [Directive] Validation failed for "user":
//    expected object, got object {"id":123}. Expected string, received number
```

### Complex Schemas

Zod's full API works seamlessly:

```typescript
const OrderSchema = z.object({
  id: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    price: z.number().nonnegative(),
  })),
  total: z.number().nonnegative(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
});

schema: {
  facts: {
    order: OrderSchema.nullable(),
  },
}
```

### Mixing Zod and Type Builders

You can freely mix Zod schemas with `t.*()` builders in the same module:

```typescript
schema: {
  facts: {
    // Use Zod for complex validated types with rich constraints
    user: UserSchema.nullable(),
    order: OrderSchema.nullable(),

    // Use t.* builders for lightweight primitives
    loading: t.boolean(),
    error: t.string().nullable(),
    count: t.number().min(0),
  },
}
```

---

## Async Validation

For validation that requires async work (API calls, database lookups), use constraints and resolvers instead:

```typescript
constraints: {
  validateEmail: {
    when: (facts) => facts.email && !facts.emailValidated,
    require: { type: "VALIDATE_EMAIL" },
  },
},

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

- **[Facts](/docs/facts)** – Working with state
- **[Derivations](/docs/derivations)** – Computed values
- **[Constraints](/docs/constraints)** – Declaring rules
