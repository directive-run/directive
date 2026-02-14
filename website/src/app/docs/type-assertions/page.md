---
title: Type Assertions & Custom Validation
description: Use type assertions for zero-overhead typing, or add custom validation with chainable methods.
---

Two patterns for types without runtime validation, plus custom validation for when you need it. {% .lead %}

---

## Type Assertions

For zero-overhead typing, use the type assertion pattern. This gives full TypeScript inference without any runtime validation:

```typescript
import { createModule } from '@directive-run/core';

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

## Custom Validation

For runtime validation, use the chainable `.validate()` and `.refine()` methods on any `t.*()` builder:

### Basic Validator

```typescript
import { t } from '@directive-run/core';

schema: {
  facts: {
    // Custom validator – rejects zero or negative quantities
    quantity: t.number().validate(v => v > 0),

    // Built-in min/max for common numeric bounds
    price: t.number().min(0),
  },
}
```

### Refinement with Error Messages

`.refine()` adds validation with a descriptive error message:

```typescript
schema: {
  facts: {
    // Validate format with a regex, show a human-readable message on failure
    email: t.string().refine(
      s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
      "Must be a valid email address"
    ),

    // Enforce minimum length for security requirements
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
    // Built-in email type handles validation for you
    userEmail: t.email().nullable(),
  },
}
```

### Range Validation

```typescript
schema: {
  facts: {
    // Chain min/max to define an allowed range
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
    // Brand prevents accidentally swapping a UserId for an OrderId
    currentUserId: t.string().brand<"UserId">().nullable(),
    selectedOrderId: t.string().brand<"OrderId">().nullable(),
  },
}

// Type-safe – can't assign a UserId where OrderId is expected
```

Add validation to branded types:

```typescript
schema: {
  facts: {
    // Combine validation and branding – validate the format, then brand the result
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

- **[Schema & Types](/docs/schema-overview)** – Full `t.*` API reference and Zod integration
- **[Constraints](/docs/constraints)** – Runtime validation via constraints
