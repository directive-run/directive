---
"@directive-run/core": minor
---

Sources can now gate and re-key their subscription lifecycle on module facts.

A `source` may declare a pure `key` (or `active`) gate that reads facts to
decide whether — and under what identity — its transport is subscribed. This
closes the long-standing gap where a source that needed to re-subscribe on a
fact change had to be torn down and re-registered by hand.

```typescript
sources: {
  gameChannel: {
    // null → detached; a string → attached under that key; a CHANGED string
    // → old torn down BEFORE the new attaches (re-key).
    key: (facts) => (facts.gameId ? `game:${facts.gameId}` : null),
    attach: (publish, _reportError, ctx) => {
      const channel = supabase.channel(ctx!.key)
        .on('postgres_changes', { /* ... */ }, (p) => publish('GAME_UPDATE', p.new))
        .subscribe();
      return () => channel.unsubscribe();
    },
  },
}
```

New optional `SourceDef` fields (fully backward compatible — ungated sources
behave exactly as before):

- `key(facts) => string | null` — lifecycle gate + identity.
- `active(facts) => boolean` — sugar, normalized to `key: f => active(f) ? "__on__" : null`.
  Declaring both `key` and `active` throws a dev error at registration.
- `gateLingerMs` — hysteresis on a falling / re-key edge: wait before tearing
  the old subscription down; cancel if the key returns to its prior value
  within the window. Default `0` (immediate).
- `attach` gains an optional 3rd arg `ctx: { key }` carrying the resolved key
  (keyed sources only).

The gate is evaluated on the post-commit effects plane and once at
`system.start()`. It runs behind the same replay / time-travel guard effects
use: replay re-derives the key value but never re-attaches a transport
(determinism invariant). A gate that throws or returns a non-`(string | null)`
value fails closed (treated as `null`, reported via `source.error` with the new
`phase: "gate"`). An in-flight publish that lands after a gate closes is
counted as a drop with `lastDropReason: "gate-closed"`.
