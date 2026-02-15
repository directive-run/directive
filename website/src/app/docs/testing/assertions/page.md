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
import { createTestSystem } from '@directive-run/core/testing';

test('constraint creates requirement', async () => {
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();

  // Satisfy the constraint's `when` condition
  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Throws a descriptive error if no FETCH_USER requirement was created
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

  // Dig into the full requirements array for detailed payload checks
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
          resolve: (req, context) => {
            context.facts.app_data = 'loaded';
          },
        },
      },
    },
  });
  system.start();

  // Trigger the constraint -> requirement -> resolver chain
  system.facts.app.dataId = 1;
  await system.waitForIdle();

  // Was the resolver invoked at all?
  system.assertResolverCalled('FETCH_DATA');

  // Was it called exactly once? (catches accidental duplicates)
  system.assertResolverCalled('FETCH_DATA', 1);
});
```

You can also inspect the raw call history via `resolverCalls`:

```typescript
// Access the raw call history for fine-grained inspection
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

  // Mutate a fact
  system.facts.app.count = 5;

  // Verify the fact was written to (regardless of value)
  system.assertFactSet('count');

  // Verify it was set to a specific value
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

  // Mutate the same fact three times
  system.facts.app.count = 1;
  system.facts.app.count = 2;
  system.facts.app.count = 3;

  // Confirm the exact number of mutations (catches extra writes)
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

  // Make several fact changes across different keys
  system.facts.test.value = 10;
  system.facts.test.name = 'hello';
  system.facts.test.value = 20;

  // Every mutation is recorded in order
  const history = system.getFactsHistory();
  expect(history).toHaveLength(3);

  // Each record captures the full context of the change
  expect(history[0]).toMatchObject({
    key: 'value',           // Fact name (without namespace)
    fullKey: 'test::value',  // Full key with namespace prefix
    namespace: 'test',      // Module namespace
    previousValue: 0,       // Value before the change
    newValue: 10,           // Value after the change
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

  // Setup phase – these changes are not what we want to test
  system.facts.app.count = 0;
  system.facts.app.name = 'initial';

  // Discard setup noise so only the action under test is tracked
  system.resetFactsHistory();

  // This is the mutation we actually care about
  system.facts.app.count = 42;

  // History now only contains the post-reset change
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

  // Dispatch two events into the system
  system.dispatch({ type: 'INCREMENT' });
  system.dispatch({ type: 'INCREMENT' });

  // eventHistory records every dispatched event in order
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
          resolve: (req, context) => {
            context.facts.user_name = 'John';
          },
        },
      },
    },
  });
  system.start();

  // Kick off the full lifecycle by changing a fact
  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Verify every link in the chain:
  // 1. Constraint produced a requirement
  system.assertRequirement('FETCH_USER');

  // 2. Resolver ran exactly once
  system.assertResolverCalled('FETCH_USER', 1);

  // 3. Resolver wrote the expected fact
  system.assertFactSet('name', 'John');

  // 4. The triggering fact was only set once
  system.assertFactChanges('userId', 1);
});
```

---

## Next Steps

- [Testing Overview](/docs/testing/overview) – Setup
- [Mock Resolvers](/docs/testing/mock-resolvers) – Mocking
- [Fake Timers](/docs/testing/fake-timers) – Time control
