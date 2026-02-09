---
title: Testing Overview
description: Test your Directive modules with mock resolvers, fake timers, and assertion helpers.
---

Directive provides testing utilities for unit and integration testing. {% .lead %}

---

## Test Setup

```typescript
import { createTestSystem } from 'directive/testing';
import { myModule } from './my-module';

describe('MyModule', () => {
  let system;

  beforeEach(() => {
    system = createTestSystem({ modules: { app: myModule } });
    system.start();
  });

  afterEach(() => {
    system.destroy();
  });
});
```

`createTestSystem` takes a `modules` map where keys become namespaces. Facts and derivations are accessed through these namespaces.

---

## Testing Facts

```typescript
test('initial facts', () => {
  expect(system.facts.app.count).toBe(0);
  expect(system.facts.app.user).toBeNull();
});

test('updating facts', () => {
  system.facts.app.count = 5;
  expect(system.facts.app.count).toBe(5);
});
```

---

## Testing Derivations

```typescript
const userModule = createModule("user", {
  schema: {
    facts: {
      firstName: t.string(),
      lastName: t.string(),
    },
    derivations: {
      fullName: t.string(),
    },
    events: {},
  },
  init: (facts) => {
    facts.firstName = '';
    facts.lastName = '';
  },
  derive: {
    fullName: (facts) => `${facts.firstName} ${facts.lastName}`,
  },
  events: {},
});

test('derivations update automatically', () => {
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  system.facts.user.firstName = 'John';
  system.facts.user.lastName = 'Doe';

  expect(system.derive.user.fullName).toBe('John Doe');
});
```

Derivations are accessed via `system.derive.namespace.derivationName`.

---

## Mock Resolvers

```typescript
import { createTestSystem, mockResolver, flushMicrotasks } from 'directive/testing';

test('mock resolver with manual control', async () => {
  const fetchMock = mockResolver<{ type: 'FETCH_USER'; userId: number }>('FETCH_USER');

  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: { resolve: fetchMock.handler },
      },
    },
  });
  system.start();

  system.facts.user.userId = 123;
  await flushMicrotasks();

  // Requirement is pending
  expect(fetchMock.calls).toHaveLength(1);

  // Manually resolve it
  fetchMock.resolve();
  await flushMicrotasks();
});
```

---

## Testing Constraints

Use `assertRequirement` and `allRequirements` on the test system to verify constraints generated the expected requirements:

```typescript
test('constraint triggers requirement', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  system.assertRequirement('FETCH_USER');
});

test('check all generated requirements', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  expect(system.allRequirements).toContainEqual(
    expect.objectContaining({
      requirement: expect.objectContaining({ type: 'FETCH_USER' }),
    })
  );
});
```

---

## Fake Timers

```typescript
import { createFakeTimers, settleWithFakeTimers } from 'directive/testing';

test('standalone fake timers', async () => {
  const timers = createFakeTimers();

  await timers.advance(500);
  expect(timers.now()).toBe(500);

  await timers.runAll();
  timers.reset();
});

test('settle with Vitest fake timers', async () => {
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

## Testing Effects

```typescript
test('effect runs on fact change', async () => {
  const logs: string[] = [];

  const moduleWithEffect = createModule("test", {
    schema: {
      facts: { value: t.string() },
      derivations: {},
      events: {},
    },
    init: (facts) => { facts.value = ''; },
    derive: {},
    effects: {
      logChange: {
        run: (facts, prev) => {
          if (prev?.value !== facts.value) logs.push(facts.value);
        },
      },
    },
    events: {},
  });

  const system = createTestSystem({ modules: { test: moduleWithEffect } });
  system.start();

  system.facts.test.value = 'first';
  await system.waitForIdle();

  system.facts.test.value = 'second';
  await system.waitForIdle();

  expect(logs).toEqual(['first', 'second']);
});
```

---

## Fact History Tracking

The test system tracks all fact changes automatically:

```typescript
test('track fact changes', () => {
  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  system.facts.app.count = 1;
  system.facts.app.count = 2;
  system.facts.app.count = 3;

  const history = system.getFactsHistory();
  expect(history).toHaveLength(3);
  expect(history[2].newValue).toBe(3);

  // Reset tracking
  system.resetFactsHistory();
  expect(system.getFactsHistory()).toHaveLength(0);
});
```

---

## Integration Testing

No provider needed -- hooks take the system directly as their first argument:

```typescript
import { render, screen, waitFor } from '@testing-library/react';

test('component with Directive', async () => {
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  // Pass system directly to the component -- no DirectiveProvider wrapper
  render(<UserProfile system={system} />);

  system.facts.user.userId = 123;
  await system.waitForIdle();

  await waitFor(() => {
    expect(screen.getByText('Mock User')).toBeInTheDocument();
  });
});
```

---

## Next Steps

- See [Mock Resolvers](/docs/testing/mock-resolvers) for detailed resolver mocking
- See [Fake Timers](/docs/testing/fake-timers) for time control
- See [Assertions](/docs/testing/assertions) for test helpers
