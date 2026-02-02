# Directive

**Constraint-driven runtime for TypeScript.** Declare requirements. Let the runtime resolve them.

## What is Directive?

Directive is a state management library that automatically resolves what your system needs. Instead of imperatively managing state transitions, you:

1. **Declare constraints** - What must be true
2. **Define resolvers** - How to make it true
3. **Let the runtime figure out when** - Automatic reconciliation

## Installation

```bash
npm install directive
# or
pnpm add directive
# or
yarn add directive
```

## Quick Start

```typescript
import { createModule, createSystem, t, forType } from 'directive';

// Define your module
const userModule = createModule("user", {
  schema: {
    userId: t.number(),
    user: t.any<{ id: number; name: string } | null>(),
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
  },

  // Constraints: Declare what must be true
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && facts.user === null,
      require: { type: "FETCH_USER" },
    },
  },

  // Resolvers: Define how to fulfill requirements
  resolvers: {
    fetchUser: {
      handles: forType("FETCH_USER"),
      resolve: async (req, ctx) => {
        const response = await fetch(`/api/users/${ctx.facts.userId}`);
        ctx.facts.user = await response.json();
      },
    },
  },

  // Derivations: Computed values with auto-tracking
  derive: {
    isLoggedIn: (facts) => facts.user !== null,
    greeting: (facts) => facts.user ? `Hello, ${facts.user.name}!` : "Please log in",
  },
});

// Create and start the system
const system = createSystem({ modules: [userModule] });
system.start();

// Set userId - the constraint will automatically trigger FETCH_USER
system.facts.userId = 123;

// Wait for resolution
await system.settle();
console.log(system.read("greeting")); // "Hello, John!"
```

## React Integration

```tsx
import { DirectiveProvider, useDerivation, useDispatch } from 'directive/react';

function App() {
  return (
    <DirectiveProvider system={system}>
      <UserGreeting />
    </DirectiveProvider>
  );
}

function UserGreeting() {
  const greeting = useDerivation<string>("greeting");
  const isLoggedIn = useDerivation<boolean>("isLoggedIn");

  return (
    <div>
      <p>{greeting}</p>
      {!isLoggedIn && <LoginButton />}
    </div>
  );
}
```

## Framework Support

Directive works with any framework:

- **React** - `directive/react` - Hooks with Suspense support
- **Vue** - `directive/vue` - Composables with reactive refs
- **Svelte** - `directive/svelte` - Stores with `$` syntax
- **Solid** - `directive/solid` - Signals with fine-grained reactivity
- **Lit** - `directive/lit` - Reactive Controllers for Web Components

## Key Concepts

### Facts
The source of truth. A typed key-value store with batch updates and subscriptions.

```typescript
system.facts.count = 42;           // Set a fact
const value = system.facts.count;  // Get a fact
```

### Constraints
Rules that produce requirements when conditions aren't met.

```typescript
constraints: {
  needsData: {
    when: (facts) => facts.dataId && !facts.data,
    require: { type: "FETCH_DATA", id: facts.dataId },
  },
},
```

### Resolvers
Async handlers that fulfill requirements with retry, timeout, and cancellation.

```typescript
resolvers: {
  fetchData: {
    handles: forType("FETCH_DATA"),
    retry: { attempts: 3, backoff: "exponential" },
    timeout: 5000,
    resolve: async (req, ctx) => {
      ctx.facts.data = await fetchData(req.id);
    },
  },
},
```

### Derivations
Computed values with automatic dependency tracking.

```typescript
derive: {
  total: (facts) => facts.price * facts.quantity,
  // Derivations can depend on other derivations
  totalWithTax: (facts, derive) => derive.total * 1.1,
},
```

## Comparison

| Feature | Directive | XState | Redux | Zustand | React Query |
|---------|-----------|--------|-------|---------|-------------|
| Async built-in | Yes | Via actors | Middleware | Manual | Yes |
| Auto-tracking | Yes | No | No | No | No |
| Retry/timeout | Built-in | Manual | Manual | Manual | Built-in |
| Cancellation | Built-in | Via actors | Manual | Manual | Built-in |
| Type inference | Full | Good | Partial | Good | Good |
| Time-travel | Built-in | Via inspector | DevTools | No | No |

## Plugins

```typescript
import { loggingPlugin, devtoolsPlugin, persistencePlugin } from 'directive/plugins';

const system = createSystem({
  modules: [myModule],
  plugins: [
    loggingPlugin({ level: "debug" }),
    devtoolsPlugin({ name: "my-app" }),
    persistencePlugin({ storage: localStorage, key: "app-state" }),
  ],
});
```

## Testing

```typescript
import { createTestSystem, mockResolver } from 'directive/testing';

const system = createTestSystem({
  modules: [myModule],
  mocks: {
    fetchUser: mockResolver(() => ({ id: 1, name: "Test" })),
  },
});

system.facts.userId = 1;
await system.settle();
expect(system.facts.user).toEqual({ id: 1, name: "Test" });
```

## Documentation

- [Full Documentation](https://directive.run/docs)
- [API Reference](https://directive.run/api)
- [Examples](https://github.com/DirectiveRun/DirectiveJS/tree/main/examples)

## License

MIT
