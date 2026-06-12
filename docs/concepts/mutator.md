# `@directive-run/mutator` – discriminated mutation helper

> Collapse the `pendingAction` ceremony – fact + event + constraint +
> resolver – into a typed handler map. Closes the 12-instance shape
> that surfaced across a production migration into one declaration.

## The shape

Across a 55-cycle production XState → Directive migration, **12 modules**
ended up with the same four-piece pattern:

- a nullable `pendingAction` fact holding a discriminated union
- an event handler that sets it
- a constraint that fires while it is non-null
- a resolver that switches on the discriminator and clears the fact

That is ~50 lines of boilerplate per module times 12 modules.
`defineMutator(handlers)` contributes all four pieces from a single
typed declaration; you write only the per-variant handler bodies.

```ts
import { createModule, createSystem, t } from "@directive-run/core";
import { defineMutator, mutate } from "@directive-run/mutator";

type FormMutations = {
  submit: { values: FormValues };
  cancel: Record<string, never>;
  retry: { reason: string };
};

const mut = defineMutator<FormMutations, FormFacts>({
  submit: async ({ payload, facts }) => {
    facts.values = await deps.submit(payload.values);
  },
  cancel: ({ facts }) => {
    facts.values = null;
  },
  retry: async ({ payload, facts }) => {
    facts.lastRetryReason = payload.reason;
  },
});
```

> **Naming heads-up.** The mutation discriminator is **`kind`**, not
> `type`. Directive's event dispatcher reserves `payload.type` for its
> own event-name routing – `type` here collides with `MUTATE` and
> routes the dispatch to a non-existent event handler. The
> `mutate(kind, payload)` constructor builds the right shape for you.

## Setup

```ts
export function createFormModule(deps: FormDeps) {
  // Idiomatic Directive: handlers close over deps from factory scope.
  const mut = defineMutator<FormMutations, FormFacts>({
    submit: async ({ payload, facts }) => {
      facts.values = await deps.submit(payload.values); // ← closure
    },
    cancel: ({ facts }) => { facts.values = null; },
    retry: async ({ payload, facts }) => {
      facts.lastRetryReason = payload.reason;
    },
  });

  return createModule("form", {
    schema: {
      facts: {
        ...mut.facts,                          // → adds pendingMutation
        values: t.object<FormValues>().nullable(),
        lastRetryReason: t.string().nullable(),
      },
      events: { ...mut.events },               // → adds MUTATE
      requirements: { ...mut.requirements },   // → adds PROCESS_MUTATION
    },
    init: (f) => {
      f.pendingMutation = null;
      f.values = null;
      f.lastRetryReason = null;
    },
    events: { ...mut.eventHandlers },          // MUTATE sets pendingMutation
    constraints: { ...mut.constraints },
    resolvers: { ...mut.resolvers },
  });
}

const sys = createSystem({ module: createFormModule(deps), deps });
sys.start();
sys.events.MUTATE(mutate<FormMutations>("submit", { values }));
// → handler runs; on success, pendingMutation = null
```

## Anatomy – six fragments

`defineMutator(handlers)` returns six fragments. You spread each into the
matching position of `createModule`:

| Fragment | Spreads into | Contributes |
| --- | --- | --- |
| `mut.facts` | `schema.facts` | `pendingMutation: t.object<DiscriminatedUnion>().nullable()` |
| `mut.events` | `schema.events` | `MUTATE: PendingMutation<M>` |
| `mut.requirements` | `schema.requirements` | `PROCESS_MUTATION: {}` |
| `mut.eventHandlers` | `events:` | `MUTATE` handler that sets `pendingMutation` |
| `mut.constraints` | `constraints:` | `pendingMutation: { when, require }` |
| `mut.resolvers` | `resolvers:` | dispatches to the handler matching the discriminator |

The total spread cost is six lines. The savings come from not writing
the constraint / resolver / dispatch bodies yourself.

## Lifecycle

```
sys.events.MUTATE({ kind, payload, status: "pending", error: null })
  → pendingMutation fact set to that value
  → constraint fires (pendingMutation !== null && status === "pending")
  → resolver wakes
    → marks status: "running"
    → looks up handler by kind
    → calls handler({ payload, facts, requeue })
    → on success: pendingMutation = null
    → on throw:   pendingMutation.status = "failed" + .error = message
                  (constraint stops firing – no infinite retry; UI can
                   disambiguate "still running" from "stopped on error")
```

A failed mutation leaves `pendingMutation` non-null with `status: "failed"`
– a distinct status from `"running"` so the UI can disambiguate "still
working" from "stopped on error". Read `pendingMutation.error` to
surface to the UI; dispatch a fresh `MUTATE` to retry (which overwrites
the failed fact and re-fires).

> **XSS warning.** `pendingMutation.error` is plaintext `string` that
> may echo handler-thrown messages, which in turn may have interpolated
> user-controlled input. Render via `{error}` in JSX (default-escaped)
> or `textContent` – **never** `dangerouslySetInnerHTML`, markdown
> rendering, or any other HTML-evaluating sink. The runtime truncates
> captured errors to 500 characters as defense in depth, but that does
> not sanitize content; only escape on render.

## Concurrency – single-flight by default

One mutation in flight at a time. If a new `MUTATE` arrives while a
handler is running, it overwrites the fact and the constraint re-fires
once the in-flight handler completes (which nulls the fact, then the
new value triggers another firing).

If you need parallel mutations of different shapes (e.g. `submit` AND
`uploadFile` concurrently), use two mutators with distinct fact names –
one per shape. v0.1 does not support parallel-of-same-shape; the
behaviour there is "last-write-wins".

## Same-constraint re-fire (`requeue`)

When one handler dispatches another `MUTATE` synchronously, the new
mutation may stall behind same-flush suppression in Directive's engine.
Call `ctx.requeue()` inside the handler to opt into a re-fire:

```ts
const mut = defineMutator<Mutations, MyFacts>({
  step1: async ({ facts, requeue }) => {
    facts.step1Done = true;
    facts.pendingMutation = mutate<Mutations>("step2");
    requeue(); // explicit – without this, step2 may stall
  },
  step2: ({ facts }) => {
    facts.step2Done = true;
  },
});
```

Most modules do not need `requeue` – the next user-event-driven `MUTATE`
fires fine. It is specifically for handler-cascades-into-handler.

## Auto-cancel on supersede – `cancellable()`

For mutations where a fresh dispatch should cancel the prior in-flight
one – type-ahead search, debounce, throttle, request dedup – wrap the
handler with `cancellable()`:

```ts
import { defineMutator, cancellable } from "@directive-run/mutator";

const mut = defineMutator<MyMutations, MyFacts>({
  search: cancellable(
    { supersedeOn: "self", timeoutMs: 3_000 },
    async ({ payload, facts, signal }) => {
      const res = await fetch(`/q?${payload.q}`, { signal });
      facts.results = await res.json();
    },
  ),
  submit: async ({ payload, facts }) => {
    // No cancellation – plain handler.
    facts.values = await deps.submit(payload.values);
  },
});
```

| Option | Default | What |
| --- | --- | --- |
| `supersedeOn` | `"self"` | A new dispatch aborts the prior invocation. `"never"` keeps parallel runs. |
| `timeoutMs` | (none) | Abort after N ms from invocation start. |
| `setTimeout` | `globalThis.setTimeout` | Inject `virtualClock.setTimeout` for deterministic tests. |

The signal's `reason` carries a `CancelReason`:

```ts
type CancelReason =
  | { kind: "superseded" }
  | { kind: "timeout"; afterMs: number };
```

At runtime the value is a `CancelError` subclass (the typed reason
survives transit through `fetch(url, { signal })` and other web-platform
APIs that re-throw `signal.reason`). Use it inside handlers to
distinguish how the cancellation arrived.

### Test ergonomics

```ts
import { virtualClock } from "@directive-run/core";
const clock = virtualClock(0);
const wrapped = cancellable(
  { timeoutMs: 1_000, setTimeout: clock.setTimeout },
  handler,
);
// In tests: clock.advanceBy(1_001) fires the timeout deterministically.
```

## Recording cancellations for replay – `recordReplayable()`

`recordReplayable()` is `cancellable()` plus a synchronous `onCancel`
callback that fires the moment the AbortController calls `abort()` –
*before* the handler's pending await rejects with AbortError. The
callback receives a structured `CancelEvent` with the cancel kind,
payload, dispatch sequence, and a live facts reference.

Use this when you record a timeline (with `@directive-run/timeline`) and
want a replay or `directive bisect` to reason about *which* dispatches
were superseded vs which completed – not just see a free-form error
string.

```ts
import { defineMutator, recordReplayable } from "@directive-run/mutator";

const search = recordReplayable<MyFacts, { q: string }>(
  {
    supersedeOn: "self",
    timeoutMs: 3_000,
    onCancel: ({ facts, kind, payload, dispatchSeq }) => {
      // Pin the cancel event into facts so the timeline carries it.
      facts.cancellations.push({
        kind,
        queryAtCancel: payload.q,
        seq: dispatchSeq,
      });
    },
  },
  async ({ payload, facts, signal }) => {
    const res = await fetch(`/q?${payload.q}`, { signal });
    facts.results = await res.json();
  },
);
```

The callback is generic ("call me when abort fires"); pinning into facts
is one use case among many. Wire `onCancel` to Sentry breadcrumbs, a
Redux action log, an OpenTelemetry span, or a metrics sink with equal
ease. `onCancel` errors are caught and swallowed – the abort path stays
clean.

## Type safety

The `MutationMap` generic is the source of truth. Every variant key
becomes:

- a possible `kind` value on `pendingMutation`
- a payload-constrained dispatch via `mutate("key", payload)`
- a required handler in the map (TypeScript errors if you forget one)
- a typed `payload` argument inside that handler

There is no runtime variant validation today – the type system catches
mismatches at the dispatch site, but a malformed `MUTATE` from outside
TypeScript (e.g. a WebSocket frame) will still hit the resolver.
Validate at the boundary before dispatch if you need runtime checks.

The resolver also defends against prototype-pollution: only handlers
**owned** by the user-provided map (`Object.prototype.hasOwnProperty`)
are invoked. A dispatch with `kind: "constructor"` / `"toString"` /
`"__proto__"` fails with a clean `"no handler registered"` error rather
than resolving via the prototype chain.

## When NOT to use a mutator

- **One-off events with no error path.** A simple
  `event.handle("OPEN", (f) => { f.isOpen = true; })` does not need
  this – there is no async work, no rollback, no error fact.
- **Long-running streams.** Subscriptions, polls, WebSocket fan-in – not
  single-shot mutations. Wire through normal events.
- **Pure derivations.** If the result is a function of existing facts,
  use a `derive` instead.

The mutator earns its weight when you have **multi-variant async work
with a discriminator**. That is the 12-instance shape from the
migration.

## What it does NOT do

- ✅ Contributes 6 fragments – fact, event, requirement, eventHandler, constraint, resolver.
- ✅ Captures handler throws onto `pendingMutation.error` (truncated to 500 chars).
- ✅ Defends against prototype-pollution `kind` values.
- ✅ Composes with `cancellable()` / `recordReplayable()` / `withOptimistic()`.
- ❌ Not a runtime validator – malformed `MUTATE` payloads from outside TS still hit the resolver.
- ❌ Not parallel-same-shape – v0.1 is last-write-wins for that case.
- ❌ Not a rollback primitive – use [`@directive-run/optimistic`](./optimistic.md) for snapshot + restore-on-throw.
- ❌ Not an HTML sanitizer – `pendingMutation.error` is plaintext; escape on render.

## See also

- [Package README on GitHub](https://github.com/directive-run/directive/tree/main/packages/mutator)
- [`@directive-run/optimistic`](./optimistic.md) – snapshot + rollback on throw, composes with mutator
- [`@directive-run/timeline`](./timeline.md) – `recordReplayable` pins cancels for timeline replay
- [Migrating from XState – `pendingAction` pattern](https://docs.directive.run/migrating-from-xstate#the-pendingaction-pattern-12-cycles-confirmed)
