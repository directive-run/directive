---
title: Zod Integration
description: Use Zod schemas for runtime validation in Directive modules.
---

Directive integrates with Zod for runtime type validation. {% .lead %}

---

## Basic Usage

Use Zod schemas instead of type builders:

```typescript
import { z } from 'zod';
import { createModule, fromZod } from 'directive';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const myModule = createModule("users", {
  schema: {
    facts: {
      user: fromZod(UserSchema).nullable(),
      users: fromZod(z.array(UserSchema)),
    },
  },
});
```

---

## Runtime Validation

Enable validation in development:

```typescript
const system = createSystem({
  module: myModule,
  validate: process.env.NODE_ENV === 'development',
});

// In development, invalid data throws
system.facts.user = { id: 123 }; // Error: Expected string, received number
```

---

## Validation Modes

```typescript
const system = createSystem({
  module: myModule,
  validate: {
    mode: 'strict',      // Throw on invalid data (default)
    // mode: 'warn',     // Log warning but allow
    // mode: 'silent',   // Just return validation result
  },
});
```

---

## Custom Error Handling

```typescript
const system = createSystem({
  module: myModule,
  validate: true,
  onValidationError: (error, key, value) => {
    console.error(`Validation failed for ${key}:`, error);
    Sentry.captureException(error);
  },
});
```

---

## Complex Schemas

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
  createdAt: z.date(),
});

schema: {
  facts: {
    order: fromZod(OrderSchema).nullable(),
  },
}
```

---

## Next Steps

- See Type Builders for built-in types
- See Type Assertions for custom validation
- See Schema Overview for structure
