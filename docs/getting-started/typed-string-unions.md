# `t.string<Union>()` — Lead With This

The single highest-leverage feature for legibility in a Directive module is
the typed-union schema constructor:

```ts
schema: {
  status: t.string<'idle' | 'loading' | 'ready' | 'error'>(),
}
```

This declares both a **runtime string fact** and a **TypeScript union type**
in one shot. Every read narrows automatically; every write is checked.

## Without the generic

```ts
// ❌ what you do without t.string<Union>()
schema: {
  status: t.string(),
}

derivation.create('isReady', ({ facts }) =>
  facts.status === 'ready', // ← `facts.status` is just `string`
);

event.handle('NEXT', ({ facts }) => {
  facts.status = 'reaady'; // ← typo, no compile error
});
```

You either accept untyped status strings (and weather typos) or you wrap
every read in a type predicate. Both are unnecessary.

## With the generic

```ts
// ✓ with t.string<Union>()
schema: {
  status: t.string<'idle' | 'loading' | 'ready' | 'error'>(),
}

derivation.create('isReady', ({ facts }) =>
  facts.status === 'ready', // ← facts.status: 'idle' | 'loading' | 'ready' | 'error'
);

event.handle('NEXT', ({ facts }) => {
  facts.status = 'reaady'; // ← Type error: Type '"reaady"' is not assignable
});
```

Hover the fact in your editor; the union shows up. Discriminated narrowing
just works:

```ts
constraint.create({
  given: ({ facts }) => facts.status === 'loading', // narrows to 'loading'
  effect: ({ facts }) => {
    // facts.status: 'loading' here
    facts.status = 'ready';
  },
});
```

## Same idiom across builders

| Builder | Generic form | Use case |
|---|---|---|
| `t.string<U>()` | `t.string<'a' \| 'b'>()` | Discriminated state |
| `t.array<T>()` | `t.array<Item>()` | Typed collections |
| `t.object<T>()` | `t.object<{ id: string }>()` | Typed records |
| `t.union<T>()` | `t.union<string \| number \| null>()` | Polymorphic payloads |

Same trick everywhere: the generic narrows the TypeScript type without
changing the runtime validator. Runtime stays `typeof === 'string'` (or
`Array.isArray`, etc.) — the TS compiler does the rest.

## When to use a runtime-validated form instead

The generic is type-only. It accepts ANY string at runtime. If you need
runtime validation (a server boundary, a payload from an untrusted source),
combine with `.validate()` or use `t.enum()`:

```ts
// Runtime + type validated:
schema: {
  status: t.enum('idle', 'loading', 'ready', 'error'),
}

// OR
schema: {
  status: t
    .string<'idle' | 'loading' | 'ready' | 'error'>()
    .validate((v) => ['idle', 'loading', 'ready', 'error'].includes(v)),
}
```

For internal facts (set by your own handlers), the type-only form is
sufficient. For payloads from outside, layer on validation.

## Lead with this in your own examples

Most Directive learning content under-uses this. Newcomers see `t.string()`
and assume it's the only string type. Showing `t.string<Union>()` in your
first example sets the right expectation: types are first-class, not an
afterthought.

## See also

- [Facts API](../api/facts.md) — full schema-builder reference
- [Migrating from XState § discriminated `status`](../migrating-from-xstate.md#discriminated-status-is-the-de-facto-pattern)
