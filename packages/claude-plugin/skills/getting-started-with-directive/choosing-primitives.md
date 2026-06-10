# Choosing the right primitive

Directive ships six core primitives. Picking the wrong one — modeling
business state as a derivation, or running a side effect inside a
resolver — is the most common source of "Directive feels heavy"
complaints. The framework rewards getting this right; this page is the
decision matrix.

## The six primitives

| Primitive | Purpose | Reads | Writes | Triggers when |
|---|---|---|---|---|
| **`facts`** | Owned, mutable state | n/a | event handlers, `init`, resolvers, plugin pre-emit | the consumer writes to it |
| **`derivations`** | Pure, cached read-only views of facts | facts + other derivations | nothing | watched dependency changes |
| **`events`** | Typed mutation entry points | facts (via `f`) | facts (via `f`) | `system.events.name(payload)` or a source `publish` |
| **`constraints`** | Declarative "when X, require Y" rules | facts + derivations | NOTHING (emits requirements) | watched dependency changes |
| **`resolvers`** | Async work that fulfills a constraint's requirement | facts + derivations + `req.payload` | facts (via the resolver's `ctx.set`) | matched requirement enters the inflight queue |
| **`effects`** | Side effects that fire on fact change | facts + derivations | nothing inside Directive (writes to the outside world) | watched dependency changes |
| **`sources`** | External event streams mounted by the runtime | nothing | facts (via `publish` → event handler) | the external transport calls `publish(...)` |

## Decision tree

```
Does this thing belong to my system's state?
├── No  → it's external. Inbound or outbound?
│        ├── Inbound (something happens out there, I want to react)
│        │   ├── Once per ingest event (channel.on, addEventListener,
│        │   │   setInterval poll, MCP notification) → `source`
│        │   └── Continuous LLM token stream → AsyncIterable / runStream;
│        │       NOT a source (the source owns the connection; the
│        │       iterable owns the per-generation token sequence)
│        └── Outbound (state changed, I want to tell the world)
│            ├── Async work I want to retry / cancel / dedupe →
│            │   `resolver` (paired with a `constraint`)
│            └── Fire-and-forget side effect (log, ping, animate) →
│                `effect`
└── Yes → does it change over time?
         ├── Yes  → `fact` (declare in `schema.facts`, mutate via
         │         `events:` handlers and resolver `ctx.set`)
         └── No  → it's computed from other facts → `derivation`
                  (declare in `schema.derivations`, compute in `derive:`)

Then: does anything need to RUN when this changes?
├── A rule must trigger and require async work → `constraint`
│   (declarative `when`; emits a requirement; a `resolver` fulfills it)
├── A side effect that just runs → `effect`
└── Nothing — the LLM / hook / view just reads it next time → done
```

## Side-by-side comparisons

### `effect` vs `source`

The most common confusion. Both wrap something that fires "when
something changes."

| | `effect` | `source` |
|---|---|---|
| Direction | **Outbound** — your state changes, code runs | **Inbound** — the world changes, your state updates |
| Trigger | watched facts / derivations change | external transport calls `publish` |
| Body | imperative side effect | call `publish(eventName, payload)` |
| Lifecycle | per fact change | mount-once at `start`, detach at `stop` |
| Owner | tied to a fact/derivation watcher | owns its external transport (channel, socket, listener) |
| Replaces | hand-rolled `useEffect(() => { /* writes elsewhere */ }, [factA])` | hand-rolled `useEffect(() => { subscribe(); return unsub; }, [])` |

If the `useEffect` body is `subscribe + return unsubscribe`, declare a
source. If the `useEffect` body is `do something external because some
fact changed`, declare an effect.

### `derivation` vs `resolver` vs `effect`

All three "react to fact changes." Pick by what they OWN:

| | `derivation` | `resolver` | `effect` |
|---|---|---|---|
| Owns a **value** | YES (the computed result) | NO | NO |
| Owns a **promise** | NO | YES (retries, cancels, dedupes) | NO (fire-and-forget) |
| Owns a **side effect** | NO (pure) | NO (writes facts via `ctx.set`) | YES |
| Reruns on input change | always (cached) | NEVER automatically — only when the constraint emits a new requirement | always |
| Can be `await`-ed externally | n/a (read synchronously) | YES (constraints + `system.settle()`) | NO |
| Wrong-choice symptom | "I want a fact but it's always derived" → fact; "I want side effects" → effect | "I want this to retry but it doesn't" → likely should be an effect; "I want this to run every render" → likely should be a derivation | "I want to write a fact based on the change" → likely should be a resolver |

### `event` vs `resolver`

Both can write facts. Pick by who calls them:

| | `event` | `resolver` |
|---|---|---|
| Caller | external code (`system.events.name(payload)`) OR a source's `publish` | the engine, when a constraint emits a matching requirement |
| Body | synchronous mutation via `f` accessor | async, can retry, can await |
| Best for | user actions, source-driven mutations, deterministic state transitions | async work whose result is a fact update |

A typical pattern: `event` ingests raw data, `derivation` computes a
"needs sync?" flag, `constraint` triggers when the flag is true,
`resolver` does the async work, on success writes the result back via
another `event`. The same fact pipeline doesn't mix `events` and
`resolvers` for the SAME write — events are user/source-driven; resolvers
are engine-driven.

### `constraint` vs `derivation` (predicates)

Both can hold `when` predicates. Different jobs:

- **`derivation`** evaluates an expression against the current facts
  and returns a value. It's a noun. Other constraints / effects can
  watch it.
- **`constraint`** evaluates a `when` predicate and, when it matches,
  emits a `requirement` object that a resolver pattern-matches and
  fulfills. It's a verb. Constraints never write — they describe what
  the world MUST do.

The constraint's `when` may reference a derivation; that's the canonical
pattern (compute the condition cheaply once; multiple constraints share
it).

## Worked example

You're building a chat app that mirrors a Supabase realtime channel,
calls a moderation API on each message, and displays the result.

| Layer | Primitive | Why |
|---|---|---|
| `messages: t.array<Message>()` | `fact` | mutable list owned by this module |
| `unmoderated: t.array<Id>()` | `derivation` | filtered view of `messages` where `verdict === null` |
| `realtime` (the broker subscription) | `source` | mount-once external event stream → `publish('MESSAGE_RECEIVED', row)` |
| `MESSAGE_RECEIVED` handler | `event` | source-driven mutation; writes the row into `messages` |
| `moderateUnverified` | `constraint` + `resolver` | constraint emits `MODERATE` requirements for each `unmoderated` id; resolver calls the moderation API + writes `MODERATION_COMPLETE` |
| `MODERATION_COMPLETE` handler | `event` | engine-driven mutation; sets `verdict` on the message |
| `announceFlag` | `effect` | watches `unmoderated`, posts to #alerts when count crosses a threshold |
| `mcpHealthCheck` | `source` | the moderation API has a status SSE; mount once, publish health changes |

Every external touch is a `source` or a `resolver`. Every state field
is a `fact` or a `derivation`. Every "must-happen rule" is a
`constraint`. Every "do this when X" is an `effect`. Six primitives,
seven pieces of work, zero `useEffect` hooks.

## When you find yourself wanting to break the model

- "I want to call `set` from inside a derivation" — you wanted a
  resolver (the work has a result that's a fact update).
- "I want my effect to retry" — you wanted a resolver (resolvers
  have retry config; effects don't).
- "I want my source to write multiple facts at once" — declare an
  event whose handler does the batch write; the source publishes the
  event with the batch payload.
- "I want to write a fact from a constraint" — you wanted a
  resolver. Constraints declare; resolvers do.
- "I have a value that's derived from outside state (URL, env, time)"
  — declare it as a `fact` whose `init` reads the external value,
  and use a `source` if it changes (e.g. `popstate` listener).

## Related

- [`core-patterns.md`](./core-patterns.md) — module composition and
  the recommended structure of a module file.
- [`sources.md`](./sources.md) — the source primitive's full lifecycle
  and recipes.
- [`constraints.md`](./constraints.md) — `when` predicates, requirement
  shapes, and the `bind` / `owns` field-scoped CAS contract.
- [`resolvers.md`](./resolvers.md) — retry config, batch semantics, and
  the `ctx.set` write contract.
- [`anti-patterns.md`](./anti-patterns.md) — the things to avoid that
  every Directive consumer eventually tries.
