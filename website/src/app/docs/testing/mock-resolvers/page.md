---
title: Mock Resolvers
description: Mock resolvers for controlled testing of Directive modules.
---

Control resolver behavior in tests with mocks. {% .lead %}

---

## Basic Mocking

```typescript
import { createTestSystem, mockResolver } from 'directive/testing';

test('user is fetched', async () => {
  const system = createTestSystem({
    module: userModule,
    mocks: {
      fetchUser: mockResolver((req) => ({
        id: req.userId,
        name: 'Test User',
        email: 'test@example.com',
      })),
    },
  });

  system.facts.userId = 123;
  await system.settle();

  expect(system.facts.user.name).toBe('Test User');
});
```

---

## Mock Errors

Simulate failures:

```typescript
test('handles fetch error', async () => {
  const system = createTestSystem({
    module: userModule,
    mocks: {
      fetchUser: mockResolver(() => {
        throw new Error('Network error');
      }),
    },
  });

  system.facts.userId = 123;
  await system.settle();

  expect(system.facts.error).toBe('Network error');
});
```

---

## Conditional Responses

Return different responses:

```typescript
const fetchUserMock = mockResolver((req) => {
  if (req.userId === 404) {
    throw new Error('User not found');
  }
  if (req.userId === 500) {
    throw new Error('Server error');
  }
  return { id: req.userId, name: 'User ' + req.userId };
});
```

---

## Spy on Calls

Track resolver calls:

```typescript
test('resolver is called correctly', async () => {
  const spy = jest.fn().mockResolvedValue({ id: 1, name: 'Test' });

  const system = createTestSystem({
    module: userModule,
    mocks: {
      fetchUser: mockResolver(spy),
    },
  });

  system.facts.userId = 123;
  await system.settle();

  expect(spy).toHaveBeenCalledWith({ type: 'FETCH_USER', userId: 123 });
  expect(spy).toHaveBeenCalledTimes(1);
});
```

---

## Delayed Responses

Simulate slow responses:

```typescript
const slowMock = mockResolver(async (req) => {
  await new Promise((r) => setTimeout(r, 100));
  return { id: req.userId, name: 'Test' };
});
```

---

## Partial Mocking

Only mock specific resolvers:

```typescript
const system = createTestSystem({
  module: userModule,
  mocks: {
    // Only fetchUser is mocked
    fetchUser: mockResolver(() => ({ id: 1, name: 'Test' })),
    // Other resolvers use real implementation
  },
});
```

---

## Next Steps

- See Testing Overview for setup
- See Fake Timers for time control
- See Assertions for test helpers
