# Next.js Integration: `server-only` and Vitest

Next.js's `server-only` package throws at import time if it's loaded outside a
React Server Component. When a Directive module imports a Next.js data-fetching
file (server actions, route handlers, server components), vitest's import graph
can hit `server-only` and crash the entire test run.

## Symptom

```
Error: This module cannot be imported from a Client Component module.
It should only be used from a Server Component.
  ❯ node_modules/server-only/index.js:1
  ❯ src/lib/data/queries.ts:3
  ❯ src/features/x/application/xModule.ts:5
```

The error fires before any test runs. You can't even get to the test body.

## Fix: alias `server-only` to a no-op in vitest config

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    alias: {
      'server-only': path.resolve(__dirname, './test/empty.ts'),
    },
  },
});
```

```ts
// test/empty.ts
export {};
```

This makes the import succeed. The module under test still gets the real
behavior in the dev server / production — only vitest sees the no-op.

## Per-test environment override

If only some test files hit the `server-only` path, you can scope the alias
with a top-of-file directive:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
// ... rest of test
```

Combine with the alias above. The directive prevents jsdom from being loaded
unnecessarily, which speeds up the run.

## Don't import server modules from Directive modules

The cleaner architecture: Directive modules accept `Deps` (resolvers, fetchers,
clock) via constructor injection. The Next.js layer wires up the real server
fetchers; tests wire in-memory fakes:

```ts
// xModule.ts — pure, no server-only imports
export interface XModuleDeps {
  loadX: () => Promise<X[]>;
}

export const createXModule = (deps: XModuleDeps) => createModule(...);
```

```ts
// app/page.tsx (Server Component) — wires the real fetcher
import 'server-only';
import { db } from '@/lib/db';

const sys = createSystem({
  module: createXModule({
    loadX: () => db.x.findMany(),
  }),
});
```

```ts
// xModule.test.ts — wires a fake
const sys = createSystem({
  module: createXModule({
    loadX: async () => [{ id: '1' }],
  }),
});
```

This keeps the module pure and removes the alias hack entirely. The alias is
the escape hatch for codebases that aren't ready to refactor.

## App Router caveat: `'use server'` files

A file with `'use server'` at the top exports server actions. These can't be
called from a vitest test that runs the same JS bundle — the bundler strips
the export. Either:

1. Test the server action separately via integration test (real Next.js dev
   server + a tool like Playwright)
2. Refactor the action's body into a plain function that the action wraps;
   test the plain function

Directive modules should call the plain function, not the action.

## See also

- [Migrating from XState — JSON-roundtrippable facts](../migrating-from-xstate.md#json-roundtrippable-facts-load-bearing-rule)
- [Chained pipelines](./chained-pipelines.md) — testing async resolver chains
