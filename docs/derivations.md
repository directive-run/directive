# Derivations

Derivations are computed reads over facts. They're memoized via the causal
cache: a derivation that reads `facts.a + facts.b` only recomputes when `a`
or `b` change. This is one of Directive's biggest wins over hand-rolled
reactivity — and it has rules.

## The two rules

1. **Derivations must be pure.** No side effects, no clock reads, no
   `Math.random()`, no environment reads.
2. **Derivations can compose with other derivations** — the cache propagates
   correctly.

Break rule 1 and the cache returns stale values. Break rule 2 — well, you
can't, the engine handles it. But naming it explicitly is worth a section.

## Pure derivations

```ts
derivation.create('isReady', ({ facts }) => facts.status === 'ready');

derivation.create('itemCount', ({ facts }) => facts.items.length);

derivation.create('topItem', ({ facts }) =>
  facts.items.length > 0 ? facts.items[0] : null,
);
```

These all read facts only. The cache invalidates when any read fact changes.
Reading `sys.derive.isReady` is `O(1)` after the first compute.

## Composition: derivations that read other derivations

```ts
derivation.create('isReady', ({ facts }) => facts.status === 'ready');

derivation.create('readyAndHasItems', ({ derive }) =>
  derive.isReady && derive.itemCount > 0,
);
```

Read other derivations via the `derive` parameter, NOT via `sys.derive.X`.
The `derive` parameter is the cache-tracked path; `sys.derive` reaches around
the cache and won't propagate correctly.

This pattern came up enough during the migration (cycle 4 onward) that it
deserves its own callout. **Lead with it in your mental model**: derivations
form a DAG. Facts feed derivations; derivations feed derivations; the React
hooks subscribe to leaves and re-render only when ancestor facts change.

## Anti-pattern: clock reads in derivations

```ts
// ❌ broken — derivation reads Date.now()
derivation.create('isStale', ({ facts }) =>
  Date.now() - facts.lastUpdatedMs > 5000,
);
```

The cache doesn't know `Date.now()` changed. If you read `sys.derive.isStale`
twice, 10 seconds apart, you get the same value the second time.

**Fix**: drive the staleness from a fact that gets dispatched on a tick:

```ts
const schema = {
  lastUpdatedMs: t.number(),
  nowMs: t.number(), // dispatched from a useTickWhile in the consumer
};

derivation.create('isStale', ({ facts }) =>
  facts.nowMs - facts.lastUpdatedMs > 5000,
);
```

The consumer wires the tick:

```tsx
useTickWhile(sys, () => true, 'TICK', 1000);
// where TICK handler does: facts.nowMs = Date.now()
```

Now the cache knows `nowMs` changed. The derivation invalidates correctly.

A future `t.timer({ms})` schema primitive (RFC) would let you skip the
manual ticking — declare a "this fact represents elapsed time since X" and
the engine handles re-evaluation. Until then, the manual tick is the answer.

## Anti-pattern: side effects in derivations

```ts
// ❌ broken — derivation logs
derivation.create('count', ({ facts }) => {
  console.log('recomputing count'); // side effect
  return facts.items.length;
});
```

Derivations may compute many times during dev (devtools subscriptions,
StrictMode double-render). Logs, fetches, dispatches — none of these belong.

If you want to react to a derivation changing, use a constraint:

```ts
constraint.create({
  given: ({ facts }) => facts.items.length > 100,
  effect: ({ facts }) => {
    console.log('over 100');
    // dispatch, fetch, whatever
  },
});
```

## Reading external state (the hard case)

If a derivation truly needs external state — say, "is the user authenticated"
where auth lives in a context outside Directive — make it a fact, not a
derivation. Wire the external state in via a subscription:

```tsx
useEffect(() => {
  const sub = authClient.onChange((u) => {
    sys.events.AUTH_CHANGED({ userId: u?.id ?? null });
  });
  return sub.unsubscribe;
}, [sys]);
```

The module then has `facts.userId` and derivations read it via the cache
correctly.

## React hooks: granular subscriptions

`useDerivation(sys, 'name')` subscribes only to that derivation. Re-renders
fire when the derivation's value changes (deep-equal check). This replaces
the XState `useSelector(state, selector)` pattern with first-class
granularity.

```tsx
function ItemCount({ sys }) {
  const count = useDerivation(sys, 'itemCount');
  return <span>{count} items</span>;
}
```

Adding a new item to `facts.items` re-renders `<ItemCount />`. Changing
`facts.lastUpdatedMs` does not.

## Top-of-funnel placement

Derivation composition (#9 in MIGRATION_FEEDBACK) is the single most
under-documented Directive feature. Most newcomers' first reaction is "this
is just a getter" — until they see derivations reading derivations and
realize the whole point. If you take one thing from this page: lead with
`derive: ({ derive }) => derive.X && derive.Y` in your own examples.

## See also

- [Migrating from XState — concept mapping](./migrating-from-xstate.md#tldr-concept-mapping)
- [Internal events](./patterns/internal-events.md) — `status` as discriminator
- [Fake timers](./testing/fake-timers.md) — when intervals matter
