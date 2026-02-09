---
title: Assertions
description: Built-in assertion helpers and fact history tracking on the test system.
---

The test system provides built-in assertion methods and history tracking for verifying system behavior. {% .lead %}

---

## Assertion Methods

`createTestSystem` returns a test system with four assertion helpers:

| Method | Description |
|--------|-------------|
| `assertRequirement(type)` | Assert that a requirement of the given type was created |
| `assertResolverCalled(type, times?)` | Assert a resolver was called, optionally a specific number of times |
| `assertFactSet(key, value?)` | Assert a fact was set, optionally to a specific value |
| `assertFactChanges(key, times)` | Assert a fact was changed exactly N times |

All assertion methods throw descriptive errors on failure, making test output easy to read.

---

## assertRequirement

Verify that a constraint produced a specific requirement type:

```typescript
import { createTestSystem } from 'directive/testing';

test('constraint creates requirement', async () => {
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Throws if no FETCH_USER requirement was created
  system.assertRequirement('FETCH_USER');
});
```

For more detailed checks, inspect the `allRequirements` array directly:

```typescript
test('requirement has correct payload', async () => {
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  expect(system.allRequirements).toContainEqual(
    expect.objectContaining({
      requirement: expect.objectContaining({
        type: 'FETCH_USER',
        userId: 123,
      }),
    })
  );
});
```

---

## assertResolverCalled

Verify that a mock resolver was invoked:

```typescript
test('resolver was called', async () => {
  const system = createTestSystem({
    modules: { app: myModule },
    mocks: {
      resolvers: {
        FETCH_DATA: {
          resolve: (req, ctx) => {
            ctx.facts.app_data = 'loaded';
          },
        },
      },
    },
  });
  system.start();

  system.facts.app.dataId = 1;
  await system.waitForIdle();

  // Assert it was called at least once
  system.assertResolverCalled('FETCH_DATA');

  // Assert exact call count
  system.assertResolverCalled('FETCH_DATA', 1);
});
```

You can also inspect the raw call history via `resolverCalls`:

```typescript
const calls = system.resolverCalls.get('FETCH_DATA');
expect(calls).toHaveLength(1);
expect(calls[0]).toMatchObject({ type: 'FETCH_DATA', dataId: 1 });
```

---

## assertFactSet

Verify that a fact was set during the test. The `key` is the fact name without the namespace prefix:

```typescript
test('fact was set', async () => {
  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  system.facts.app.count = 5;

  // Assert the fact was set (any value)
  system.assertFactSet('count');

  // Assert the fact was set to a specific value
  system.assertFactSet('count', 5);
});
```

---

## assertFactChanges

Verify the exact number of times a fact was changed:

```typescript
test('fact changed exactly 3 times', () => {
  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  system.facts.app.count = 1;
  system.facts.app.count = 2;
  system.facts.app.count = 3;

  system.assertFactChanges('count', 3);
});
```

---

## Fact History Tracking

The test system records every fact change with full context. Use `getFactsHistory()` to access the complete change log:

```typescript
test('inspect fact change history', () => {
  const system = createTestSystem({ modules: { test: myModule } });
  system.start();

  system.facts.test.value = 10;
  system.facts.test.name = 'hello';
  system.facts.test.value = 20;

  const history = system.getFactsHistory();
  expect(history).toHaveLength(3);

  // Each record contains:
  expect(history[0]).toMatchObject({
    key: 'value',           // Fact name (without namespace)
    fullKey: 'test_value',  // Full key with namespace prefix
    namespace: 'test',      // Module namespace
    previousValue: 0,       // Value before change
    newValue: 10,           // Value after change
  });
});
```

---

## Resetting History

Reset the fact history mid-test to focus on specific operations:

```typescript
test('track changes after setup', () => {
  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  // Setup phase
  system.facts.app.count = 0;
  system.facts.app.name = 'initial';

  // Clear setup changes
  system.resetFactsHistory();

  // Action under test
  system.facts.app.count = 42;

  const history = system.getFactsHistory();
  expect(history).toHaveLength(1);
  expect(history[0].newValue).toBe(42);
});
```

---

## Event History

The test system also tracks dispatched events via the `eventHistory` array:

```typescript
test('events are tracked', async () => {
  const system = createTestSystem({ modules: { app: myModule } });
  system.start();

  system.dispatch({ type: 'INCREMENT' });
  system.dispatch({ type: 'INCREMENT' });

  expect(system.eventHistory).toHaveLength(2);
  expect(system.eventHistory[0]).toMatchObject({ type: 'INCREMENT' });
});
```

---

## Combining Assertions

Use multiple assertions together for thorough tests:

```typescript
test('full resolver lifecycle', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: {
          resolve: (req, ctx) => {
            ctx.facts.user_name = 'John';
          },
        },
      },
    },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Verify the full chain: constraint -> requirement -> resolver -> fact
  system.assertRequirement('FETCH_USER');
  system.assertResolverCalled('FETCH_USER', 1);
  system.assertFactSet('name', 'John');
  system.assertFactChanges('userId', 1);
});
```

---

## Next Steps

- See [Testing Overview](/docs/testing/overview) for setup
- See [Mock Resolvers](/docs/testing/mock-resolvers) for mocking
- See [Fake Timers](/docs/testing/fake-timers) for time control
