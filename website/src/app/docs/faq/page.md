---
title: FAQ
description: Frequently asked questions about Directive and how to get help.
---

Common questions about Directive, answered. {% .lead %}

---

## Getting Started

### What is Directive?

Directive is a constraint-driven state management library for TypeScript. Instead of manually dispatching actions or calling setters, you declare **what must be true** (constraints) and **how to make it true** (resolvers). The runtime automatically orchestrates state changes.

### When should I use Directive?

Directive excels when your application has:
- **Complex interdependencies** between state values
- **Async operations** that depend on each other
- **Business rules** that must always be satisfied
- **AI agents** or workflows with multiple steps

For simple state (a counter, a toggle), Directive might be overkill. Consider starting with simpler solutions and migrating when complexity grows.

### How is Directive different from Redux/Zustand?

| Aspect | Redux/Zustand | Directive |
|--------|---------------|-----------|
| State updates | Imperative (dispatch actions) | Declarative (constraints) |
| Dependencies | Manual tracking | Automatic |
| Async handling | Middleware (thunks, sagas) | Built-in resolvers |
| Side effects | External (middleware) | First-class (effects) |
| Time-travel | Plugin required | Built-in |

### How is Directive different from XState?

XState models explicit state machines with defined transitions. Directive models **requirements** that must be satisfied. XState is great for UI flows; Directive is great for data orchestration.

---

## Constraints & Resolvers

### Why didn't my constraint fire?

Common reasons:

1. **The `when` condition is false** - Check that all conditions are met
2. **Another constraint has higher priority** - Check priority values
3. **The requirement is already being resolved** - Resolvers dedupe by default
4. **The system hasn't settled** - Call `await system.settle()` to wait

Debug with the devtools plugin:

```typescript
import { devtoolsPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});
```

### Why is my resolver running multiple times?

1. **No deduplication key** - Add a `key` function to your resolver
2. **The constraint fires repeatedly** - Check if your `when` condition oscillates
3. **Facts are changing during resolution** - Use `context.facts` carefully

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    // Dedupe by user ID
    key: (req) => `fetch-user-${req.payload.userId}`,
    resolve: async (req, context) => {
      // ...
    },
  },
},
```

### What's the difference between effects and resolvers?

| Effects | Resolvers |
|---------|-----------|
| Fire-and-forget | Fulfill requirements |
| Run on fact changes | Run when constraints activate |
| No retry/timeout | Built-in retry/timeout |
| Synchronous or async | Always async |

Use **effects** for: logging, analytics, DOM updates, notifications.
Use **resolvers** for: API calls, data loading, state transitions.

---

## Performance

### Are derivations expensive?

Derivations use dependency tracking and memoization. They only recompute when their dependencies change. For complex computations, they're often **faster** than manual memoization because tracking is automatic.

### How many constraints are too many?

There's no hard limit. Constraint evaluation is O(n) where n is the number of constraints. In practice, hundreds of constraints work fine. If you have thousands, consider splitting into multiple modules.

### Does Directive work with Server Components?

Yes! Directive is SSR-ready:

```typescript
// Server: create system and serialize
const system = createSystem({ module: myModule });
const snapshot = system.getSnapshot();

// Client: hydrate from snapshot
const system = createSystem({
  module: myModule,
  initialFacts: snapshot.facts,
});
```

---

## TypeScript

### How do I get full type inference?

Use the `t` type builders in your schema:

```typescript
import { t } from 'directive';

const myModule = createModule("app", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      status: t.literal("idle", "loading", "error"),
    },
  },
  // Types flow automatically to constraints, resolvers, etc.
});
```

### Why are my types not inferring?

Common issues:

1. **Missing explicit type on object** - Use `t.object<MyType>()`
2. **Circular references** - Break cycles with explicit types
3. **Complex unions** - Simplify or use `t.custom<MyType>()`

---

## React Integration

### Do I need to wrap my app in a Provider?

No. Directive uses a system-first pattern where hooks take the system as their first parameter. No provider or context is needed:

```tsx
import { useFact } from 'directive/react';

function MyComponent() {
  const count = useFact(system, "count");
  return <p>{count}</p>;
}
```

### Why is my component re-rendering too often?

1. **Reading too broadly** - Select only the specific facts you need
2. **Missing selector memoization** - Use `useFact` with a stable selector
3. **Derivation recreating** - Check derivation dependencies

```tsx
// Bad: subscribe to a whole fact when you only need one property
const user = useFact(system, "user");

// Good: select only the property you need
const userName = useFact(system, "user", (u) => u?.name);
```

---

## Getting Help

### Where can I ask questions?

- **GitHub Issues**: [github.com/sizls/directive/issues](https://github.com/sizls/directive/issues)
- **GitHub Discussions**: [github.com/sizls/directive/discussions](https://github.com/sizls/directive/discussions)
- **Discord**: [discord.gg/directive](https://discord.gg/directive)

### How do I report a bug?

1. Check if it's already reported in [GitHub Issues](https://github.com/sizls/directive/issues)
2. Create a minimal reproduction
3. Include: Directive version, TypeScript version, error message, steps to reproduce

### How do I contribute?

See our [Contributing Guide](https://github.com/sizls/directive/blob/main/CONTRIBUTING.md). We welcome:
- Bug fixes
- Documentation improvements
- Feature proposals (open an issue first)
- Example applications

---

## Next Steps

- [Troubleshooting Guide](/docs/troubleshooting) - Common errors and solutions
- [Glossary](/docs/glossary) - Key terms and definitions
- [Core Concepts](/docs/core-concepts) - Deep dive into the mental model
