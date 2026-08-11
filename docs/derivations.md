# Derivations

Derivations are computed reads over facts. They're memoized: a derivation that
reads `facts.a + facts.b` only recomputes when `a` or `b` change. This is one
of Directive's biggest wins over hand-rolled reactivity – and it has rules.

Derivations are declared inside a module, in its `derive` block. A derivation
body is called with two positional arguments, `(facts, derived)`.

## The two rules

1. **Derivations must be pure.** No side effects, no clock reads, no
   `Math.random()`, no environment reads.
2. **Derivations can compose with other derivations** – invalidation
   propagates through the chain.

Break rule 1 and you read stale values. Break rule 2 – well, you can't, the
engine handles it. But naming it explicitly is worth a section.

## Pure derivations

```ts
const cart = createModule("cart", {
  schema: {
    facts: {
      status: t.string<"idle" | "ready">(),
      items: t.array<string>().of(t.string()),
    },
    derivations: {
      isReady: t.boolean(),
      itemCount: t.number(),
      topItem: t.string().nullable(),
    },
  },

  derive: {
    isReady: (facts) => facts.status === "ready",
    itemCount: (facts) => facts.items.length,
    topItem: (facts) => facts.items[0] ?? null,
  },
});
```

These all read facts only. The memo invalidates when any read fact changes.
Reading `system.derive.isReady` is `O(1)` after the first compute.

Dependencies are tracked by what the body actually reads – there is no deps
array to keep in sync.

## Composition: derivations that read other derivations

```ts
derive: {
  isReady: (facts) => facts.status === "ready",
  itemCount: (facts) => facts.items.length,

  readyAndHasItems: (_facts, derived) => derived.isReady && derived.itemCount > 0,
}
```

Read other derivations via the second parameter, `derived` – not via
`system.derive.X`. The parameter is the tracked path; `system.derive` is the
outside-the-module read accessor and reaching for it from inside a body does
not register the dependency, so the composed value will not invalidate when
its input changes.

The parameter is named `derived` because it is a value – the derived values as
they stand right now – not an instruction to derive something.

**Lead with this in your mental model**: derivations form a DAG. Facts feed
derivations; derivations feed derivations; the framework hooks subscribe to
leaves and re-render only when an ancestor fact changes.

## Anti-pattern: clock reads in derivations

```ts
// ❌ broken – derivation reads Date.now()
derive: {
  isStale: (facts) => Date.now() - facts.lastUpdatedMs > 5000,
}
```

Nothing tells the memo that `Date.now()` changed. Read `system.derive.isStale`
twice, ten seconds apart, and you get the same value the second time.

**Fix**: drive the staleness from a fact that gets dispatched on a tick:

```ts
schema: {
  facts: {
    lastUpdatedMs: t.number(),
    nowMs: t.number(), // dispatched on a tick from the consumer
  },
  derivations: { isStale: t.boolean() },
  events: { TICK: {} },
},

events: {
  TICK: (facts) => {
    facts.nowMs = Date.now();
  },
},

derive: {
  isStale: (facts) => facts.nowMs - facts.lastUpdatedMs > 5000,
},
```

The consumer wires the tick:

```tsx
useTickWhile(system, () => true, "TICK", 1000);
```

Now `nowMs` is a tracked read, and the derivation invalidates correctly.

## Anti-pattern: side effects in derivations

```ts
// ❌ broken – derivation logs
derive: {
  count: (facts) => {
    console.log("recomputing count"); // side effect
    return facts.items.length;
  },
}
```

Derivations may compute many times during development (devtools subscriptions,
StrictMode double-render). Logs, fetches, dispatches – none of these belong.

To *react* to a value changing, use an effect for fire-and-forget work, or a
constraint plus a resolver when the reaction has to be something the engine
tracks to completion:

```ts
schema: {
  // ...facts and derivations as above
  requirements: { TRIM_CART: {} },
},

effects: {
  warnOnLargeCart: {
    run: (facts, prev) => {
      if (prev?.items.length !== facts.items.length && facts.items.length > 100) {
        console.log("over 100");
      }
    },
  },
},

constraints: {
  trim: {
    when: (_facts, derived) => derived.itemCount > 100,
    require: { type: "TRIM_CART" },
  },
},

resolvers: {
  trim: {
    requirement: "TRIM_CART",
    resolve: async (req, context) => {
      context.facts.items = context.facts.items.slice(0, 100);
    },
  },
},
```

All three receive the module's derivations. A derivation body is called
`(facts, derived)`; a constraint's `when()` and `require()` take `derived`
second as well, and an effect's `run()` takes it third, after `prev` — which is
how the constraint above gates on `itemCount` instead of recounting the array.

Read `derived` rather than reaching back through `system.derive`. The parameter
is scoped to the module that declared it, so it keeps meaning the same thing
once the module is composed into a `createSystem({ modules })` — `system.derive`
resolves a module *name* in that shape, and the same read that returned a value
in a single-module system silently returns `undefined`.

Reads through it are tracked. A constraint or a synchronous effect that
consults a derivation is re-evaluated when that derivation moves, without
naming it in `deps`. An async effect still has to declare its dependencies —
its reads happen past an `await`, where auto-tracking cannot see them.

## Reading external state (the hard case)

If a derivation truly needs external state – say, "is the user authenticated"
where auth lives outside Directive – make it a fact, not a derivation. Wire the
external state in through an event:

```tsx
useEffect(() => {
  const sub = authClient.onChange((u) => {
    system.events.AUTH_CHANGED({ userId: u?.id ?? null });
  });

  return sub.unsubscribe;
}, [system]);
```

The module then has `facts.userId`, and derivations read it as a tracked read.

## React hooks: granular subscriptions

`useDerived(system, "name")` subscribes only to that derivation. Re-renders
fire when its value changes. This replaces the XState `useSelector(state,
selector)` pattern with first-class granularity.

```tsx
function ItemCount({ system }) {
  const count = useDerived(system, "itemCount");

  return <span>{count} items</span>;
}
```

Adding an item to `facts.items` re-renders `<ItemCount />`. Changing
`facts.lastUpdatedMs` does not.

## Top-of-funnel placement

Derivation composition is the single most under-documented Directive feature.
Most newcomers' first reaction is "this is just a getter" – until they see
derivations reading derivations and realize the point. If you take one thing
from this page: lead with `(facts, derived) => derived.X && derived.Y` in your
own examples.

## See also

- [Migrating from XState – concept mapping](./migrating-from-xstate.md#tldr-concept-mapping)
- [Internal events](./patterns/internal-events.md) – `status` as discriminator
- [Fake timers](./testing/fake-timers.md) – when intervals matter
