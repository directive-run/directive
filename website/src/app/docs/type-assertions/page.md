---
title: Type Assertions
description: Create custom type validators and assertions for Directive schemas.
---

Define custom validation logic for your schema types. {% .lead %}

---

## Custom Validators

Create validators with the `t.custom()` builder:

```typescript
import { t } from 'directive';

const positiveNumber = t.custom<number>({
  validate: (value) => typeof value === 'number' && value > 0,
  message: 'Must be a positive number',
});

schema: {
  facts: {
    quantity: positiveNumber,
    price: positiveNumber,
  },
}
```

---

## Email Validator Example

```typescript
const email = t.custom<string>({
  validate: (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return typeof value === 'string' && emailRegex.test(value);
  },
  message: 'Must be a valid email address',
});

schema: {
  facts: {
    userEmail: email.nullable(),
  },
}
```

---

## Range Validator

```typescript
function range(min: number, max: number) {
  return t.custom<number>({
    validate: (value) => value >= min && value <= max,
    message: `Must be between ${min} and ${max}`,
  });
}

schema: {
  facts: {
    rating: range(1, 5),
    percentage: range(0, 100),
  },
}
```

---

## Branded Types

Create branded types for extra safety:

```typescript
type UserId = string & { readonly brand: unique symbol };
type OrderId = string & { readonly brand: unique symbol };

const userId = t.custom<UserId>({
  validate: (v) => typeof v === 'string' && v.startsWith('user_'),
});

const orderId = t.custom<OrderId>({
  validate: (v) => typeof v === 'string' && v.startsWith('order_'),
});

// Type-safe - can't mix up IDs
schema: {
  facts: {
    currentUserId: userId.nullable(),
    selectedOrderId: orderId.nullable(),
  },
}
```

---

## Async Validation

For async validation, use constraints instead:

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

- See Type Builders for built-in types
- See Zod Integration for Zod schemas
- See Constraints for runtime validation
