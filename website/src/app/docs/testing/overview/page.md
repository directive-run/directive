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
    system = createTestSystem({ module: myModule });
  });

  afterEach(() => {
    system.dispose();
  });
});
```

---

## Testing Facts

```typescript
test('initial facts', () => {
  expect(system.facts.count).toBe(0);
  expect(system.facts.user).toBeNull();
});

test('updating facts', () => {
  system.facts.count = 5;
  expect(system.facts.count).toBe(5);
});

test('batch updates', () => {
  system.batch(() => {
    system.facts.count = 10;
    system.facts.name = 'Test';
  });

  expect(system.facts.count).toBe(10);
  expect(system.facts.name).toBe('Test');
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
  },
  derive: {
    fullName: (facts) => `${facts.firstName} ${facts.lastName}`,
  },
});

test('derivations update automatically', () => {
  system.facts.firstName = 'John';
  system.facts.lastName = 'Doe';

  expect(system.derive.fullName).toBe('John Doe');
});
```

---

## Mock Resolvers

```typescript
import { createTestSystem, mockResolver } from 'directive/testing';

test('mock resolver response', async () => {
  const system = createTestSystem({
    module: userModule,
    mocks: {
      fetchUser: mockResolver((req) => ({
        id: req.userId,
        name: 'Mock User',
      })),
    },
  });

  system.facts.userId = 123;
  await system.settle();

  expect(system.facts.user).toEqual({
    id: 123,
    name: 'Mock User',
  });
});

test('mock resolver error', async () => {
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

## Testing Constraints

```typescript
test('constraint triggers requirement', async () => {
  const requirements: any[] = [];

  const system = createTestSystem({
    module: userModule,
    onRequirement: (req) => requirements.push(req),
  });

  system.facts.userId = 123;
  await system.settle();

  expect(requirements).toContainEqual({
    type: 'FETCH_USER',
    userId: 123,
  });
});

test('constraint does not trigger when condition false', async () => {
  const requirements: any[] = [];

  const system = createTestSystem({
    module: userModule,
    onRequirement: (req) => requirements.push(req),
  });

  // User already loaded
  system.facts.user = { id: 123, name: 'Existing' };
  system.facts.userId = 123;
  await system.settle();

  expect(requirements).not.toContainEqual(
    expect.objectContaining({ type: 'FETCH_USER' })
  );
});
```

---

## Fake Timers

```typescript
import { createTestSystem, useFakeTimers } from 'directive/testing';

test('debounced updates', async () => {
  const { advanceTime, runAllTimers } = useFakeTimers();

  const system = createTestSystem({ module: myModule });

  system.facts.query = 'test';

  // Advance past debounce delay
  await advanceTime(500);
  await system.settle();

  expect(system.facts.searchResults).toBeDefined();

  runAllTimers.restore();
});

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

  // First attempt fails immediately
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

## Testing Effects

```typescript
test('effect runs on fact change', async () => {
  const logs: string[] = [];

  const moduleWithEffect = createModule("test", {
    schema: {
      facts: { value: t.string() },
    },
    effects: {
      logChange: {
        watch: (facts) => facts.value,
        run: (value) => logs.push(value),
      },
    },
  });

  const system = createTestSystem({ module: moduleWithEffect });

  system.facts.value = 'first';
  await system.settle();

  system.facts.value = 'second';
  await system.settle();

  expect(logs).toEqual(['first', 'second']);
});
```

---

## Testing Events

```typescript
test('event is dispatched', async () => {
  const events: any[] = [];

  const system = createTestSystem({ module: userModule });
  system.on('USER_LOGGED_IN', (payload) => events.push(payload));

  system.facts.userId = 123;
  await system.settle();

  expect(events).toContainEqual(
    expect.objectContaining({ userId: 123 })
  );
});
```

---

## Snapshot Testing

```typescript
test('facts snapshot', async () => {
  system.facts.userId = 123;
  await system.settle();

  expect(system.snapshot()).toMatchSnapshot();
});
```

---

## Integration Testing

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { DirectiveProvider } from 'directive/react';

test('component with Directive', async () => {
  const system = createTestSystem({ module: userModule });

  render(
    <DirectiveProvider system={system}>
      <UserProfile />
    </DirectiveProvider>
  );

  system.facts.userId = 123;
  await system.settle();

  await waitFor(() => {
    expect(screen.getByText('Mock User')).toBeInTheDocument();
  });
});
```

---

## Next Steps

- See Error Handling for testing error scenarios
- See Resolvers for mock configuration
- See React Adapter for component testing
