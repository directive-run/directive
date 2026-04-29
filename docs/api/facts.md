# Facts

Facts are the typed reactive data store for a Directive module. They're
declared in the module's `schema`, mutated inside event handlers and
constraint effects, and observed via derivations and React hooks.

## Declaring facts

```ts
const schema = {
  status: t.string<'idle' | 'loading' | 'ready' | 'error'>(),
  items: t.array<Item>(),
  selectedId: t.string().nullable(),
  count: t.number(),
};

createModule('myModule', { schema, ... });
```

Each field is a `t.X()` builder that controls runtime validation (in dev) and
TypeScript types. See `t.string<Union>()`, `t.array<T>()`, `t.object<T>()`,
`t.union<T>()` for the typed-narrowing forms — these eliminate boilerplate
predicates throughout your module.

## Reading facts

```ts
// Inside an event handler:
event.handle('NEXT', ({ facts }) => {
  console.log(facts.status); // typed read
});

// Inside a derivation:
derivation.create('isReady', ({ facts }) => facts.status === 'ready');

// From outside the module:
sys.facts.status; // direct read
```

`sys.facts.X` returns the current value. Reads are reactive when wired through
a derivation or React hook; reads from imperative consumer code are
point-in-time only.

## Writing facts

```ts
event.handle('LOAD', ({ facts }) => {
  facts.status = 'loading'; // direct assignment
  facts.items = [];
});

constraint.create({
  given: ({ facts }) => facts.status === 'loading',
  effect: async ({ facts, deps }) => {
    const items = await deps.load();
    facts.items = items;
    facts.status = 'ready';
  },
});
```

Assignment is the entire write API. There's no `set(facts, 'status', 'X')`
helper because the proxy intercepts the assignment directly.

## The proxy contract

`facts` is a Proxy that:
1. Records the read in the causal cache (so derivations / hooks know what to
   invalidate)
2. Validates the write against the schema (in dev mode)
3. Diffs deeply to suppress no-op reactivity

This works only inside a fact-aware scope: event handlers, constraint
effects, derivations, React hooks. Helper functions you write outside these
scopes won't see the proxy.

### Helper-scope gotcha

```ts
// ❌ Helper called outside a handler — no proxy, no reactivity
function pickFirst(facts) {
  return facts.items[0];
}

// In a derivation:
derivation.create('first', ({ facts }) => pickFirst(facts));
```

This *does* work, because `facts` is the proxy when passed in. The mistake
that bites is grabbing a reference and mutating it later:

```ts
event.handle('OPEN', ({ facts }) => {
  const ref = facts.items;
  setTimeout(() => {
    ref.push(newItem); // ❌ mutation after handler returned
  }, 100);
});
```

Two bugs here: (1) the proxy may have moved on, (2) deep mutation isn't
reactive. Either set the new array atomically (`facts.items = [...ref, newItem]`)
or dispatch a follow-up event.

## JSON-roundtrippability is required

Facts MUST be JSON-roundtrippable values. Concretely:

| Allowed | Forbidden |
|---|---|
| string, number, boolean, null | `Date` (use `t.number()` for `Date.now()`) |
| arrays of the above | `Set` / `Map` (use `t.array<T>()` + `t.object<T>()`) |
| plain objects | `File`, `Blob`, `Promise` |
| nested combinations | class instances (lose prototype on roundtrip) |

As of `@directive-run/core@1.2.0`, assigning a forbidden value in dev emits
a runtime warning. In production builds the warning is tree-shaken. Convert
at the boundary:

```ts
async () => {
  const row = await db.query(...);
  return {
    id: row.id,
    createdAtMs: row.createdAt.getTime(), // Date → number
    metadata: row.metadata, // already plain object
  };
}
```

The reason is replay determinism + dehydrate/hydrate. A `Date` may serialize
fine but its identity won't survive a roundtrip — `===` comparisons in
constraints will silently break.

## Nullability

```ts
selectedId: t.string().nullable();
```

`.nullable()` allows `null` (not `undefined`). Initialize the fact to `null`
explicitly in the module's `init`:

```ts
createModule('x', {
  schema: { selectedId: t.string().nullable() },
  init: () => ({ selectedId: null }),
});
```

Skipping `init` for nullable facts makes them `undefined` initially, which
trips equality comparisons in derivations.

## Optional vs nullable

Use `nullable()` (allows `null`) for "not yet selected." Use `.optional()`
(allows `undefined`) for "field absent from payload" — primarily on event
payloads, rarely on facts.

## Default values

```ts
schema: {
  count: t.number().default(0),
  visible: t.boolean().default(true),
}
```

Module init seeds these automatically. You don't need an `init: () => ({...})`
handler if every fact has a default.

## See also

- [Derivations](../derivations.md) — purity rule for read-only computed values
- [Migrating from XState § JSON-roundtrippable facts](../migrating-from-xstate.md#json-roundtrippable-facts-load-bearing-rule)
- [`MIGRATION_FEEDBACK.md`](../MIGRATION_FEEDBACK.md) — items 2, 20, 24 on the JSON contract
