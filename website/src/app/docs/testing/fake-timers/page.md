---
title: Fake Timers
description: Control time in tests for debouncing, delays, and timeouts.
---

Control time progression in your tests. {% .lead %}

---

## Two Approaches

Directive provides two ways to work with fake timers in tests:

- **`createFakeTimers()`** -- Standalone fake timer instance for simple time control.
- **`settleWithFakeTimers()`** -- Integrates with Vitest's `vi.useFakeTimers()` to advance time and flush microtasks until the system settles.

---

## createFakeTimers

Create a standalone fake timer for fine-grained control:

```typescript
import { createFakeTimers } from 'directive/testing';

test('advance time manually', async () => {
  const timers = createFakeTimers();

  // Advance by milliseconds
  await timers.advance(500);
  expect(timers.now()).toBe(500);

  // Advance to the next scheduled timer
  await timers.next();

  // Run all pending timers
  await timers.runAll();

  // Reset to time 0
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
import { createTestSystem, settleWithFakeTimers } from 'directive/testing';

test('system settles with fake timers', async () => {
  vi.useFakeTimers();

  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  system.facts.app.query = 'test';

  await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
    totalTime: 1000,
    stepSize: 10,
  });

  expect(system.facts.app.searchResults).toBeDefined();

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

  let attempts = 0;

  const system = createTestSystem({
    modules: { app: myModule },
    mocks: {
      resolvers: {
        FETCH_DATA: {
          resolve: () => {
            attempts++;
            if (attempts < 3) throw new Error('Fail');
          },
        },
      },
    },
  });
  system.start();

  system.facts.app.dataId = 1;

  await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
    totalTime: 5000,
  });

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
        SLOW_RESOLVER: {
          delay: 30000, // 30 seconds
        },
      },
    },
  });
  system.start();

  system.facts.app.triggerSlow = true;

  // Advance past the module's timeout threshold
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
import { flushMicrotasks } from 'directive/testing';

test('flush microtasks manually', async () => {
  vi.useFakeTimers();

  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  system.facts.app.userId = 1;
  await flushMicrotasks(); // Let reconciliation start

  vi.advanceTimersByTime(100); // Advance resolver delay
  await flushMicrotasks(); // Let resolver complete

  vi.useRealTimers();
});
```

---

## Cleanup Pattern

Always restore real timers after tests that use `vi.useFakeTimers()`:

```typescript
describe('Timer tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('...', async () => {
    // Tests use Vitest fake timers
  });
});
```

---

## Next Steps

- See [Mock Resolvers](/docs/testing/mock-resolvers) for resolver testing
- See [Testing Overview](/docs/testing/overview) for setup
- See [Assertions](/docs/testing/assertions) for test helpers
