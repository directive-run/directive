---
title: Mock Resolvers
description: Mock resolvers for controlled testing of Directive modules.
---

Control resolver behavior in tests with mocks. {% .lead %}

---

## Two Approaches

Directive provides two mock resolver utilities:

- **`createMockResolver`** -- Auto-resolves requirements with configurable behavior (delays, errors, custom resolve functions).
- **`mockResolver`** -- Captures requirements for manual resolution, giving you fine-grained control over timing.

---

## Auto-Resolving with createMockResolver

Pass mock resolver options to `createTestSystem` under `mocks.resolvers`. Each key is a requirement type:

```typescript
import { createTestSystem } from 'directive/testing';

test('user is fetched', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: {
          resolve: (req, ctx) => {
            ctx.facts.user_name = 'Test User';
            ctx.facts.user_email = 'test@example.com';
          },
        },
      },
    },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  expect(system.facts.user.name).toBe('Test User');
});
```

---

## Mock Errors

Simulate failures with the `error` option:

```typescript
test('handles fetch error', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: {
          error: 'Network error',
        },
      },
    },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  expect(system.facts.user.error).toBe('Network error');
});
```

You can pass a string or an `Error` instance to the `error` option.

---

## Delayed Responses

Simulate slow resolvers with the `delay` option (in milliseconds):

```typescript
const system = createTestSystem({
  modules: { user: userModule },
  mocks: {
    resolvers: {
      FETCH_USER: {
        delay: 500,
        resolve: (req, ctx) => {
          ctx.facts.user_name = 'Test User';
        },
      },
    },
  },
});
```

---

## Manual Resolution with mockResolver

For fine-grained control over when requirements resolve, use `mockResolver`. It captures requirements and lets you resolve or reject them manually:

```typescript
import { createTestSystem, mockResolver, flushMicrotasks } from 'directive/testing';

test('manual resolve control', async () => {
  const fetchMock = mockResolver<{ type: 'FETCH_USER'; userId: string }>('FETCH_USER');

  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: { resolve: fetchMock.handler },
      },
    },
  });
  system.start();

  system.facts.user.userId = '123';
  await flushMicrotasks();

  // Requirement is captured but pending
  expect(fetchMock.calls).toHaveLength(1);
  expect(fetchMock.calls[0].userId).toBe('123');
  expect(fetchMock.pending).toHaveLength(1);

  // Manually resolve
  fetchMock.resolve();
  await flushMicrotasks();

  expect(fetchMock.pending).toHaveLength(0);
});
```

---

## mockResolver API

`mockResolver(requirementType)` returns an object with:

| Property | Description |
|----------|-------------|
| `calls` | All requirements received by this mock |
| `pending` | Requirements waiting to be resolved or rejected |
| `resolve(result?)` | Resolve the next pending requirement |
| `reject(error)` | Reject the next pending requirement |
| `resolveAll(result?)` | Resolve all pending requirements |
| `rejectAll(error)` | Reject all pending requirements |
| `reset()` | Clear call history and pending queue |
| `handler` | The handler function to pass to `createTestSystem` mocks |

---

## Rejecting Requirements

Test error handling by rejecting pending requirements:

```typescript
test('handles rejection', async () => {
  const fetchMock = mockResolver('FETCH_DATA');

  const system = createTestSystem({
    modules: { app: myModule },
    mocks: {
      resolvers: {
        FETCH_DATA: { resolve: fetchMock.handler },
      },
    },
  });
  system.start();

  system.facts.app.dataId = 1;
  await flushMicrotasks();

  fetchMock.reject(new Error('Server error'));
  await flushMicrotasks();

  // Verify error handling in your module
});
```

---

## Batch Resolution

Resolve or reject all pending requirements at once:

```typescript
test('resolve all pending', async () => {
  const workMock = mockResolver<{ type: 'WORK'; id: number }>('WORK');

  const system = createTestSystem({
    modules: { app: myModule },
    mocks: {
      resolvers: {
        WORK: { resolve: workMock.handler },
      },
    },
  });
  system.start();

  // Trigger multiple requirements
  system.facts.app.taskId = 1;
  await flushMicrotasks();
  system.facts.app.taskId = 2;
  await flushMicrotasks();

  expect(workMock.pending).toHaveLength(2);

  // Resolve all at once
  workMock.resolveAll();
  await flushMicrotasks();

  expect(workMock.pending).toHaveLength(0);
});
```

---

## Tracking Resolver Calls

The test system tracks resolver calls automatically via `resolverCalls` and `assertResolverCalled`:

```typescript
test('resolver was called', async () => {
  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: {
          resolve: (req, ctx) => {
            ctx.facts.user_name = 'Test';
          },
        },
      },
    },
  });
  system.start();

  system.facts.user.userId = 123;
  await system.waitForIdle();

  // Built-in assertion
  system.assertResolverCalled('FETCH_USER');
  system.assertResolverCalled('FETCH_USER', 1); // exactly once

  // Or check the raw call history
  const calls = system.resolverCalls.get('FETCH_USER');
  expect(calls).toHaveLength(1);
});
```

---

## Next Steps

- See [Testing Overview](/docs/testing/overview) for setup
- See [Fake Timers](/docs/testing/fake-timers) for time control
- See [Assertions](/docs/testing/assertions) for test helpers
