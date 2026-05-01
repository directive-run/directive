---
"@directive-run/timeline": minor
---

Add `@directive-run/timeline/matchers` subpath — causal-graph vitest matchers (R1.B v0.1)

Five matchers for asserting against the recorded `ObservationEvent` stream — not just final state. The same data the formatter renders and `replayTimeline` re-dispatches now powers test assertions.

```ts
// vitest.setup.ts (or any test file)
import '@directive-run/timeline/matchers';

// In tests:
expect(timeline).toReachInMs('status', 'ready', 50);     // fact reached value within budget
expect(timeline).toFireConstraint('load', { times: 1 });  // exact fire count
expect(timeline).toResolveWithinMs('initialLoader', 50); // resolver budget
expect(timeline).toMutate('submit');                      // mutator dispatch
expect(timeline).not.toCascade();                         // ≥2 constraints same reconcile
```

**Surface:**
- `./matchers` subpath with `import` / `require` / `types` exports.
- Side-effect-on-import registration via `globalThis.__vitest_expect`; falls through to explicit `registerMatchers(expect)` when the side-effect path doesn't fire.
- All 5 matchers exported as `matchers.X(timeline, ...)` for non-vitest call sites or custom assertion libraries.
- TypeScript ambient-module declarations register `Vi.Assertion` / `Vi.AsymmetricMatchersContaining` so `.toReachInMs` etc. are typed inside `expect()` chains.

**Scope notes:**
- The pitched fluent API (`.toReachIn(N).ms(...)`) became flat (`.toReachInMs(key, value, ms)`) for cleaner vitest `expect.extend` integration. Functionality identical.
- `toCascade()` v0.1 uses the heuristic "≥2 active constraints in one reconcile cycle". v0.2 will track caused-by edges from the `requirement.created` / `requirement.met` chain.

14 new tests covering pass/fail/negation paths plus input validation.
