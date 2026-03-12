# Directive

**Constraint-driven runtime for TypeScript.** Declare requirements. Let the runtime resolve them.

[![npm](https://img.shields.io/npm/v/@directive-run/core)](https://www.npmjs.com/package/@directive-run/core)
[![license](https://img.shields.io/npm/l/@directive-run/core)](./LICENSE)

## What is Directive?

Directive is a state management library that automatically resolves what your system needs. Instead of imperatively managing state transitions, you:

1. **Declare constraints** &ndash; What must be true
2. **Define resolvers** &ndash; How to make it true
3. **Let the runtime figure out when** &ndash; Automatic reconciliation

## Installation

```bash
npm install @directive-run/core
# or
pnpm add @directive-run/core
# or
yarn add @directive-run/core
```

## Quick Start

```typescript
import { createModule, createSystem, t, type ModuleSchema } from '@directive-run/core';

// Define your schema (single source of truth for all types)
const schema = {
  facts: {
    userId: t.number(),
    user: t.object<{ id: number; name: string } | null>(),
  },
  derivations: {
    isLoggedIn: t.boolean(),
    greeting: t.string(),
  },
  events: {},
  requirements: {
    FETCH_USER: {},
  },
} satisfies ModuleSchema;

// Create the module
const userModule = createModule("user", {
  schema,

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
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        const response = await fetch(`/api/users/${context.facts.userId}`);
        context.facts.user = await response.json();
      },
    },
  },

  // Derivations: Computed values with auto-tracking
  derive: {
    isLoggedIn: (facts) => facts.user !== null,
    greeting: (facts) => facts.user ? `Hello, ${facts.user.name}!` : "Please log in",
  },

  // Events: Type-safe state mutations
  events: {},
});

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

// Set userId - the constraint will automatically trigger FETCH_USER
system.facts.userId = 123;

// Wait for resolution
await system.settle();
console.log(system.read("greeting")); // "Hello, John!"
```

## React Integration

```bash
npm install @directive-run/react
```

```tsx
import { useDerived, useDispatch } from '@directive-run/react';

function UserGreeting({ system }) {
  const greeting = useDerived(system, "greeting");
  const isLoggedIn = useDerived(system, "isLoggedIn");

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

| Framework | Package | Features |
|-----------|---------|----------|
| **React** | `@directive-run/react` | Hooks with useSyncExternalStore |
| **Vue** | `@directive-run/vue` | Composables with reactive refs |
| **Svelte** | `@directive-run/svelte` | Stores with `$` syntax |
| **Solid** | `@directive-run/solid` | Signals with fine-grained reactivity |
| **Lit** | `@directive-run/lit` | Reactive Controllers for Web Components |

## Packages

| Package | Description |
|---------|-------------|
| [`@directive-run/core`](./packages/core) | Core runtime, modules, systems, plugins, testing |
| [`@directive-run/react`](./packages/react) | React hooks (useFact, useDerived, useEvents, etc.) |
| [`@directive-run/vue`](./packages/vue) | Vue composables with reactive refs |
| [`@directive-run/svelte`](./packages/svelte) | Svelte stores with `$` syntax |
| [`@directive-run/solid`](./packages/solid) | Solid signals with fine-grained reactivity |
| [`@directive-run/lit`](./packages/lit) | Lit reactive controllers for Web Components |
| [`@directive-run/ai`](./packages/ai) | AI agent orchestration, guardrails, multi-agent |
| `@directive-run/ai/openai` | OpenAI / Azure / Together adapter |
| `@directive-run/ai/anthropic` | Anthropic Claude adapter |
| `@directive-run/ai/ollama` | Local Ollama inference adapter |
| `@directive-run/ai/gemini` | Google Gemini adapter |
| [`@directive-run/cli`](./packages/cli) | CLI – scaffolding, inspection, AI coding rules |
| [`@directive-run/knowledge`](./packages/knowledge) | Knowledge files, examples, and validation scripts |

## Documentation

- [Full Documentation](https://directive.run/docs)
- [API Reference](https://directive.run/api)
- [Examples](https://github.com/directive-run/directive/tree/main/examples)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, architecture overview, and release process.

## License

MIT
