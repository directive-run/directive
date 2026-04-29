# Fake Timers (`vi.useFakeTimers`)

Directive's scheduler runs on real microtasks. Vitest's `useFakeTimers()`
freezes both timers AND microtasks (per Sinon's default), which starves
Directive's resolver chain. The two APIs need careful coordination.

## When you DON'T need fake timers

If your module:
- Has only resolvers (no `setTimeout` / `setInterval`)
- Uses event handlers + constraints + derivations

→ Use `flushAsync` from `@directive-run/core/testing`. Real timers, no
mocking. See [chained pipelines](./chained-pipelines.md).

## When you DO need fake timers

If your **consumer** wires an interval that dispatches into the module:

```tsx
// Component code:
useTickWhile(
  sys,
  (facts) => facts.status === 'polling',
  'POLL_TICK',
  1000, // ← this interval is what fake-timers will control
);
```

Or you have an effect with a literal `setTimeout` callback. Both cases test
the *consumer*, not the module's scheduler.

## The pattern that works

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushAsync } from '@directive-run/core/testing';

describe('polling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches POLL_TICK every 1s while polling', async () => {
    const sys = createSystem({ module: createPollerModule(deps) });
    sys.start();

    sys.events.START_POLLING();
    await flushAsync();

    vi.advanceTimersByTime(3000); // 3 ticks
    await flushAsync();

    expect(deps.poll).toHaveBeenCalledTimes(3);
    sys.destroy();
  });
});
```

The key is `shouldAdvanceTime: true`. Without it, microtasks queued during a
tick will not flush, and Directive's resolvers stall.

## Common pitfalls

### Mixing real and fake timers in the same test
Don't. Pick one mode per test. If you need to set up state with real timers
then test interval behavior, split into two `it()` blocks.

### Forgetting `await flushAsync()` after `advanceTimersByTime`
`advanceTimersByTime` synchronously fires all callbacks queued in the window.
Each callback may dispatch into the module, kicking a resolver chain. Without
`flushAsync()`, your assertions read mid-pipeline state.

### Using `vi.runAllTimers()` with recurring intervals
`runAllTimers` will infinite-loop if a `setInterval` is active. Use
`advanceTimersByTime` with a finite delta, or stop the interval first.

### Asserting before the predicate transitions
If a `useTickWhile` predicate becomes false during the test, the next
`advanceTimersByTime` won't dispatch. Read the predicate from `sys.facts`
before relying on the tick to fire.

## Why this isn't built-in

The shipped `flushAsync` covers ~95% of test cases without fake timers. Fake
timers are only needed when the *consumer* wires the timer, and the consumer's
test concerns aren't Directive-specific.

A future `t.timer({ms})` schema primitive (RFC, MIGRATION_FEEDBACK item 4)
would make declarative timers replayable / dehydrate-safe — at which point
fake-timer integration would become standardized. Until then, this is the
pattern.

## See also

- [Chained pipelines](./chained-pipelines.md) — the no-fake-timers default
- [`useTickWhile`](https://www.npmjs.com/package/@directive-run/react) — the React hook for predicate-gated intervals
