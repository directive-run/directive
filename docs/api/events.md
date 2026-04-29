# Events: `events.X(payload)` is canonical

Two ways to dispatch into a system:

```ts
// Canonical:
sys.events.SUBMIT({ values });

// Legacy / generic:
sys.dispatch({ type: 'SUBMIT', values });
```

**Use `events.X(payload)`.** The generic `dispatch({type, ...})` shape exists
for tooling that doesn't know event names at compile time. Application code
should always use the typed accessor.

## Why one over the other

- **`events.X(payload)` is fully typed.** Hovering tells you the payload
  shape; misspelling the event name is a compile error.
- **`events.X(payload)` is what devtools renders.** The generic dispatch
  shows up too, but with less detail.
- **`events.X(payload)` reads better at the call site.** It's the same
  affordance as XState's `send({ type: 'X', ... })` minus the redundant
  type-property pattern.

The generic dispatch stays available for adapters and tools — for example, a
WebSocket bridge that receives `{type, ...rest}` from a peer can forward it
verbatim with `sys.dispatch(frame)`.

## Type narrowing

When events have discriminated payloads (item type variants):

```ts
event.handle('SUBMIT', ({ payload, facts }) => {
  // payload: { values: FormValues; idempotencyKey: string }
  facts.pendingSubmit = payload;
});
```

The handler's `payload` parameter is narrowed to the schema you declared.
This works for both canonical and generic dispatch — but only the canonical
form gives you autocomplete.

## Cross-module events

When you have a system with multiple modules, dispatch to a specific module:

```ts
const sys = createSystem({
  modules: {
    party: createPartyModule(),
    game: createGameModule(),
  },
});
sys.start();

sys.modules.party.events.GAME_ENDED({ gameId });
```

For deeper detail on cross-module flows — including how the receiving module
reacts via constraints — see [cross-module events](../composition/cross-module-events.md).

## Don't `dispatch` from inside a constraint or resolver

Constraints and resolvers run in response to facts; mutating facts is the
right way to "dispatch" forward. Calling `sys.events.X()` from inside a
constraint creates a hidden control-flow loop that the devtools can't render
linearly.

If you need to chain steps, use a discriminated `status` fact:

```ts
// Constraint that "dispatches" by writing the status:
constraint.create({
  given: ({ facts }) => facts.status === 'submitting',
  effect: async ({ facts, deps }) => {
    await deps.submit();
    facts.status = 'awaitingConfirmation'; // ← downstream constraint picks up
  },
});
```

See [internal events](../patterns/internal-events.md) for the full pattern.

## Event handlers can be async

```ts
event.handle('LOAD', async ({ payload, facts, deps }) => {
  facts.status = 'loading';
  const data = await deps.fetch(payload.url);
  facts.data = data;
  facts.status = 'ready';
});
```

But: prefer to put async work in a **resolver** (declared via the schema +
constraint pair) rather than the event handler. Resolvers are first-class
to the cache; async work in handlers bypasses some optimizations.

This is one of the few places Directive deliberately gives you both
ergonomics — async handlers are convenient for one-shot work, resolvers are
right for chained pipelines.

## See also

- [Cross-module events](../composition/cross-module-events.md)
- [Internal events](../patterns/internal-events.md)
- [Migrating from XState § sendTo / dispatch](../migrating-from-xstate.md#tldr-concept-mapping)
