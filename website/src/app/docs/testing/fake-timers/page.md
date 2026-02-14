---
title: Fake Timers
description: Control time in tests for debouncing, delays, and timeouts.
---

Control time progression in your tests. {% .lead %}

---

## Two Approaches

Directive provides two ways to work with fake timers in tests:

- **`createFakeTimers()`** –Standalone fake timer instance for simple time control.
- **`settleWithFakeTimers()`** –Integrates with Vitest's `vi.useFakeTimers()` to advance time and flush microtasks until the system settles.

---

## createFakeTimers

Create a standalone fake timer for fine-grained control:

```typescript
import { createFakeTimers } from '@directive-run/core/testing';

test('advance time manually', async () => {
  // Create an isolated timer starting at 0
  const timers = createFakeTimers();

  // Jump forward 500ms, firing any callbacks scheduled in that window
  await timers.advance(500);
  expect(timers.now()).toBe(500);

  // Skip ahead to whatever is scheduled next
  await timers.next();

  // Drain every remaining timer in the queue
  await timers.runAll();

  // Clean slate for the next test
  timers.reset();
  expect(timers.now()).toBe(0);
});
```

---

## createFakeTimers API

| Method | Description |
|--------|-------------|
| `advance(ms)` | Advance time by a number of milliseconds, firing any timers in range |
| `next()` | Advance to and fire the next scheduled timer |
| `runAll()` | Run all pending timers |
| `now()` | Get current fake time |
| `reset()` | Reset to time 0 and clear all pending timers |

---

## settleWithFakeTimers

For integration tests, use `settleWithFakeTimers` with Vitest's fake timer mode. It steps through time in small increments, flushing microtasks at each step, until all resolvers complete:

```typescript
import { createTestSystem, settleWithFakeTimers } from '@directive-run/core/testing';

test('system settles with fake timers', async () => {
  // Replace real timers with Vitest fakes
  vi.useFakeTimers();

  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  // Trigger a debounced search constraint
  system.facts.app.query = 'test';

  // Step through time in 10ms increments, flushing microtasks each step,
  // until all resolvers finish or 1000ms elapses
  await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
    totalTime: 1000,
    stepSize: 10,
  });

  // The resolver should have populated results by now
  expect(system.facts.app.searchResults).toBeDefined();

  // Always restore real timers to avoid polluting other tests
  vi.useRealTimers();
});
```

---

## settleWithFakeTimers Options

| Option | Default | Description |
|--------|---------|-------------|
| `totalTime` | `5000` | Maximum total time to advance (ms) |
| `stepSize` | `10` | Time to advance each step (ms) |
| `maxIterations` | `1000` | Maximum iterations before throwing |

The function returns early once the system has no inflight resolvers. If resolvers are still running after `totalTime`, it throws an error listing the stuck resolvers.

---

## Testing Retries

Combine `settleWithFakeTimers` with mock resolvers to test retry behavior:

```typescript
test('retry with exponential backoff', async () => {
  vi.useFakeTimers();

  // Track how many times the resolver is invoked
  let attempts = 0;

  const system = createTestSystem({
    modules: { app: myModule },
    mocks: {
      resolvers: {
        FETCH_DATA: {
          // Fail the first two attempts, succeed on the third
          resolve: () => {
            attempts++;
            if (attempts < 3) throw new Error('Fail');
          },
        },
      },
    },
  });
  system.start();

  // Trigger the resolver
  system.facts.app.dataId = 1;

  // Advance through the backoff delays until the system settles
  await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
    totalTime: 5000,
  });

  // Confirm the resolver retried and eventually succeeded
  expect(attempts).toBe(3);

  vi.useRealTimers();
});
```

---

## Testing Timeouts

Test that resolvers time out correctly:

```typescript
test('resolver timeout', async () => {
  vi.useFakeTimers();

  const system = createTestSystem({
    modules: { app: myModule },
    mocks: {
      resolvers: {
        // Simulate an extremely slow resolver (30s delay)
        SLOW_RESOLVER: {
          delay: 30000,
        },
      },
    },
  });
  system.start();

  // Trigger the slow resolver
  system.facts.app.triggerSlow = true;

  // Only advance 15s –less than the 30s delay, so the module's
  // timeout logic should kick in before the resolver finishes
  await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
    totalTime: 15000,
    stepSize: 100,
  });

  vi.useRealTimers();
});
```

---

## flushMicrotasks

For low-level control, use `flushMicrotasks` to flush pending Promise callbacks without advancing time:

```typescript
import { flushMicrotasks } from '@directive-run/core/testing';

test('flush microtasks manually', async () => {
  vi.useFakeTimers();

  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  // Trigger a constraint by changing a fact
  system.facts.app.userId = 1;

  // Flush pending Promises so the reconciliation loop can start
  await flushMicrotasks();

  // Move the clock forward past the resolver's delay
  vi.advanceTimersByTime(100);

  // Flush again so the resolver's async callback completes
  await flushMicrotasks();

  vi.useRealTimers();
});
```

---

## Cleanup Pattern

Always restore real timers after tests that use `vi.useFakeTimers()`:

```typescript
describe('Timer tests', () => {
  // Switch to fake timers before each test
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Always restore real timers to avoid breaking other test suites
  afterEach(() => {
    vi.useRealTimers();
  });

  test('...', async () => {
    // All tests in this block run with fake timers active
  });
});
```

---

## Next Steps

- [Mock Resolvers](/docs/testing/mock-resolvers) – Resolver testing
- [Testing Overview](/docs/testing/overview) – Setup
- [Assertions](/docs/testing/assertions) – Test helpers
