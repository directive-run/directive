---
title: Type Assertions & Custom Validation
description: Use type assertions for zero-overhead typing, or add custom validation with chainable methods.
---

Two patterns for types without runtime validation, plus custom validation for when you need it. {% .lead %}

---

## Type Assertions

For zero-overhead typing, use the type assertion pattern. This gives full TypeScript inference without any runtime validation:

```typescript
import { createModule } from 'directive';

const myModule = createModule("example", {
  schema: {
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

## Custom Validation

For runtime validation, use the chainable `.validate()` and `.refine()` methods on any `t.*()` builder:

### Basic Validator

```typescript
import { t } from 'directive';

schema: {
  facts: {
    quantity: t.number().validate(v => v > 0),
    price: t.number().min(0),  // Built-in min/max for numbers
  },
}
```

### Refinement with Error Messages

`.refine()` adds validation with a descriptive error message:

```typescript
schema: {
  facts: {
    email: t.string().refine(
      s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
      "Must be a valid email address"
    ),
    password: t.string().refine(
      s => s.length >= 8,
      "Must be at least 8 characters"
    ),
  },
}
```

Or use the built-in `t.email()` type:

```typescript
schema: {
  facts: {
    userEmail: t.email().nullable(),
  },
}
```

### Range Validation

```typescript
schema: {
  facts: {
    rating: t.number().min(1).max(5),
    percentage: t.number().min(0).max(100),
  },
}
```

---

## Branded Types

Create nominal types that prevent accidental mixing of values:

```typescript
schema: {
  facts: {
    currentUserId: t.string().brand<"UserId">().nullable(),
    selectedOrderId: t.string().brand<"OrderId">().nullable(),
  },
}

// Type-safe — can't assign a UserId where OrderId is expected
```

Add validation to branded types:

```typescript
schema: {
  facts: {
    userId: t.string()
      .refine(v => v.startsWith("user_"), "Must start with user_")
      .brand<"UserId">()
      .nullable(),
  },
}
```

---

## Transforms

Transform values on assignment:

```typescript
schema: {
  facts: {
    name: t.string().transform(s => s.trim()),
    tags: t.string().transform(s => s.toLowerCase()),
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

- **[Type Builders](/docs/type-builders)** — Full `t.*` API reference
- **[Zod Integration](/docs/zod-integration)** — Zod schemas for validation
- **[Constraints](/docs/constraints)** — Runtime validation via constraints
