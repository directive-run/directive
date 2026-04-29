# Internal Events: Use `status` as the Event Bus

Directive deliberately has only one event channel: `dispatch`. There is no
parallel "internal event bus" because the discriminated `status` fact already
fills that role — and a hidden second channel would split tooling, devtools
visibility, and replay determinism.

## The pattern

Treat the `status` fact as a state-name AND an internal event in one shot.
Constraints fire on status transitions; consumers observe the same fact:

```ts
const schema = {
  status: t.string<
    | 'idle'
    | 'loading'
    | 'processingStep1'
    | 'processingStep2'
    | 'ready'
    | 'error'
  >(),
};

// Constraint: when status enters 'processingStep1', kick step 2
constraint.create({
  given: ({ facts }) => facts.status === 'processingStep1',
  effect: async ({ facts, deps }) => {
    await deps.runStep1();
    facts.status = 'processingStep2';
  },
});

// Constraint: when status enters 'processingStep2', settle
constraint.create({
  given: ({ facts }) => facts.status === 'processingStep2',
  effect: async ({ facts, deps }) => {
    await deps.runStep2();
    facts.status = 'ready';
  },
});
```

Each "internal event" is just `facts.status = 'newName'`. The downstream
constraint fires on the next tick. No new API needed.

## Why no `module.fire('INTERNAL_EVENT')`?

Considered and rejected (MIGRATION_FEEDBACK item 5):

1. **Two event channels = two sets of devtools wiring.** The shipped
   `devtoolsPlugin` records every dispatch and every fact change. Adding a
   third channel means three things to track and three places to look when
   replay diverges.
2. **Replay determinism requires a single ordering.** Two channels means a
   tiebreaker rule for "fact-change vs internal-event in the same tick" —
   one more rule to remember and one more silent footgun.
3. **The status discriminator already encodes the intent.** A name like
   `'pendingHostApproval'` is a state and an event simultaneously; you can't
   have one without the other.

## Discriminated payloads

When the "internal event" needs a payload, use a discriminated companion fact:

```ts
const schema = {
  status: t.string<'idle' | 'submitting'>(),
  pendingSubmit: t
    .object<{ values: FormValues; idempotencyKey: string }>()
    .nullable(),
};

// Caller sets both atomically:
event.handle('SUBMIT', ({ payload, facts }) => {
  facts.pendingSubmit = { values: payload.values, idempotencyKey: payload.key };
  facts.status = 'submitting';
});

// Constraint reads both:
constraint.create({
  given: ({ facts }) => facts.status === 'submitting' && facts.pendingSubmit !== null,
  effect: async ({ facts, deps }) => {
    await deps.submit(facts.pendingSubmit!);
    facts.pendingSubmit = null;
    facts.status = 'idle';
  },
});
```

Always null the payload when the constraint completes. A stale
`pendingSubmit` left dangling is the most common bug in this pattern — the
next status transition into `'submitting'` will reuse the old payload.

The upcoming [`@directive-run/mutator`](../MIGRATION_FEEDBACK.md) helper
formalizes this `status + pendingX` pair into a single `t.mutator<>()` schema
type. Until it ships, the manual pattern works fine.

## What about external events?

External events (user clicks, network responses, websocket frames) come in
through the normal `events.X(payload)` API. They're untyped from the module's
perspective — every `event.handle(...)` decides what to do.

The internal/external distinction collapses inside the module. From the
module's view, it's all "things that happen, possibly with a payload." The
status fact is just a structured way to describe "what should happen next."

## See also

- [Migrating from XState § discriminated `status`](../migrating-from-xstate.md#discriminated-status-is-the-de-facto-pattern)
- [Migrating from XState § `pendingAction` pattern](../migrating-from-xstate.md#the-pendingaction-pattern-12-cycles-confirmed)
