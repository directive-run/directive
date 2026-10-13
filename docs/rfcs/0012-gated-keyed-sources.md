# RFC 0012 — Gated / keyed sources: a subscription whose lifecycle is a fact

- **Status:** Accepted – implemented 2026-08-17 (`@directive-run/core`, minor)
- **Extends:** RFC 0007 (source backpressure / `coalesce`), RFC 0008 (source observer protocol / `reportError`), RFC 0009 (async stop + DO eviction / `onEvict`, `evictTimeoutMs`)
- **Related:** RFC 0003 (resolver/constraint binding — `abortOn` is the same "a fact moved, drop the tail" instinct, applied to a resolver instead of a subscription)

## Summary

A `source` attaches at `system.start()` and tears down at `system.stop()`. That is the right lifecycle for a stream whose subscription is a constant of the system's life — a DO alarm, an MCP connection, a fixed `game:${gameId}` channel. It is the wrong lifecycle for a stream whose subscription **should come and go with the system's own state**: subscribe only after the initial load has run, tear down the moment the round ends or the user leaves, or re-subscribe to a *different* channel when the id it depends on changes.

Before this RFC, a source could not express that. The only ways to gate a subscription on state were to (a) drive it from a `useEffect`/host hook with a dependency array — the exact hook-as-bridge plumbing the `source` primitive was built to delete — or (b) tear the owning module down and re-register it, which is a sledgehammer. So consumers kept the gating in the hook, and the two halves of one concern (the subscription, and *when* it should be live) lived on different planes.

This RFC moves the gate onto the source. A source may declare a pure `key(facts) => string | null` (or the boolean sugar `active(facts) => boolean`). `null` means detached; a non-null string means attached under that identity; a *changed* string means tear the old one down and attach the new. The engine evaluates the gate on the post-commit plane — the same place effects run — so it reacts to committed fact changes, never mid-write, and never during replay.

## The motivating defect (measured against a real consumer)

Minglingo's live bingo play screen subscribes to seven Supabase realtime channels (round, players, messages, wins, prizes, calls, game-meta). Its retired hook gated all seven on one derived value:

```ts
const channelsActive = !isLoading && !hasEnded && !hasLeft;
useEffect(() => { if (!channelsActive) return; /* subscribe 7 channels */ return () => /* teardown */; },
  [gameId, channelsActive, sys]);
```

Migrating those channels onto the *ungated* `source` primitive (attach-at-start / teardown-at-destroy) reproduced three bugs, each a direct consequence of dropping that gate — two of them found by an adversarial review of the migration diff:

1. **Post-leave exposure.** With no teardown-on-state, the channels stayed subscribed after the player left the game — the client kept receiving *other players'* messages, calls, and prize awards over the socket for a game it had left, until the component unmounted. A confidentiality defect: the bytes had already reached the departed client.
2. **Message duplicate / miss.** Attaching at `start()` (before the initial load's own fetch) opened an overlap window between the loaded snapshot and the live stream. Supabase `postgres_changes` has no backfill, so a message committed after the load's `SELECT` but delivered after the load's overwrite showed **twice**; one delivered before the overwrite was **lost**.
3. **Stuck-round.** A round that completed *during* the load window published `ROUND_ENDED` into the store, which the still-running loader then clobbered with `status = 'playing'` — leaving the player on a dead round.

The reviews' verdict was unanimous and is the thesis of this RFC: **a subscription lifecycle gated on state is still lifecycle.** Pushing the gate back into a `useEffect` re-creates the plumbing `source` exists to own. The gate belongs on the same plane as the thing it gates.

(Bug 3's clobber is closed by gating — the round source is no longer attached during the load — but the residual "round completed during load, loader read it as active" case is a consumer load-time concern, out of scope here. Bug 1 is the one only real teardown-on-state can close; see the safety contract.)

## Design

### API

```ts
interface SourceDef {
  attach: (publish, reportError?, ctx?: { key: string }) => SourceUnsubscribe; // ctx present only for keyed sources
  key?: (facts) => string | null;      // null = detached; string = attached under that key; changed = teardown-then-attach
  active?: (facts) => boolean;          // sugar → key: f => active(f) === true ? "__on__" : null
  gateLingerMs?: number;                // hysteresis on a falling / re-key edge; default 0 (immediate)
  // unchanged: meta, coalesce, onEvict, evictTimeoutMs
}
```

- **`key` is the one mechanism; `active` is sugar.** A boolean gate is a degenerate two-valued key (`active` normalizes to `key: f => active(f) === true ? "__on__" : null`). Declaring both throws at registration. `key` earns its place over a bare boolean because it also expresses the *second* shape the motivating consumer needs — a channel whose name depends on a fact loaded after start (`game:${roundId}`): a changed key is a teardown-then-reattach, which a boolean cannot say.
- **`active` is strict `=== true`, not truthy.** A gate must fail closed. A gate function that returns a truthy non-boolean (a stray object, a number) must **not** open a data channel on coincidence; it is treated as detached.
- **`ctx.key`** hands the resolved key to `attach` so a keyed source builds its subscription from it (`supabase.channel(ctx.key)`). Ungated sources get the historic two-argument `attach` — fully backward compatible.

### Where it runs

The gate is evaluated by `SourcesManager.evaluateGated(facts)`, called from the engine at the **post-commit effects plane** — immediately after `runEffects`, once per committed reconcile, plus once at `start()` after `attachAll`. This is deliberate and load-bearing:

- **Post-commit, not per-write.** The gate reads settled facts, never a value mid-`batch()`. A batch of writes that flips the gate resolves to one evaluation.
- **Not inside the dispatch loop.** A source's `attach` may synchronously `publish` (the seed-initial-state pattern). If the gate opened *as a reaction to a fact write inside dispatch* and attached synchronously, that seed-publish would re-enter the dispatch loop while a commit was in flight. Deferring to the effects plane makes attach run to completion atomically, after the commit that opened the gate.
- **Behind the replay guard.** `reconcile()` does not run while history is restoring, so time-travel re-derives the key value but **never re-attaches a transport**. This is the determinism invariant (below).

`attachAll` attaches only *ungated* sources; gated sources attach via the initial `evaluateGated` at start. This avoids threading a facts snapshot into `attachAll` and keeps one code path for "evaluate the gate."

### The gate is a pure derivation that writes no facts

The determinism invariant: **the gate is a pure, fact-only read that writes no facts; the attach act and any events the source publishes remain non-replayable inputs.** On replay, the fact log is the sole source of truth; the gate value is re-derived from it but the subscription is never re-attached. The one way to break this would be to model the gate as a fact (`sourceAttached: true`) — then external lifecycle leaks into the log. The manager owns the gate; it is never fact-backed. (The gate receives the live facts proxy, so "no writes" is convention-enforced, exactly as derivations receive facts today; a dev-mode write-trap is a possible future hardening.)

## Safety contract

A gated source gating a privacy-sensitive subscription (the motivating case) must make the three bugs impossible by construction. The guarantees:

- **G1 — no premature events.** `attach` is invoked strictly after the first committed fact state at which the gate is open. While the gate is closed no subscription exists, so nothing can publish into a store the loader is about to overwrite. There is at most one live attach cycle per open interval; re-opening starts a fresh cycle with a fresh publish handle.
- **G2 — real teardown on gate-close.** When a committed change closes the gate, the manager runs the source's captured `unsubscribe()` on that same reconcile pass — not deferred to `stop()`/`destroy()`. This is the confidentiality control: the transport is told to stop sending, so the bytes never reach a client that should be cut off. **A downstream handler guard is not a substitute** — filtering an event after it has arrived does not un-receive it. The privacy guarantee is defined by *when the source stops receiving*, not by when it stops applying.
- **G3 — no leaked in-flight publish.** The record's `detached` flag flips *before* `unsubscribe()`; a transport callback that fires during the async teardown window hits the neutered handle and is dropped, counted with `lastDropReason: "gate-closed"` (a peer of `"post-stop"`/`"post-destroy"`).
- **G4 — fail-closed.** A gate that throws, returns `undefined`, or returns a non-`(string | null)` value is treated as `null` (detached; tear down if attached) and reported through the source error sink with `phase: "gate"`. Never fail-open — an unverifiable gate must not keep a data channel open.
- **G5 — `gateLingerMs` never defers exposure.** Linger absorbs a *return to the same prior key* within the window (a transient flap back to a known-good state). If the key instead walks to a **third** distinct value while a linger teardown is pending, the committed channel is torn down **immediately** — a key flapping to new values faster than `lingerMs` cannot re-defer the original teardown indefinitely. For a privacy-sensitive gate, leave `gateLingerMs` unset (`0`): teardown is then synchronous with the closing commit.

## Interaction with the existing source machinery

Gating reuses, rather than duplicates, what RFCs 0007–0009 built:

- **Teardown** is the same per-source path the re-registration flow already used (`detached`-before-unsubscribe, `onDetach`, timeout-capped async unsubscribe). It was extracted to a shared `detachOne(record, reason)`.
- **`coalesce`** buffers live in the per-attach closure, so a re-key gets a fresh buffer automatically.
- **`onEvict` / `evictAll`** iterate only attached records, so a detached (null-key) source is correctly skipped — there is no live subscription to evict.
- **Observability** is widened uniformly: the `"gate"` error phase and `"gate-closed"` drop reason appear everywhere the existing phases/reasons do (`inspect().sources[i]`, `Plugin.onSourceError`/`onSourceDrop`, the `source.*` observation events, the audit ledger).

## Alternatives considered

- **A boolean-only `active` gate.** Covers the on/off case but not the re-key case (a channel whose name is a loaded fact). Since a boolean is a two-valued key at no extra machinery cost, `key` is the primitive and `active` is sugar.
- **A ready-barrier** (attach-only-after-ready). One-directional; models neither teardown-on-terminal nor re-key. A strict subset of `active`.
- **A new module-level reactive-lifecycle primitive.** Would duplicate ~90% of the sources manager (attach/detach, the detached guard, per-source timeouts, telemetry, `onEvict`) with no added safety. Effects can't be reused for this — they are outbound-only and explicitly cannot dispatch events; inbound publish is the entire reason `source` exists.
- **Leave it in the consumer's hook.** Rejected: the review of the motivating migration showed that re-adding the gate as hook plumbing is *more* code than the source it replaces and re-introduces the exact defects. Reactive re-subscription gated on state is lifecycle, and lifecycle is the engine's job.

## Compatibility

Additive and backward compatible. Every new field is optional; a source with neither `key` nor `active` attaches at `start()` and detaches at `stop()` exactly as before. No existing source changes behavior.
