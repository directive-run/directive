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
    run: (_facts, prevFacts, derived) => {
      if (prevFacts?.items.length !== derived.itemCount && derived.itemCount > 100) {
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

## Reading derivations from constraints and effects

Your constraint needs to gate on something computed. Your effect needs to
report a running total. Both get the module's derivations as a parameter:

| Body | Signature |
| --- | --- |
| derivation | `(facts, derived)` |
| constraint `when` / `require` | `(facts, derived)` |
| effect `run` | `(facts, prevFacts, derived)` |

`derived` is third for effects because `prevFacts` already holds second. An effect
that wants derivations and not `prevFacts` writes `run: (_facts, _prevFacts, derived)`.

**Read `derived` rather than reaching back through `system.derive`.** The
parameter is scoped to the module that declared the derivation, so it means the
same thing wherever the module ends up. `system.derive` is the single-module
accessor: in a `createSystem({ modules })` system it resolves a module *name*,
so the identical read that returned a value alone returns `undefined` once
composed — and a gate reading `undefined` is falsy, fires nothing, and says
nothing about why.

The scoping is strict in both directions: there is no way to reach *another*
module's derivations through `derived`. That is narrower than facts, where
`crossModuleDeps` grants cross-module reads.

### When a read is tracked

A read through `derived` records a dependency on the **auto-tracked path** — a
synchronous body, no explicit `deps`, reading before any `await`. Such a body is
re-evaluated when the derivation moves without naming it anywhere.

Three cases do not track, and each is the rule that already applies to facts:

- **`deps` is declared.** The array is the whole dependency set; a derivation
  read but not named there will not wake the body.
- **`async: true` on a constraint.** The predicate runs outside the tracking
  context. Declare `deps`.
- **A read after an `await`.** Auto-tracking is a synchronous stack and has
  closed. Name it in `deps`, or move the read above the first `await`.

### One consequence worth knowing

An effect with no explicit `deps` that adopts `derived` now also re-runs when
that derivation goes stale — it has acquired a dependency it did not have
before. That is the parameter working, and it applies only where you use it.

### Not a performance optimization

`derived.itemCount` is not faster than `facts.items.length`. The read goes
through a proxy and is roughly break-even against recounting a small array. Use
the parameter because it is correct under composition and because it puts the
rule in one place — not for speed.

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

## Reading your own writes

Write a fact and read a derivation of it later in the same body, and you get the
value that follows from the write:

```typescript
effects: {
  recalculate: {
    run: (facts, prevFacts, derived) => {
      facts.quantity = 5;
      derived.subtotal;   // reflects quantity === 5
    },
  },
},
```

An effect body runs inside a batch, so listeners are still notified once, at the
end, with the batch whole. The derivation is *invalidated* as you write and only
the announcement waits — which is the half that has to. Marking a derivation
stale is cheap and idempotent; announcing it early is what would let a subscriber
render a half-written batch.

The same holds in a constraint's `when()`, which was never batched. One rule
either way, so moving code between the two does not change what it reads.

## Tags travel down the graph

A tag on a fact is a claim about the value. A derivation carries the value
forward, so it carries the claim:

```typescript
schema: {
  facts: { email: t.string().meta({ tags: ["pii"] }) },
  derivations: { domain: t.string() },
},
derive: { domain: (facts) => facts.email.split("@")[1] },
```

```typescript
system.meta.byTag("pii");
// [ { type: "fact", id: "email", ... },
//   { type: "derivation", id: "domain", ..., via: "inherited" } ]

system.meta.derivation("domain")?.inheritedTags; // ["pii"]
```

`via: "inherited"` separates a claim someone wrote from one the graph inferred,
so a redactor or an audit filter can act on both and still tell them apart.
Inheritance is transitive: a derivation reading a derivation reading a tagged
fact inherits too.

### Saying where the claim stops

Some derivations are the point at which the claim stops holding — a hash, a
bucket, a count, a redaction. Say so:

```typescript
derive: {
  bucket: {
    compute: (facts) => hash(facts.email) % 16,
    meta: { inheritsTags: false },
  },
},
```

That is a statement about the value, so it holds downstream too: a derivation
reading `bucket` is not walked through to `bucket`'s inputs. It is a separate
key rather than an empty `tags: []` so a derivation can be sanitized *and*
tagged something unrelated at the same time.

### What it can and cannot tell you

Inheritance follows what a derivation actually read on its last computation,
which is what makes it work without a `deps` array. It also means a body that
branches records the branch the current state takes:

```typescript
derive: { shown: (facts) => (facts.consented ? facts.email : "") },
```

While `consented` is true, `shown` inherits `pii`. When it flips, `shown` stops
reading `email` and stops inheriting — which is accurate about the value right
now, and says nothing about the value in a state the program has not reached.

Read `byTag("pii")` as "every value carrying PII in the state the system is in",
not "every value that ever could". For the second question you want the source,
not the runtime.

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
