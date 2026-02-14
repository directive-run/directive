# @directive-run/core

Constraint-driven runtime for TypeScript. Declare requirements, let the runtime resolve them.

## Install

```bash
npm install @directive-run/core
```

## Usage

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    facts: { count: t.number() },
    derivations: { doubled: t.number() },
    events: { increment: {} },
    requirements: {},
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
  on: {
    increment: (facts) => {
      facts.count += 1;
    },
  },
});

const system = createSystem({ module: counter });
system.start();

system.events.increment();
console.log(system.facts.count);    // 1
console.log(system.read("doubled")); // 2
```

## Subpath Exports

| Import | Purpose |
|--------|---------|
| `@directive-run/core` | Core runtime, modules, systems |
| `@directive-run/core/plugins` | Logging, devtools, persistence plugins |
| `@directive-run/core/testing` | Mock resolvers, fake timers, assertions |
| `@directive-run/core/migration` | Redux/Zustand/XState migration helpers |

## License

MIT

[Full documentation](https://directive.run/docs)
