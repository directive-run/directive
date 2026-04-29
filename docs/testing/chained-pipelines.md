# Testing Chained Resolver Pipelines

Most non-trivial Directive modules have constraint chains: an event triggers
a resolver, which writes a fact, which triggers a downstream constraint,
which kicks another resolver. Tests that drive these chains need to flush
asynchronously through every step.

## Use `flushAsync` from `@directive-run/core/testing`

```ts
import { describe, expect, it } from 'vitest';
import { createSystem } from '@directive-run/core';
import { flushAsync } from '@directive-run/core/testing';

it('completes the load → process → settle chain', async () => {
  const sys = createSystem({ module: createDataModule(deps) });
  sys.start();

  sys.events.LOAD();
  await flushAsync();

  expect(sys.facts.status).toBe('ready');
  expect(sys.facts.items).toHaveLength(3);
  sys.destroy();
});
```

`flushAsync` runs 3 microtask passes interleaved with 2 `setTimeout(0)` macrotasks.
This is enough for any chain up to 3 resolvers deep, which covers the vast
majority of real modules.

## When 3 deep isn't enough

Long chains (4+ sequential resolvers) need an additional `flushAsync()` call
per extra step. There's no penalty — `flushAsync` is idempotent on a settled
system.

```ts
sys.events.START_FIVE_STEP_PIPELINE();
await flushAsync();
await flushAsync(); // 4th resolver waits one more tick
expect(sys.facts.status).toBe('done');
```

If you need this often, your module is likely doing too much in one cycle —
consider whether the steps belong in different modules or whether some can
collapse into derivations.

## The same-constraint re-fire stall

This is the #1 reason a Directive test silently hangs. A constraint cannot
re-fire itself within the same `flushAsync` window — the engine deduplicates
to prevent infinite loops.

**Symptom:** assertion after `flushAsync()` times out at vitest's default
(5s). No error, just a hang.

**Cause:** the constraint's body changed a fact that the constraint's own
trigger predicate reads, expecting it to fire again.

**Fix:** add `ctx.requeue()` (shipped in `@directive-run/core@1.2.0`) inside
the constraint body when same-constraint re-fire is intentional:

```ts
constraint.create({
  given: ({ facts }) => facts.queue.length > 0,
  effect: ({ facts, ctx }) => {
    const next = facts.queue[0];
    facts.queue = facts.queue.slice(1);
    process(next);
    if (facts.queue.length > 0) {
      ctx.requeue(); // explicit opt-in — same constraint will re-fire
    }
  },
});
```

If you don't want self-recursion, split into two constraints with distinct
trigger facts. The pattern that almost always works:

```ts
// Constraint 1: drains queue
// Constraint 2: enters final state when queue empty
```

## Asserting on derivations vs facts

Derivations recompute lazily. Reading `sys.derive.X` triggers the read.
Reading `sys.facts.X` returns the stored value. After `flushAsync()` both are
stable — but if you read derivations during the chain (mid-flush) they may
return stale values. Always assert *after* the await.

## Don't `vi.useFakeTimers()` mid-flush

Directive's resolver scheduler uses real microtasks. Fake timers freeze the
microtask queue and starve resolvers. Use fake timers only when you have an
**imperative** `setTimeout` in the consumer (like a `useTickWhile` interval) —
not inside the module's resolver chain.

See [fake timers](./fake-timers.md) for the supported pattern.

## Cross-module pipelines

When testing a system with multiple modules + `crossModuleDeps`, one
`flushAsync` flushes both. The deps wiring is synchronous; only the resolvers
themselves need flushing.

```ts
const sys = createSystem({
  modules: { a: createA(), b: createB() },
  crossModuleDeps: ({ a }) => ({ b: { aStatus: () => a.facts.status } }),
});
sys.start();

sys.modules.a.events.START();
await flushAsync();

expect(sys.modules.a.facts.status).toBe('ready');
expect(sys.modules.b.derive.derivedFromA).toBe('...');
```

## Anti-pattern: rolling your own `flushAsync`

Several code-bases (Minglingo had 49 instances) wrote local helpers like:

```ts
async function flushAsync() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
```

Don't. Use the export. The shipped version stays in lockstep with internal
scheduler changes; a local copy will drift.

## See also

- [`@directive-run/core/testing`](https://www.npmjs.com/package/@directive-run/core) — full testing exports
- [Fake timers](./fake-timers.md) — `vi.useFakeTimers()` integration
- [Migrating from XState § same-constraint re-fire](../migrating-from-xstate.md#same-constraint-re-fire-the-silent-stall)
