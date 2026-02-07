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
npm install directive
```

Using pnpm:

```shell
pnpm add directive
```

Using yarn:

```shell
yarn add directive
```

---

## Package Exports

Directive uses subpath exports for tree-shaking and smaller bundles:

```typescript
// Core API
import { createModule, createSystem, t } from 'directive';

// React adapter
import { DirectiveProvider, useFacts, useDerive } from 'directive/react';

// Plugins
import { loggingPlugin, devtoolsPlugin, persistencePlugin } from 'directive/plugins';

// Testing utilities
import { createTestSystem, mockResolver, fakeTimers } from 'directive/testing';
```

---

## TypeScript Configuration

Directive is written in TypeScript and provides full type inference. For the best experience, ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "target": "ES2022"
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
| `directive` (core) | ~8 KB | ~3 KB |
| `directive/react` | ~2 KB | ~1 KB |
| `directive/plugins` | ~4 KB | ~1.5 KB |

All exports are tree-shakeable. Import only what you use.

---

## Framework Setup

### React

```tsx
import { createSystem } from 'directive';
import { DirectiveProvider } from 'directive/react';
import { userModule } from './modules/user';

const system = createSystem({ module: userModule });

function App() {
  return (
    <DirectiveProvider system={system}>
      <YourApp />
    </DirectiveProvider>
  );
}
```

### Vue

```vue
<script setup>
import { createSystem } from 'directive';
import { provideDirective } from 'directive/vue';
import { userModule } from './modules/user';

const system = createSystem({ module: userModule });
provideDirective(system);
</script>
```

### Svelte

```svelte
<script>
  import { createSystem } from 'directive';
  import { setDirectiveContext } from 'directive/svelte';
  import { userModule } from './modules/user';

  const system = createSystem({ module: userModule });
  setDirectiveContext(system);
</script>
```

### Vanilla TypeScript

```typescript
import { createSystem } from 'directive';
import { userModule } from './modules/user';

const system = createSystem({ module: userModule });

// Subscribe to changes
system.subscribe((facts, derive) => {
  console.log('State updated:', facts);
});

// Update facts
system.facts.userId = 123;
await system.settle();
```

---

## Development Setup

For the best development experience, add the devtools plugin:

```typescript
import { createSystem } from 'directive';
import { devtoolsPlugin, loggingPlugin } from 'directive/plugins';
import { userModule } from './modules/user';

const system = createSystem({
  module: userModule,
  plugins: [
    loggingPlugin({ level: 'debug' }),
    devtoolsPlugin(),
  ],
  debug: {
    timeTravel: true,
    maxSnapshots: 100,
  },
});
```

---

## CDN Usage

For quick prototyping, you can use Directive from a CDN:

```html
<script type="module">
  import { createModule, createSystem, t } from 'https://esm.sh/directive';

  const counterModule = createModule("counter", {
    schema: { facts: { count: t.number() } },
    init: (facts) => { facts.count = 0; },
  });

  const system = createSystem({ module: counterModule });
  system.facts.count++;
  console.log(system.facts.count); // 1
</script>
```

---

## Troubleshooting

### "Cannot find module 'directive/react'"

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
import * as Directive from 'directive'; // Don't do this
```

Instead:

```typescript
import { createModule, createSystem } from 'directive';
```

---

## Next Steps

- **[Quick Start](/docs/quick-start)** - Build your first module
- **[Core Concepts](/docs/core-concepts)** - Understand the mental model
- **[React Adapter](/docs/adapters/react)** - Full React setup guide
