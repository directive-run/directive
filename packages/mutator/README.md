# `@directive-run/mutator`

> Discriminated mutation helper for Directive — collapse the
> `pendingAction` ceremony to a typed handler map.

```sh
npm install @directive-run/mutator
```

## What it solves

Across the 55-cycle Minglingo XState→Directive migration, **12 modules**
ended up with the same shape:

- a nullable `pendingAction` fact holding a discriminated union
- an event handler that sets it
- a constraint that fires while it's non-null
- a resolver that switches on the discriminator and clears the fact

That's ~50 lines of boilerplate per module. This package contributes all
four pieces from a single typed declaration, so you write only the
per-variant handler bodies.

## Quick start

```ts
import { createModule, createSystem, t } from '@directive-run/core';
import { defineMutator, mutate } from '@directive-run/mutator';

type FormMutations = {
  submit: { values: FormValues };
  cancel: {};
  retry: { reason: string };
};

interface FormDeps {
  submit: (values: FormValues) => Promise<FormValues>;
}

export function createFormModule(deps: FormDeps) {
  // Idiomatic Directive: handlers close over deps from the factory scope.
  const mut = defineMutator<FormMutations, FormFacts>({
    submit: async ({ payload, facts }) => {
      facts.values = await deps.submit(payload.values); // ← closure
    },
    cancel: ({ facts }) => { facts.values = null; },
    retry: async ({ payload, facts }) => {
      facts.lastRetryReason = payload.reason;
    },
  });

  return createModule('form', {
    schema: {
      facts: {
        ...mut.facts,                // → adds `pendingMutation`
        values: t.object<FormValues>().nullable(),
        lastRetryReason: t.string().nullable(),
      },
      events: { ...mut.events },     // → adds `MUTATE` event
      requirements: { ...mut.requirements }, // → adds PROCESS_MUTATION
    },
    init: (f) => {
      f.pendingMutation = null;
      f.values = null;
      f.lastRetryReason = null;
    },
    events: { ...mut.eventHandlers }, // sets pendingMutation on MUTATE
    constraints: { ...mut.constraints },
    resolvers: { ...mut.resolvers },
  });
}

// Usage:
const sys = createSystem({ module: createFormModule(deps), deps });
sys.start();
sys.events.MUTATE(mutate<FormMutations>('submit', { values }));
```

The `mutate(type, payload?)` helper is a typed payload constructor. The
type parameter restricts the payload shape — passing a wrong-shape
payload is a compile error.

## Anatomy

`defineMutator(handlers)` returns six fragments. You spread each into the
matching position of your `createModule` config:

| Fragment | Spreads into | Contributes |
|---|---|---|
| `mut.facts` | `schema.facts` | `pendingMutation: t.object<DiscriminatedUnion>().nullable()` |
| `mut.events` | `schema.events` | `MUTATE: PendingMutation<M>` |
| `mut.requirements` | `schema.requirements` | `PROCESS_MUTATION: {}` |
| `mut.eventHandlers` | `events:` | `MUTATE` handler that sets `pendingMutation` |
| `mut.constraints` | `constraints:` | `pendingMutation: { when, require }` |
| `mut.resolvers` | `resolvers:` | dispatches to the handler matching the discriminator |

The total spread cost is six lines. The savings come from not writing the
constraint/resolver/dispatch bodies yourself.

## Lifecycle

```
sys.events.MUTATE({ kind, payload, status: 'pending', error: null })
  → pendingMutation fact set to that value
  → constraint fires (pendingMutation !== null && status === 'pending')
  → resolver wakes
    → marks status: 'running'
    → looks up handler by kind
    → calls handler({ payload, facts, deps, requeue })
    → on success: pendingMutation = null
    → on throw: pendingMutation.error = message, status stays 'running'
                (constraint stops firing — no infinite retry)
```

> `kind` (not `type`) discriminates the mutation variant. Directive's
> own event dispatcher reserves the `type` field for its own
> event-name routing — colliding here would route the dispatch to a
> nonexistent event handler. `kind` keeps the two namespaces separate.

A failed mutation leaves `pendingMutation` non-null with `status:
'running'`. Read `pendingMutation.error` to surface to the UI; dispatch
a fresh `MUTATE` to retry (which overwrites the failed fact and re-fires).

## Concurrency

The default model is single-flight — one mutation in flight at a time. If
a new `MUTATE` arrives while a handler is running, it overwrites the fact
and the constraint re-fires once the in-flight handler completes (which
nulls the fact, then the new value triggers another firing).

If you need parallel mutations of different shapes (e.g. `submit` AND
`uploadFile` running concurrently), use two mutators with distinct fact
names — one per shape. v0.1 doesn't support parallel-of-same-shape; the
behaviour there is "last-write-wins."

## Same-constraint re-fire (`requeue`)

When one handler dispatches another `MUTATE` synchronously, the new
mutation may stall behind same-flush suppression in Directive's engine.
Call `ctx.requeue()` inside the handler to opt into a re-fire:

```ts
const mut = defineMutator<Mutations, MyFacts>({
  step1: async ({ facts, requeue }) => {
    facts.step1Done = true;
    // queue step2:
    facts.pendingMutation = mutate<Mutations>('step2');
    requeue(); // explicit — without this, step2 may stall
  },
  step2: ({ facts }) => { facts.step2Done = true; },
});
```

Most modules don't need `requeue` — the next user-event-driven `MUTATE`
fires fine. It's specifically for handler-cascades-into-handler.

See [Directive testing § same-constraint re-fire](https://docs.directive.run/testing/chained-pipelines#the-same-constraint-re-fire-stall).

## Type safety

The `MutationMap` generic is the source of truth. Every variant key
becomes:
- a possible `kind` value on `pendingMutation`
- a payload-constrained dispatch via `mutate('key', payload)`
- a required handler in the map (TypeScript errors if you forget one)
- a typed `payload` argument inside that handler

There is no runtime variant validation today — the type system catches
mismatches at the dispatch site, but a malformed `MUTATE` from outside
TypeScript (e.g. WebSocket frame) will still hit the resolver. If you
need runtime checks, validate at the boundary before dispatch.

## When NOT to use a mutator

- **One-off events with no error path.** A simple `event.handle('OPEN',
  (f) => { f.isOpen = true; })` doesn't need this — there's no async
  work, no rollback, no error fact.
- **Long-running streams.** Subscriptions, polls, websocket fan-in —
  these aren't single-shot mutations. Wire them through normal events.
- **Pure derivations.** If the result is a function of existing facts,
  use a `derive` instead of a mutator.

The mutator earns its weight when you have **multi-variant async work
with a discriminator**. That's the 12-instance shape from the migration.

## Optimistic updates + rollback

A future `@directive-run/optimistic` package will integrate with this
one — the planned `ctx.snapshot([keys])` API lets a handler snapshot
specific facts before mutating, with automatic rollback on throw. Until
that ships, do snapshots manually inside handlers:

```ts
submit: async ({ payload, facts, deps }) => {
  const previous = [...facts.values]; // manual snapshot
  facts.values = optimisticGuess(payload); // optimistic write
  try {
    facts.values = await deps.submit(payload);
  } catch (err) {
    facts.values = previous; // rollback
    throw err; // surface to pendingMutation.error
  }
},
```

## See also

- [Directive core](https://www.npmjs.com/package/@directive-run/core)
- [Migrating from XState — `pendingAction` pattern](https://docs.directive.run/migrating-from-xstate#the-pendingaction-pattern-12-cycles-confirmed)
- [Internal events](https://docs.directive.run/patterns/internal-events) — when `status` alone is enough
- [`MIGRATION_FEEDBACK.md` items 17 + 19](https://github.com/directive-run/directive/blob/main/docs/MIGRATION_FEEDBACK.md)

## License

MIT OR Apache-2.0
