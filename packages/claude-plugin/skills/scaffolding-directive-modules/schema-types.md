# Schema Types

The `t.*()` builders define fact types in module schemas. They provide runtime validation in dev mode and full TypeScript inference.

## Decision Tree: "Which type builder do I use?"

```
What kind of value?
├── String → t.string() or t.string<"a" | "b">() for literal unions
├── Number → t.number() with optional .min() / .max()
├── Boolean → t.boolean()
├── Array → t.array<ItemType>() with optional .of() / .nonEmpty()
├── Object/Record → t.object<Shape>()
├── Fixed set of string values → t.enum("a", "b", "c")
├── Exact value → t.literal(42) or t.literal("active")
├── Nullable → t.nullable(t.string())
├── Optional → t.optional(t.number())
├── Union → t.union(t.string(), t.number())
├── Map/Set → t.object<Map<K,V>>() or t.object<Set<T>>()
├── Date → t.object<Date>() or t.number() for timestamps
└── Unknown/any → t.object<unknown>()
```

## Primitive Types

```typescript
import { createModule, t } from "@directive-run/core";

const myModule = createModule("example", {
  schema: {
    facts: {
      // Basic string
      name: t.string(),

      // String literal union – full type safety
      phase: t.string<"idle" | "loading" | "done">(),

      // Number with validation
      count: t.number(),
      age: t.number().min(0).max(150),

      // Boolean
      isActive: t.boolean(),
    },
  },
  init: (facts) => {
    facts.name = "";
    facts.phase = "idle";
    facts.count = 0;
    facts.age = 25;
    facts.isActive = false;
  },
});
```

## Complex Types

```typescript
schema: {
  facts: {
    // Object with shape
    user: t.object<{ id: string; name: string; email: string }>(),

    // Nullable object
    profile: t.object<{ bio: string; avatar: string } | null>(),

    // Array
    tags: t.array<string>(),
    items: t.array<{ id: string; label: string }>().nonEmpty(),

    // Record (key-value map)
    scores: t.object<Record<string, number>>(),

    // Nested complex type
    config: t.object<{
      theme: "light" | "dark";
      notifications: { email: boolean; push: boolean };
    }>(),
  },
},
```

## Enum and Literal

```typescript
schema: {
  facts: {
    // Enum – string literal union from values
    status: t.enum("pending", "active", "archived"),
    // TypeScript type: "pending" | "active" | "archived"

    // Literal – exact match
    version: t.literal(2),
    mode: t.literal("strict"),
    enabled: t.literal(true),
  },
},
```

## Nullable and Optional

```typescript
schema: {
  facts: {
    // Nullable – T | null
    selectedItem: t.nullable(t.string()),

    // Optional – T | undefined
    nickname: t.optional(t.string()),

    // Union – combine types
    result: t.union(t.string(), t.number()),

    // Nullable via object generic (also valid)
    user: t.object<{ id: string } | null>(),
  },
},
```

## Chainable Methods (Available on All Types)

```typescript
schema: {
  facts: {
    // Default value – used if init doesn't set it
    theme: t.string<"light" | "dark">().default("light"),

    // Custom validation – runs in dev mode
    email: t.string().validate((val) => val.includes("@")),

    // Transform on set – runs when fact is mutated
    slug: t.string().transform((val) => val.toLowerCase().replace(/\s+/g, "-")),

    // Branded type – nominal typing
    userId: t.string().brand<"UserId">(),

    // Description – for docs and devtools
    retryCount: t.number().describe("Number of failed attempts"),

    // Refinement – predicate with error message
    port: t.number().refine(
      (n) => n >= 1 && n <= 65535,
      "Port must be between 1 and 65535",
    ),

    // Chaining – combine multiple modifiers
    score: t.number()
      .min(0)
      .max(100)
      .default(0)
      .describe("Player score"),
  },
},
```

## Array-Specific Methods

```typescript
schema: {
  facts: {
    // Basic array
    items: t.array<string>(),

    // Non-empty validation
    requiredItems: t.array<string>().nonEmpty(),

    // Length constraints
    topFive: t.array<string>().maxLength(5),
    atLeastThree: t.array<number>().minLength(3),

    // Combined
    tags: t.array<string>().nonEmpty().maxLength(10),
  },
},
```

## Object-Specific Methods

```typescript
schema: {
  facts: {
    // Non-null assertion
    config: t.object<{ url: string }>().nonNull(),

    // Required keys validation
    settings: t.object<Record<string, unknown>>().hasKeys("apiUrl", "timeout"),
  },
},
```

## Types That DO NOT Exist

These are common AI hallucinations. Do not use them.

```typescript
// WRONG – t.map() does not exist
items: t.map<string, number>(),
// CORRECT
items: t.object<Map<string, number>>(),

// WRONG – t.set() does not exist
tags: t.set<string>(),
// CORRECT
tags: t.object<Set<string>>(),

// WRONG – t.date() does not exist
createdAt: t.date(),
// CORRECT
createdAt: t.object<Date>(),
// OR use timestamps
createdAt: t.number(), // Unix ms

// WRONG – t.tuple() does not exist
coords: t.tuple<[number, number]>(),
// CORRECT
coords: t.array<[number, number]>(),

// WRONG – t.record() does not exist
scores: t.record<string, number>(),
// CORRECT
scores: t.object<Record<string, number>>(),

// WRONG – t.promise() does not exist (facts are synchronous)
result: t.promise<string>(),

// WRONG – t.any() does not exist
data: t.any(),
// CORRECT
data: t.object<unknown>(),

// WRONG – t.void() does not exist (not a fact type)
// WRONG – t.function() does not exist (functions are not serializable)
```

## Type Assertion Alternative

For simple modules, you can skip `t.*()` and use TypeScript type assertions:

```typescript
const myModule = createModule("simple", {
  schema: {
    facts: {} as {
      count: number;
      name: string;
      items: string[];
    },
    derivations: {} as {
      doubled: number;
    },
  },
  init: (facts) => {
    facts.count = 0;
    facts.name = "";
    facts.items = [];
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
});
```

This gives full TypeScript inference but skips runtime validation. Use `t.*()` when you want dev-mode validation, transforms, or self-documenting schemas.
