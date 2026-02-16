# Schema Patterns Example

Demonstrates the three supported patterns for defining Directive schemas.

## Pattern 1: Schema Builders (`t.*()`)

Uses Directive's schema builder functions with optional runtime validation.

```typescript
import { createModule, t } from "@directive-run/core";

createModule("user", {
  schema: {
    facts: {
      userId: t.number().min(0),
      user: t.object<User | null>(),
      status: t.string<Status>(),
    },
    derivations: {
      isLoading: t.boolean(),
      hasUser: t.boolean(),
    },
    events: {
      setUserId: { userId: t.number() },
      reset: {},
    },
    requirements: {
      FETCH_USER: { userId: t.number() },
    },
  },
  // ...
});
```

**Pros:**
- Lightweight, no dependencies
- Chainable validators (`.min()`, `.max()`, `.nonEmpty()`)
- Runtime introspection of schema

**Cons:**
- Less validation features than Zod

## Pattern 2: Type Assertions (`{} as {}`)

Uses `{} as { ... }` for type-only definitions.

```typescript
import { createModule } from "@directive-run/core";

createModule("user", {
  schema: {
    facts: {} as {
      userId: number;
      user: User | null;
      status: Status;
    },
    derivations: {} as {
      isLoading: boolean;
      hasUser: boolean;
    },
    events: {} as {
      setUserId: { userId: number };
      reset: {};
    },
    requirements: {} as {
      FETCH_USER: { userId: number };
    },
  },
  // ...
});
```

**Pros:**
- Cleanest, most concise syntax
- Pure TypeScript types, no runtime overhead

**Cons:**
- No runtime validation
- Runtime warnings about unknown keys

## Pattern 3: Zod Schemas

Uses Zod for rich runtime validation.

```typescript
import { createModule } from "@directive-run/core";
import { z } from "zod";

const StatusSchema = z.enum(["idle", "loading", "success", "error"]);
const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

createModule("user", {
  schema: {
    facts: {
      userId: z.number().min(0),
      user: UserSchema.nullable(),
      status: StatusSchema,
    },
    derivations: {
      isLoading: z.boolean(),
      hasUser: z.boolean(),
    },
    events: {
      setUserId: { userId: z.number().positive() },
      reset: {},
    },
    requirements: {
      FETCH_USER: { userId: z.number().positive() },
    },
  },
  // ...
});
```

**Pros:**
- Rich validation (email, url, regex, transforms, refinements)
- Excellent error messages
- Industry standard for TypeScript validation
- Full ecosystem (zod-to-json-schema, etc.)

**Cons:**
- Additional dependency
- Slightly more verbose for simple types

## Running the Examples

```bash
# Type check all patterns
pnpm typecheck

# Run each pattern
pnpm test:builders   # Pattern 1: t.*()
pnpm test:xstate     # Pattern 2: {} as {}
pnpm test:zod        # Pattern 3: Zod
pnpm test:mixed      # Pattern 4: Mixed

# Run all
pnpm test
```

## Mixing Patterns

You can mix patterns in the same schema:

```typescript
import { createModule, t } from "@directive-run/core";
import { z } from "zod";

createModule("mixed", {
  schema: {
    // Use t.*() for simple types
    facts: {
      count: t.number().min(0),
      name: t.string(),
    },
    // Use Zod for complex validation
    derivations: {
      email: z.string().email(),
    },
    // Use Type assertion for type-only
    events: {} as {
      increment: {};
      setName: { name: string };
    },
    requirements: {},
  },
  // ...
});
```

## Comparison Table

| Feature | `t.*()` | `{} as {}` | Zod |
|---------|---------|------------|-----|
| Type Safety | ✅ | ✅ | ✅ |
| Runtime Validation | ✅ Basic | ❌ | ✅ Full |
| Dependencies | None | None | zod |
| Syntax | Medium | Minimal | Verbose |
| Validators | `.min()`, `.max()` | None | Full suite |
| Error Messages | Basic | None | Detailed |
| Transforms | ❌ | ❌ | ✅ |
| Refinements | ❌ | ❌ | ✅ |

## Recommendation

- **Simple apps**: Use `t.*()` builders
- **Type-only, no validation**: Use type assertions `{} as {}`
- **Complex validation needs**: Use Zod
- **Already using Zod**: Use Zod schemas
