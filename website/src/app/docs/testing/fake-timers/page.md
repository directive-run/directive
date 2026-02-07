---
title: Fake Timers
description: Control time in tests for debouncing, delays, and timeouts.
---

Control time progression in your tests. {% .lead %}

---

## Basic Usage

```typescript
import { createTestSystem, useFakeTimers } from 'directive/testing';

test('debounced search', async () => {
  const { advanceTime, cleanup } = useFakeTimers();

  const system = createTestSystem({ module: searchModule });

  system.facts.query = 'test';

  // Advance past debounce delay
  await advanceTime(500);
  await system.settle();

  expect(system.facts.searchResults).toBeDefined();

  cleanup();
});
```

---

## Timer Control

```typescript
const timers = useFakeTimers();

// Advance by milliseconds
await timers.advanceTime(1000);

// Run all pending timers
await timers.runAllTimers();

// Run only immediate timers
await timers.runOnlyPendingTimers();

// Jump to specific time
await timers.setSystemTime(new Date('2024-01-01'));

// Cleanup
timers.cleanup();
```

---

## Testing Retries

```typescript
test('retry with backoff', async () => {
  const { advanceTime } = useFakeTimers();

  let attempts = 0;
  const system = createTestSystem({
    module: myModule,
    mocks: {
      fetchData: mockResolver(() => {
        attempts++;
        if (attempts < 3) throw new Error('Fail');
        return { data: 'success' };
      }),
    },
  });

  system.facts.dataId = 1;

  // First attempt fails
  await advanceTime(0);
  expect(attempts).toBe(1);

  // Retry after 100ms
  await advanceTime(100);
  expect(attempts).toBe(2);

  // Retry after 200ms (exponential)
  await advanceTime(200);
  expect(attempts).toBe(3);

  await system.settle();
  expect(system.facts.data).toEqual({ data: 'success' });
});
```

---

## Testing Timeouts

```typescript
test('resolver timeout', async () => {
  const { advanceTime } = useFakeTimers();

  const system = createTestSystem({
    module: myModule,
    mocks: {
      slowResolver: mockResolver(async () => {
        await new Promise((r) => setTimeout(r, 30000));
        return { data: 'late' };
      }),
    },
  });

  system.facts.triggerSlow = true;

  // Advance past timeout
  await advanceTime(10000);
  await system.settle();

  expect(system.facts.error).toBe('Request timed out');
});
```

---

## Cleanup

Always cleanup fake timers:

```typescript
describe('Timer tests', () => {
  let timers;

  beforeEach(() => {
    timers = useFakeTimers();
  });

  afterEach(() => {
    timers.cleanup();
  });

  test('...', async () => {
    // Tests use fake timers
  });
});
```

---

## Next Steps

- See Mock Resolvers for resolver testing
- See Testing Overview for setup
- See Assertions for helpers
