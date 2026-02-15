---
title: Installation
description: Install Directive and set up your project with TypeScript, React, or vanilla JavaScript.
---

Get Directive set up in your project in under a minute. {% .lead %}

---

## Requirements

- **Node.js** 18.0 or higher
- **TypeScript** 5.0 or higher (recommended but optional)

---

## Install the Package

Using npm:

```shell
npm install @directive-run/core
```

Using pnpm:

```shell
pnpm add @directive-run/core
```

Using yarn:

```shell
yarn add @directive-run/core
```

---

## Package Exports

Directive uses subpath exports for tree-shaking and smaller bundles:

```typescript
// Core API – modules, systems, and type builders
import { createModule, createSystem, t } from '@directive-run/core';

// React adapter – reactive hooks for facts and derivations
import { useFact, useDerived, useDispatch } from '@directive-run/react';

// Plugins – extend the system with logging, devtools, or persistence
import { loggingPlugin, devtoolsPlugin, persistencePlugin } from '@directive-run/core/plugins';

// Testing utilities – mock resolvers and control async timing
import { createTestSystem, createMockResolver, flushMicrotasks } from '@directive-run/core/testing';
```

---

## TypeScript Configuration

Directive is written in TypeScript and provides full type inference. For the best experience, ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "strict": true,                  // Required for full type inference
    "moduleResolution": "bundler",   // Enables scoped package resolution
    "target": "ES2022"               // Proxy and WeakRef support
  }
}
```

{% callout title="Module Resolution" %}
If you're using Node.js module resolution, you may need to set `"moduleResolution": "node16"` or `"nodenext"` instead of `"bundler"`.
{% /callout %}

---

## Bundle Size

Directive is designed to be lightweight:

| Export | Minified | Gzipped |
|--------|----------|---------|
| `@directive-run/core` | ~8 KB | ~3 KB |
| `@directive-run/react` | ~2 KB | ~1 KB |
| `@directive-run/vue` | ~2 KB | ~1 KB |
| `@directive-run/svelte` | ~2 KB | ~1 KB |
| `@directive-run/solid` | ~2 KB | ~1 KB |
| `@directive-run/lit` | ~2 KB | ~1 KB |
| `@directive-run/core/plugins` | ~4 KB | ~1.5 KB |

All exports are tree-shakeable. Import only what you use.

---

## Framework Setup

### React

```tsx
import { createSystem } from '@directive-run/core';
import { useFact, useDerived } from '@directive-run/react';
import { userModule } from './modules/user';

// Create and start the system at module scope
const system = createSystem({ module: userModule });
system.start();

// No provider needed – pass the system directly to hooks
function App() {
  const displayName = useDerived(system, "displayName");

  return <div>Hello, {displayName}</div>;
}
```

### Vue

```html
<script setup>
import { createSystem } from '@directive-run/core';
import { useFact } from '@directive-run/vue';
import { userModule } from './modules/user';

// Create the system
const system = createSystem({ module: userModule });
system.start();

// Pass system explicitly to hooks
const name = useFact(system, 'name');
</script>
```

### Svelte

```html
<script>
  import { createSystem } from '@directive-run/core';
  import { useFact } from '@directive-run/svelte';
  import { userModule } from './modules/user';

  // Create the system
  const system = createSystem({ module: userModule });
  system.start();

  // Pass system explicitly to hooks
  const name = useFact(system, 'name');
</script>
```

### Vanilla TypeScript

```typescript
import { createSystem } from '@directive-run/core';
import { userModule } from './modules/user';

const system = createSystem({ module: userModule });
system.start();

// Subscribe to derivation changes with a callback
system.watch("displayName", (newValue, prevValue) => {
  console.log('Display name changed:', newValue);
});

// Setting a fact triggers constraints and resolvers automatically
system.facts.userId = 123;

// Wait for all async resolvers to finish before reading results
await system.settle();
```

---

## AI Setup

To use Directive's AI agent orchestration, install the AI package:

```shell
pnpm add @directive-run/core @directive-run/ai
```

Then import a provider adapter via subpath exports:

### OpenAI

```typescript
import { createAgentStack } from '@directive-run/ai';
import { createOpenAIRunner } from '@directive-run/ai/openai';

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
const stack = createAgentStack({ runner, agents: { assistant: { instructions: "You are helpful." } } });
```

### Anthropic

```typescript
import { createAgentStack } from '@directive-run/ai';
import { createAnthropicRunner } from '@directive-run/ai/anthropic';

const runner = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
```

### Ollama (local)

```typescript
import { createAgentStack } from '@directive-run/ai';
import { createOllamaRunner } from '@directive-run/ai/ollama';

const runner = createOllamaRunner(); // defaults to localhost:11434
```

| Subpath | Description |
|---------|-------------|
| `@directive-run/ai` | Agent orchestration, streaming, guardrails |
| `@directive-run/ai/openai` | OpenAI, Azure, Together, any OpenAI-compatible API |
| `@directive-run/ai/anthropic` | Anthropic Claude models |
| `@directive-run/ai/ollama` | Local Ollama inference |

---

## Development Setup

For the best development experience, add the devtools plugin:

```typescript
import { createSystem } from '@directive-run/core';
import { devtoolsPlugin, loggingPlugin } from '@directive-run/core/plugins';
import { userModule } from './modules/user';

const system = createSystem({
  module: userModule,

  // Stack plugins for visibility into every state change
  plugins: [
    loggingPlugin({ level: 'debug' }),
    devtoolsPlugin(),
  ],

  // Enable time-travel to step through state history
  debug: {
    timeTravel: true,
    maxSnapshots: 100,
  },
});

system.start();
```

---

## CDN Usage

For quick prototyping, you can use Directive from a CDN:

```html
<script type="module">
  // Import directly from a CDN – no build step needed
  import { createModule, createSystem, t } from 'https://esm.sh/@directive-run/core';

  // Define a minimal counter module
  const counterModule = createModule("counter", {
    schema: {
      facts: { count: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts) => { facts.count = 0; },
  });

  // Wire it up and start
  const system = createSystem({ module: counterModule });
  system.start();

  // Mutate facts directly – the proxy tracks the change
  system.facts.count++;
  console.log(system.facts.count); // 1
</script>
```

---

## Troubleshooting

### Cannot find module @directive-run/react

Ensure your TypeScript config uses a compatible module resolution:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

### Type errors with facts

Make sure you've initialized all facts in the `init` function. Uninitialized facts will have `undefined` type.

### Bundle too large

Check that you're only importing what you need. Avoid:

```typescript
// Pulls in everything, defeating tree-shaking
import * as Directive from '@directive-run/core'; // Don't do this
```

Instead:

```typescript
// Import only what you need – unused exports are removed at build time
import { createModule, createSystem } from '@directive-run/core';
```

---

## Next Steps

- **[Quick Start](/docs/quick-start)** &ndash; Build your first module
- **[Core Concepts](/docs/core-concepts)** &ndash; Understand the mental model
- **[React Adapter](/docs/adapters/react)** &ndash; Full React setup guide

