---
title: Assertions
description: Test helpers and assertions for Directive modules.
---

Helper functions for testing Directive systems. {% .lead %}

---

## Fact Assertions

```typescript
import { expectFact, expectFacts } from 'directive/testing';

test('facts are set correctly', () => {
  expectFact(system, 'count').toBe(5);
  expectFact(system, 'user').toMatchObject({ name: 'John' });
  expectFact(system, 'items').toHaveLength(3);
});

test('multiple facts', () => {
  expectFacts(system, {
    count: 5,
    loading: false,
    error: null,
  });
});
```

---

## Derivation Assertions

```typescript
import { expectDerivation } from 'directive/testing';

test('derivations compute correctly', () => {
  system.facts.items = [
    { price: 10 },
    { price: 20 },
  ];

  expectDerivation(system, 'total').toBe(30);
  expectDerivation(system, 'itemCount').toBe(2);
});
```

---

## Requirement Assertions

```typescript
import { expectRequirement, expectNoRequirement } from 'directive/testing';

test('constraint raises requirement', async () => {
  system.facts.userId = 123;
  await system.settle();

  expectRequirement(system, {
    type: 'FETCH_USER',
    userId: 123,
  });
});

test('no requirement when user exists', async () => {
  system.facts.user = { id: 123, name: 'John' };
  system.facts.userId = 123;
  await system.settle();

  expectNoRequirement(system, 'FETCH_USER');
});
```

---

## Event Assertions

```typescript
import { expectEvent, captureEvents } from 'directive/testing';

test('event is dispatched', async () => {
  const events = captureEvents(system);

  system.facts.userId = 123;
  await system.settle();

  expectEvent(events, 'USER_LOADED', {
    userId: 123,
  });
});
```

---

## Snapshot Assertions

```typescript
test('state matches snapshot', async () => {
  system.facts.userId = 123;
  await system.settle();

  expect(system.snapshot()).toMatchSnapshot();
});

test('specific snapshot', () => {
  expect(system.snapshot(['user', 'preferences'])).toMatchSnapshot();
});
```

---

## Wait Helpers

```typescript
import { waitForFact, waitForEvent } from 'directive/testing';

test('wait for async fact', async () => {
  system.facts.userId = 123;

  await waitForFact(system, 'user', (user) => user !== null);

  expect(system.facts.user.name).toBe('John');
});

test('wait for event', async () => {
  const event = waitForEvent(system, 'DATA_LOADED');

  system.facts.loadData = true;

  const payload = await event;
  expect(payload.success).toBe(true);
});
```

---

## Next Steps

- See Testing Overview for setup
- See Mock Resolvers for mocking
- See Fake Timers for time control
