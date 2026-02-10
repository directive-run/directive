---
title: Zod Integration
description: Use Zod schemas directly in Directive modules for runtime validation.
---

Directive natively supports Zod schemas — use them directly in your facts definition for full runtime validation. {% .lead %}

---

## Basic Usage

Pass Zod schemas directly as fact types — no wrapper needed:

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
      count: t.number(),             // Mix with t.* builders
    },
    derivations: {},
    events: {},
    requirements: {},
  },
  init: (facts) => {
    facts.user = null;
    facts.users = [];
    facts.count = 0;
  },
});
```

Directive auto-detects Zod schemas at runtime and uses `safeParse` for validation.

---

## How It Works

Directive's type system supports three kinds of schema values:

1. **`t.*()` builders** — Directive's built-in type builders (detected via `_validators`)
2. **Zod schemas** — Auto-detected via `safeParse` + `_def` + `parse` (validated with `safeParse`)
3. **Type assertions** — Plain types via `{} as { ... }` (no runtime validation)

For TypeScript inference, Zod's `_output` type is extracted automatically, so `z.string()` infers as `string`, `z.object({...})` infers the object shape, etc.

---

## Validation Behavior

Validation runs automatically in development mode (`process.env.NODE_ENV !== 'production'`). In production, validation is tree-shaken away.

```typescript
// In development, invalid data throws with a descriptive error
system.facts.user = { id: 123 };
// Error: [Directive] Validation failed for "user": expected object, got object {"id":123}. Expected string, received number
```

The facts store's `validate` option controls this:

```typescript
const { store, facts } = createFacts({
  schema: myModule.schema.facts,
  validate: true,  // Force validation on (default: true in dev, false in prod)
});
```

---

## Complex Schemas

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

---

## Mixing Zod and Type Builders

You can freely mix Zod schemas with `t.*()` builders in the same module:

```typescript
schema: {
  facts: {
    // Zod for complex validated types
    user: UserSchema.nullable(),
    order: OrderSchema.nullable(),

    // t.* for simple types
    loading: t.boolean(),
    error: t.string().nullable(),
    count: t.number().min(0),
  },
}
```

---

## Next Steps

- **[Type Builders](/docs/type-builders)** — Built-in `t.*` types
- **[Schema Overview](/docs/schema-overview)** — Schema structure
- **[Facts](/docs/facts)** — Working with state
