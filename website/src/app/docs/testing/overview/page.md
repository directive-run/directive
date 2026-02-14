---
title: Testing Overview
description: Test your Directive modules with mock resolvers, fake timers, and assertion helpers.
---

Directive provides testing utilities for unit and integration testing. {% .lead %}

---

## Test Setup

```typescript
import { createTestSystem } from '@directive-run/core/testing';
import { myModule } from './my-module';

describe('MyModule', () => {
  let system;

  // Spin up a fresh test system before each test
  beforeEach(() => {
    system = createTestSystem({ modules: { app: myModule } });
    system.start();
  });

  // Tear down the system to prevent leaks between tests
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
  // Facts start at the values set in init()
  expect(system.facts.app.count).toBe(0);
  expect(system.facts.app.user).toBeNull();
});

test('updating facts', () => {
  // Mutate a fact directly on the proxy
  system.facts.app.count = 5;

  // The change is immediately reflected
  expect(system.facts.app.count).toBe(5);
});
```

---

## Testing Derivations

```typescript
// Define a module with two facts and one derived value
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

  // fullName auto-tracks firstName and lastName
  derive: {
    fullName: (facts) => `${facts.firstName} ${facts.lastName}`,
  },

  events: {},
});

test('derivations update automatically', () => {
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  // Set the underlying facts
  system.facts.user.firstName = 'John';
  system.facts.user.lastName = 'Doe';

  // The derivation recomputes automatically –no manual refresh needed
  expect(system.derive.user.fullName).toBe('John Doe');
});
```

Derivations are accessed via `system.derive.namespace.derivationName`.

---

## Mock Resolvers

```typescript
import { createTestSystem, mockResolver, flushMicrotasks } from '@directive-run/core/testing';

test('mock resolver with manual control', async () => {
  // Create a mock that captures requirements instead of auto-resolving
  const fetchMock = mockResolver<{ type: 'FETCH_USER'; userId: number }>('FETCH_USER');

  // Wire the mock handler into the test system
  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: { resolve: fetchMock.handler },
      },
    },
  });
  system.start();

  // Trigger the constraint that emits a FETCH_USER requirement
  system.facts.user.userId = 123;
  await flushMicrotasks();

  // The requirement was captured but not yet resolved
  expect(fetchMock.calls).toHaveLength(1);

  // Now resolve it on our terms
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

  // Change a fact that satisfies a constraint's `when` condition
  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Verify the constraint produced the expected requirement
  system.assertRequirement('FETCH_USER');
});

test('check all generated requirements', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Inspect the full requirements array for detailed payload checks
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
import { createFakeTimers, settleWithFakeTimers } from '@directive-run/core/testing';

test('standalone fake timers', async () => {
  // Create an isolated timer that starts at 0
  const timers = createFakeTimers();

  // Jump forward 500ms, firing any scheduled callbacks in that window
  await timers.advance(500);
  expect(timers.now()).toBe(500);

  // Drain all remaining scheduled timers
  await timers.runAll();

  // Reset back to time 0 for the next test
  timers.reset();
});

test('settle with Vitest fake timers', async () => {
  // Switch Vitest into fake-timer mode
  vi.useFakeTimers();

  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  // Trigger a debounced search constraint
  system.facts.app.query = 'test';

  // Step through time in 10ms increments until all resolvers finish
  await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
    totalTime: 1000,
    stepSize: 10,
  });

  // The resolver should have populated search results by now
  expect(system.facts.app.searchResults).toBeDefined();

  // Always restore real timers to avoid polluting other tests
  vi.useRealTimers();
});
```

---

## Testing Effects

```typescript
test('effect runs on fact change', async () => {
  // Capture effect output for assertions
  const logs: string[] = [];

  const moduleWithEffect = createModule("test", {
    schema: {
      facts: { value: t.string() },
      derivations: {},
      events: {},
    },
    init: (facts) => { facts.value = ''; },
    derive: {},

    // This effect fires whenever `value` changes
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

  // First mutation –the effect should log "first"
  system.facts.test.value = 'first';
  await system.waitForIdle();

  // Second mutation –the effect should log "second"
  system.facts.test.value = 'second';
  await system.waitForIdle();

  // Both changes were captured in order
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

  // Every fact mutation is recorded automatically
  system.facts.app.count = 1;
  system.facts.app.count = 2;
  system.facts.app.count = 3;

  // Retrieve the full change log
  const history = system.getFactsHistory();
  expect(history).toHaveLength(3);
  expect(history[2].newValue).toBe(3);

  // Clear history when you only care about future changes
  system.resetFactsHistory();
  expect(system.getFactsHistory()).toHaveLength(0);
});
```

---

## Integration Testing

No provider needed –hooks take the system directly as their first argument:

```typescript
import { render, screen, waitFor } from '@testing-library/react';

test('component with Directive', async () => {
  // Set up a test system the same way as a unit test
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  // Pass the system directly –no DirectiveProvider wrapper needed
  render(<UserProfile system={system} />);

  // Simulate a user action that triggers a resolver
  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Verify the component renders data from the resolved fact
  await waitFor(() => {
    expect(screen.getByText('Mock User')).toBeInTheDocument();
  });
});
```

---

## Next Steps

- [Mock Resolvers](/docs/testing/mock-resolvers) – Detailed resolver mocking
- [Fake Timers](/docs/testing/fake-timers) – Time control
- [Assertions](/docs/testing/assertions) – Test helpers
