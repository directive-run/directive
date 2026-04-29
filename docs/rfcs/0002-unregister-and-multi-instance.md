# RFC 0002 — `unregisterModule()` + multi-instance modules

- **Status:** Draft (2026-04-29)
- **Author:** Jason Comes
- **MIGRATION_FEEDBACK ref:** Item 26
- **Related:** RFC 0001 (timer/clock — uses `defaultClock` per system)

## Summary

Two related additions to Directive's composition API:

1. **`system.unregisterModule(name)`** — runtime removal of a module from a live system, with defined cancellation semantics for in-flight resolvers.
2. **Multi-instance module spawning** — register N copies of the same module under distinct names (`atomFamily`-style), produced from a single module factory.

Both surface the same underlying primitive: dynamic mutation of a system's module set after `start()`. Today the set is frozen at `createSystem` time.

## Motivation

The Minglingo migration converged on these gaps in the `spawn` analogue analysis (Item 22 originally, refined in Item 26):

- **Per-turn `turnMachine`** in the realtime cluster wants one Directive system per active turn, with the parent `turnBasedGameMachine` opening + closing them as turns begin and end. Today, every turn requires `createSystem` + manual lifecycle. Cleanup on early termination has no engine support.
- **Per-player `playerScoreMachine`** in the team-wars cluster wants one module instance per joined player. Today, the player set is encoded as a single `Map`-shaped fact, losing the per-player module isolation that XState `spawnChild` provided.
- **Tournament brackets** want one module per active match, dynamically added when a match starts and removed when it completes.

Without engine support, every consumer hand-rolls:
1. A `Map<id, System>` registry.
2. Per-instance `createSystem` + `start` + `destroy` plumbing.
3. Custom dispose-on-error semantics that don't compose with the parent system's `destroy()`.

Three Minglingo cycles paid this tax (turnMachine, teamWarsMachine, tournamentMachine). A first-class API would close the gap.

## Proposed API

### `unregisterModule(name)`

```ts
const sys = createSystem({
  modules: {
    party: createPartyModule(),
    game: createGameModule(),
  },
});
sys.start();

// Later, when the game ends:
sys.unregisterModule("game");
// game's resolvers cancel; game's facts are dropped; party's
// crossModuleDeps that read game's facts get `undefined` and recompute.
```

**Cancellation semantics for in-flight resolvers** (the central design question):

- **In-flight resolvers receive an `AbortSignal`** via the existing `ctx` parameter. New `ctx.signal` is wired during the unregister flow.
- **Resolvers that don't observe `signal`** are detached but allowed to complete. Their writes to facts (which no longer exist) are silently dropped.
- **`unregisterModule` returns a Promise** that resolves when all in-flight resolvers have either completed or aborted. Callers awaiting it know the module is fully drained.
- **Cross-module dependents** (other modules' `crossModuleDeps` referencing the unregistered module) receive `undefined` from the wired functions. Their derivations recompute; their constraints reevaluate. If the dependent module has invariants that require the unregistered module to exist, that's the dependent module's problem to encode.

```ts
sys.unregisterModule("game"); // returns Promise<void>
```

### Multi-instance: `system.registerModule(name, moduleDef)` + factory composition

```ts
const sys = createSystem({
  modules: { party: createPartyModule() },
});
sys.start();

// When a new turn starts:
sys.registerModule(`turn:${turnId}`, createTurnModule({ turnId, gameId }));

// When the turn ends:
await sys.unregisterModule(`turn:${turnId}`);
```

The pair `(registerModule, unregisterModule)` lets the consumer add/remove module instances at runtime. Names are arbitrary strings; the consumer chooses naming conventions (e.g. `turn:<id>`, `player:<id>`). The module factory closes over per-instance config; each call produces a fresh `ModuleDef`.

### `system.modules.<name>` access

After `registerModule`, the new module is accessible via `sys.modules[name].events.X(payload)`, `sys.modules[name].facts.Y`, etc. — same shape as a static module.

For TypeScript, dynamic names lose static typing. Two options:

- **Loose typing**: `sys.modules[`turn:${id}`]` is typed as `SingleModuleSystem<ModuleSchema>` (generic).
- **Generic registry**: `sys.modules` becomes `Record<string, SingleModuleSystem<...>>` after the first dynamic register, opt-in via `system.unsafeDynamicModules()` to flip the type.

Recommendation: loose typing as the default (matches the runtime reality), with a `typedRegister<S extends ModuleSchema>(name, def)` overload that returns the typed handle for that specific instance.

## Cancellation semantics — the core design question

Three viable models for in-flight resolver cancellation:

### Option A — `AbortSignal` injected into `ctx.signal`

```ts
resolvers: {
  loader: {
    requirement: "LOAD",
    resolve: async (req, ctx) => {
      const data = await fetch(url, { signal: ctx.signal });
      ctx.facts.data = data;
    },
  },
},
```

Resolvers that observe `signal` cancel cleanly. Resolvers that ignore it run to completion; their writes to facts are dropped because the facts no longer exist.

**Pros:** matches the web-platform standard (`fetch`, `addEventListener`, `setTimeout` w/ `AbortSignal` proposal). Existing async libraries already support it. Cancellation is opt-in but well-incentivized.

**Cons:** silent drop of writes is debugging-hostile in dev. Mitigation: dev-mode warning when an unregistered module's resolver attempts a fact write.

### Option B — Synchronous detach with hard cancel

`unregisterModule` synchronously detaches the module's resolvers from the engine. In-flight Promise chains keep running but their writes never reach Directive's reactive layer.

**Pros:** simplest implementation. No new contract for resolvers.

**Cons:** orphaned async work continues to run (network, CPU) with no way to stop it. For long-running resolvers (file uploads, multi-second LLM streams) this is bad.

### Option C — Hybrid

`unregisterModule` synchronously detaches AND fires the `AbortSignal`. Resolvers that observe `signal` cancel; those that don't continue but drop their writes.

**Pros:** combines Option A's hooks with Option B's simplicity. The default behavior is correct; opt-in cancellation is correct.

**Cons:** requires plumbing `ctx.signal` through every resolver invocation, even ones that never use it.

### Recommendation

**Option C (hybrid).** The plumbing cost is small (one new field on `ctx`); the dual default-correct + opt-in-cancellable contract is the right ergonomic for v0.1. Option A alone leaves the orphaned-work problem; Option B alone leaves the network-still-running problem.

## Multi-instance design questions

### Identity for N-of-same-schema (`atomFamily` style)

XState's `spawnChild` returns an actor reference. Recoil's `atomFamily(key)` returns an atom. What's the Directive analogue?

**Proposal:** name strings are the identity. The consumer is responsible for `register(name, factory(input))` + `unregister(name)`. The engine doesn't manage a "family" abstraction; it manages a flat `Record<string, SingleModuleSystem>`.

The reason: `atomFamily`'s magic is reactive auto-instantiation on first access. That's a different feature ("get-or-create on read"). For Directive, registration is explicit; the consumer always knows when a new instance comes online.

If "auto-instantiate-on-read" becomes a real pattern, it becomes RFC 0003 layered on top of RFC 0002, not part of this scope.

### Cross-module deps to dynamic instances

`crossModuleDeps` in `createSystem` config is static — but RFC 0002's dynamic register/unregister means new modules need to be wired post-hoc. Two options:

**A.** Cross-module deps must be declared at register time:

```ts
sys.registerModule(
  `turn:${id}`,
  createTurnModule({ id }),
  {
    deps: ({ party }) => ({
      currentPlayerId: () => party.facts.currentPlayerId,
    }),
  },
);
```

**B.** A dependent module references a dynamic peer by name pattern:

```ts
crossModuleDeps: ({ party }, { matchPattern }) => ({
  party: {
    activeTurns: () => matchPattern(/^turn:/).map(t => t.facts.turnNumber),
  },
}),
```

Option A is concrete and predictable. Option B is more powerful but introduces a new query primitive (`matchPattern`) that needs its own design. Recommend A for v0.1; defer B to a follow-up.

### Lifecycle cascade

When the parent system destroys, dynamic instances destroy with it. When the parent unregisters a module that has dependents, dependents are notified (their `crossModuleDeps` returns `undefined`) but stay running.

There's NO automatic dependent-cleanup on parent unregister. If you want cascade, encode it in the consumer: when you unregister `party`, you also unregister every `turn:` module manually.

## Replay determinism

`registerModule` and `unregisterModule` calls are events that need to appear in the recorded event log for replay. Without recording them, replaying a system from `t=0` would never see the dynamic instances and their state stream would be missing.

**Proposal:** add `system.module.registered` + `system.module.unregistered` to `ObservationEvent`. Replay reconstructs a fresh system, then plays back the register/unregister calls in order, recreating the exact dynamic topology.

Module factories must be **identifiable by stable name** for replay — when replay sees `system.module.registered`, it needs to look up the factory. Either:

- **A.** Replay requires the consumer to pre-register factories by name in `createSystem({ moduleFactories: { turn: createTurnModule, player: createPlayerModule } })`. The recorded event includes `factoryName` + `instanceName` + serialized input.
- **B.** Module factories must be importable by ID; replay imports them dynamically. Bundler-hostile.

Recommend A.

## Open questions

1. **`unsafeDynamicModules()` type-flip ergonomics** — verbose but honest. Better name?
2. **Module-factory input must be JSON-serializable** for replay? Or only the visible schema state?
3. **What happens if `registerModule` is called with a name that already exists?** Throw? Replace? Recommend: throw — caller should explicitly unregister first.
4. **Memory:** if a consumer registers 10,000 dynamic modules without unregistering, the system grows unboundedly. Cap? Warn?
5. **`system.observe()` subscriptions when modules unregister** — do existing subscribers continue to receive events from the remaining modules? (Yes — observation is system-scoped, not module-scoped.)

## Migration path

`unregisterModule` and `registerModule` are strictly additive. No breaking changes.

The existing static-module shape (`createSystem({ modules: {...} })`) keeps working unchanged. Dynamic registration is an opt-in API surface.

For existing code that hand-rolls `Map<id, System>` patterns, migration is one-by-one: each `Map.set(id, createSystem(...))` becomes `parent.registerModule(`X:${id}`, factory(input))`. The consumer drops their custom registry; the engine takes over.

## Implementation sketch

```
packages/core/src/core/
  system.ts            # add registerModule, unregisterModule
  module-registry.ts   # new — factory-by-name lookup for replay
  types/system.ts      # add system.module.registered/unregistered
                       #     ObservationEvents
  resolvers.ts         # plumb ctx.signal through resolver invocations
                       # detach hooks on unregister
  engine.ts            # cancellation propagation; settle-and-detach
                       # in-flight refcounting
```

Estimated LOC delta: +600 source / +800 tests / +400 docs.
Estimated effort: 2-3 weeks for a solo dev with the cancellation
contract locked.

## Decision

This RFC is **draft**. Open for review. Defer implementation until:

1. AE-review-loop on this doc (security/correctness, architecture, DX, domain expert).
2. At least one concrete Minglingo use case prototyped on top of the proposed API (likely the realtime cluster's `turnMachine`-per-turn pattern, since the migration cycle for `turnBasedGameMachine` documents the exact pain this would close).
3. Determinism + replay path validated against `@directive-run/timeline`'s recorded streams.

## See also

- [`MIGRATION_FEEDBACK.md`](../MIGRATION_FEEDBACK.md) — Item 22 (rejected — `createSystem({ modules })` IS the idiom for static composition); Item 26 (this RFC's predecessor).
- [RFC 0001 — `t.timer({ms})`](./0001-t-timer.md) — `defaultClock` injection precedent for system-level config.
- [`@directive-run/timeline`](../../packages/timeline/README.md) — replay determinism contract that depends on stable module identification.
