# Data-form definitions – example

A one-file showcase of every Directive definition surface expressed as
**data** rather than functions, plus the introspection that only the
data form makes possible.

## Run

```bash
pnpm --filter @directive-run/example-data-triggers start
```

## What it shows

A traffic-light module that uses the data form everywhere:

```ts
constraints: {
  transition: {
    when: { phase: "red", elapsed: { $gte: 30 } },
    require: { type: "TRANSITION", to: "green" },
  },
},
events: {
  advanceTo: {
    patch: {
      $set: {
        phase:   { $ref: "value" },
        elapsed: 0,
        label:   { $template: "Set by ${userName} → ${value}" },
      },
    },
  },
},
resolvers: {
  transition: { requirement: "TRANSITION", key: ["to"], resolve: … },
},
derive: {
  isAdult:  { compute: { age: { $gte: 18 } } },
  fullName: { compute: { $template: "${firstName} ${lastName}" } },
},
```

The script subscribes to `system.observe()` and prints each
`constraint.evaluate` event's `whenExplain` – the per-clause `✓/✗`
breakdown that only a data predicate makes available.

It also dumps `system.inspect().constraints[].whenSpec` to show the
predicate object surfacing through the public inspection API.

## Read next

- [`docs/concepts/data-triggers.md`](../../docs/concepts/data-triggers.md) – concept page
- [`docs/rfcs/0004-data-configuration-triggers.md`](../../docs/rfcs/0004-data-configuration-triggers.md) – full RFC
