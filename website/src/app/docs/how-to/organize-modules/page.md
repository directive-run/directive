---
title: How to Organize Modules for a Growing App
description: Module structure, naming conventions, and cross-module dependencies as your app scales.
---

When to split modules, naming conventions, cross-module deps, and file structure for growing apps. {% .lead %}

---

## The Problem

Small apps work fine with a single module. As features grow, that module becomes a dumping ground – 50 facts, 30 constraints, unrelated resolvers tangled together. Refactoring later is painful because everything depends on everything. Without a clear strategy for when to split and how to connect modules, teams either split too early (unnecessary indirection) or too late (monolith module).

## The Solution

```
src/
├── modules/
│   ├── auth/
│   │   ├── index.ts          # createModule + exports
│   │   ├── schema.ts         # Schema definition
│   │   ├── constraints.ts    # Auth constraints
│   │   └── resolvers.ts      # Auth resolvers
│   ├── cart/
│   │   ├── index.ts
│   │   ├── schema.ts
│   │   ├── constraints.ts
│   │   └── resolvers.ts
│   └── notifications/
│       └── index.ts          # Small modules stay in one file
├── system.ts                 # createSystem – composes all modules
└── app.tsx
```

```typescript
// modules/auth/schema.ts
import { t } from '@directive-run/core';

export const authSchema = {
  token: t.string().optional(),
  user: t.object<{ id: string; name: string; role: string }>().optional(),
  status: t.string<'idle' | 'loading' | 'authenticated' | 'error'>(),
};

// modules/auth/index.ts
import { createModule } from '@directive-run/core';
import { authSchema } from './schema';
import { authConstraints } from './constraints';
import { authResolvers } from './resolvers';

export const authModule = createModule('auth', {
  schema: authSchema,
  init: (facts) => {
    facts.token = undefined;
    facts.user = undefined;
    facts.status = 'idle';
  },
  derive: {
    isAuthenticated: (facts) => facts.status === 'authenticated',
  },
  constraints: authConstraints,
  resolvers: authResolvers,
});
```

```typescript
// modules/cart/index.ts
import { createModule, t } from '@directive-run/core';

export const cartModule = createModule('cart', {
  schema: {
    items: t.array<{ productId: string; qty: number }>(),
    coupon: t.string().optional(),
  },

  init: (facts) => {
    facts.items = [];
    facts.coupon = undefined;
  },

  derive: {
    itemCount: (facts) => facts.items.reduce((sum, i) => sum + i.qty, 0),
    isEmpty: (facts) => facts.items.length === 0,
  },

  constraints: {
    // Cross-module: require auth before checkout
    checkout: {
      crossModuleDeps: ['auth.isAuthenticated'],
      when: (facts, derive, cross) =>
        !derive.isEmpty && cross.auth.isAuthenticated,
      require: { type: 'CHECKOUT' },
    },
  },

  resolvers: {
    checkout: {
      requirement: 'CHECKOUT',
      resolve: async (req, context) => {
        await fetch('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({ items: context.facts.items }),
        });
        context.facts.items = [];
      },
    },
  },
});
```

```typescript
// system.ts
import { createSystem } from '@directive-run/core';
import { authModule } from './modules/auth';
import { cartModule } from './modules/cart';
import { notificationsModule } from './modules/notifications';

export const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
    notifications: notificationsModule,
  },
});

// Access namespaced facts
system.facts.auth.user;
system.facts.cart.items;
```

## Step by Step

1. **One domain, one module** – auth, cart, notifications are separate concerns. Each module owns its schema, constraints, and resolvers.

2. **Split files when a module grows** – small modules (< 100 lines) stay in a single `index.ts`. Larger modules split schema, constraints, and resolvers into separate files.

3. **`crossModuleDeps` for cross-cutting concerns** – the cart's `checkout` constraint reads `auth.isAuthenticated` without importing the auth module directly. The system wires this up at composition time.

4. **`createSystem` composes modules** – each module's facts are namespaced (`system.facts.auth.user`), and cross-module dependencies are resolved automatically.

## Common Variations

### Module factory for reusable patterns

```typescript
import { createModuleFactory } from '@directive-run/core';

// Factory for CRUD modules
const createCrudModule = createModuleFactory((name: string, endpoint: string) => ({
  schema: {
    items: t.array(),
    loading: t.boolean(),
  },
  init: (facts) => {
    facts.items = [];
    facts.loading = false;
  },
  constraints: {
    fetch: {
      when: (facts) => facts.items.length === 0 && !facts.loading,
      require: { type: `FETCH_${name.toUpperCase()}` },
    },
  },
  resolvers: {
    fetch: {
      requirement: `FETCH_${name.toUpperCase()}`,
      resolve: async (req, context) => {
        context.facts.loading = true;
        const res = await fetch(endpoint);
        context.facts.items = await res.json();
        context.facts.loading = false;
      },
    },
  },
}));

export const productsModule = createCrudModule('products', '/api/products');
export const ordersModule = createCrudModule('orders', '/api/orders');
```

### When to split

| Signal | Action |
|--------|--------|
| Module has > 10 facts | Consider splitting |
| Constraints reference unrelated facts | Split into separate modules |
| Two developers work on the same module | Split by ownership boundary |
| Module name requires "and" (e.g., "auth-and-profile") | Split |
| Facts are only used together | Keep in one module |

## Related

- [Multi-Module](/docs/advanced/multi-module) – composition API details
- [Module & System](/docs/module-system) – `createModule` and `createSystem` reference
- [Dynamic Modules](/docs/how-to/dynamic-modules) – runtime module registration
