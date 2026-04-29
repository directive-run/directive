# Cross-Module Events

When you have a Directive system with multiple modules, two communication
patterns are blessed:

1. **`crossModuleDeps`** for read access (B reads A's facts/derivations)
2. **`sys.modules.X.events.Y(payload)`** for write access (A tells B something happened)

These two combined replace `sendParent` / `sendChild` from XState without
needing a separate API.

## The wiring

```ts
const sys = createSystem({
  modules: {
    party: createPartyModule(),
    game: createGameModule(),
  },
  crossModuleDeps: ({ party, game }) => ({
    game: {
      currentPartyId: () => party.facts.currentPartyId,
      hostId: () => party.derive.hostId,
    },
    party: {
      gameStatus: () => game.facts.status,
    },
  }),
});

sys.start();
```

`crossModuleDeps` returns an object keyed by **target module**. Each
target gets functions returning facts or derivations from other modules.
The functions are called fresh each time the cache invalidates — they're
*not* memoized at wire time.

Inside `gameModule`, those wired functions are available as `deps`:

```ts
const createGameModule = () =>
  createModule('game', {
    schema: { ... },
    constraints: ({ constraint }) => {
      constraint.create({
        given: ({ deps }) => deps.currentPartyId() !== null,
        effect: ({ facts, deps }) => {
          // ...
        },
      });
    },
  });
```

## Sending an event from one module to another

Cross-module events use the system-level handle:

```ts
// party module's event handler:
event.handle('GAME_ENDED', ({ payload, system }) => {
  system.modules.game.events.RESET({ reason: payload.reason });
});
```

You need access to the system reference. Two ways to get it:
- `system` parameter on event handlers (in modules created with the new API)
- An external dispatcher captured at `createSystem()` time

## Why not a `sendParent`/`sendChild` API?

XState's hierarchical actor model models child-of-parent and sibling-of-sibling
explicitly. Directive deliberately doesn't — the system tree is flat (modules
are peers under one `createSystem`), and "parent" / "child" are relationships
you encode through `crossModuleDeps` plus event direction.

This is simpler in three ways:

1. **One mental model.** Modules talk to modules; no special parent-child
   axis.
2. **Cycle freedom.** A child can dispatch to its "parent" (just another
   module) without callback gymnastics.
3. **Replay determinism.** All cross-module events go through the same
   dispatch channel, recorded the same way.

The cost: the system topology lives in `createSystem` config, not in the
modules themselves. A module doesn't know who its peers are; it just
declares what `deps` it needs.

## Lifecycle

When `sys.destroy()` runs, all modules destroy in reverse-declaration order.
There's no per-module `unregisterModule()` today — if you need dynamic
add/remove of modules at runtime, you're hitting the spawn-model gap (see
[migrating from XState § spawnChild](../migrating-from-xstate.md#porting-from-xstates-spawnchild)
for the workaround).

## Example: party-emits-game-ended

```ts
// In partyModule:
event.handle('END_GAME', ({ payload, facts, system }) => {
  facts.activeGameId = null;
  system.modules.game.events.RESET({ reason: 'host_ended' });
});

// In gameModule:
event.handle('RESET', ({ payload, facts }) => {
  facts.status = 'idle';
  facts.score = 0;
  facts.lastResetReason = payload.reason;
});
```

The party module triggers a state transition in the game module without
either knowing the other's internal shape.

## Avoiding the broadcast trap

Don't fan a single event out to all modules unless you actually need that.
The temptation: a "global" event bus that every module subscribes to.
Resist it — explicit per-module dispatch is more legible and easier to
test. If you find yourself wanting a broadcast, that's usually a sign the
event represents shared state that should live in its own module instead.

## See also

- [Events API](../api/events.md) — `events.X(payload)` canonical form
- [Migrating from XState § spawnChild](../migrating-from-xstate.md#porting-from-xstates-spawnchild)
- [`MIGRATION_FEEDBACK.md`](../MIGRATION_FEEDBACK.md) — items 22, 25, 26 on the spawn model
