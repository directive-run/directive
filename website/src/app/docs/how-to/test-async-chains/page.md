---
title: How to Test Async Constraint-Resolver Chains
description: Deterministic testing of multi-step async flows with Directive's testing utilities.
---

Test multi-step constraint-resolver chains deterministically, without flaky timing dependencies. {% .lead %}

---

## The Problem

Constraint-resolver chains are inherently async: a fact change triggers a constraint, which emits a requirement, which starts a resolver, which mutates facts, which triggers more constraints. Testing these flows with `setTimeout` and hope leads to flaky tests that pass locally but fail in CI. You need deterministic control over async resolution and the ability to assert state at each step.

## The Solution

```typescript
import { describe, it, expect } from 'vitest';
import { createTestSystem, mockResolver, flushMicrotasks } from '@directive-run/core/testing';
import { authModule } from '../modules/auth';

describe('auth flow', () => {
  it('logs in, fetches user, then sets authenticated', async () => {
    const system = createTestSystem({
      module: authModule,
      resolvers: {
        // Mock resolvers with controlled responses
        login: mockResolver('LOGIN', async (req, context) => {
          context.facts.token = 'mock-token';
          context.facts.refreshToken = 'mock-refresh';
          context.facts.expiresAt = Date.now() + 3600_000;
          context.facts.status = 'authenticated';
        }),
        fetchUser: mockResolver('FETCH_USER', async (req, context) => {
          context.facts.user = { id: '1', name: 'Test User', role: 'admin' };
        }),
      },
    });

    // Start the system
    await system.start();

    // Trigger login
    system.dispatch({ type: 'LOGIN', email: 'test@example.com', password: 'pass' });

    // Wait for all constraints and resolvers to settle
    await system.settle();

    // Assert the full chain completed
    expect(system.facts.status).toBe('authenticated');
    expect(system.facts.token).toBe('mock-token');
    expect(system.facts.user).toEqual({ id: '1', name: 'Test User', role: 'admin' });
  });

  it('handles login failure', async () => {
    const system = createTestSystem({
      module: authModule,
      resolvers: {
        login: mockResolver('LOGIN', async () => {
          throw new Error('Invalid credentials');
        }),
      },
    });

    await system.start();
    system.dispatch({ type: 'LOGIN', email: 'bad@example.com', password: 'wrong' });
    await system.settle();

    expect(system.facts.status).toBe('idle');
    expect(system.facts.token).toBeUndefined();
  });

  it('auto-refreshes when token expires', async () => {
    const refreshMock = mockResolver('REFRESH_TOKEN', async (req, context) => {
      context.facts.token = 'new-token';
      context.facts.expiresAt = Date.now() + 3600_000;
    });

    const system = createTestSystem({
      module: authModule,
      resolvers: { refreshToken: refreshMock },
    });

    await system.start();

    // Set up authenticated state with a token about to expire
    system.batch(() => {
      system.facts.token = 'old-token';
      system.facts.refreshToken = 'refresh-token';
      system.facts.expiresAt = Date.now() + 30_000; // Expires in 30s (within 60s buffer)
      system.facts.status = 'authenticated';
    });

    await system.settle();

    // The refreshNeeded constraint should have fired
    expect(refreshMock).toHaveBeenCalled();
    expect(system.facts.token).toBe('new-token');
  });
});
```

## Step by Step

1. **`createTestSystem` creates an isolated system** – no shared state between tests. Accepts the same config as `createSystem` plus mock overrides.

2. **`mockResolver` replaces real resolvers** – instead of hitting APIs, mock resolvers execute synchronously or with controlled async behavior. They're also Vitest spies, so you can assert calls.

3. **`system.settle()` waits for the chain to complete** – returns a promise that resolves when all pending constraints have been evaluated, all resolvers have completed, and all effects have run. No `setTimeout` hacks needed.

4. **`system.batch()` sets up preconditions atomically** – when testing a specific constraint, batch-set the facts that would trigger it without intermediate constraint evaluations.

## Common Variations

### Step-by-step assertions

```typescript
it('follows the correct sequence', async () => {
  const system = createTestSystem({ module: authModule });
  await system.start();

  system.dispatch({ type: 'LOGIN', email: 'test@example.com', password: 'pass' });

  // Flush only the first microtask cycle
  await flushMicrotasks();
  expect(system.facts.status).toBe('authenticating');

  // Let the resolver complete
  await system.settle();
  expect(system.facts.status).toBe('authenticated');
});
```

### Testing constraint dependencies

```typescript
it('checkout requires authentication', async () => {
  const checkoutMock = mockResolver('CHECKOUT', async () => {});

  const system = createTestSystem({
    modules: { auth: authModule, cart: cartModule },
    resolvers: { checkout: checkoutMock },
  });

  await system.start();

  // Add items but don't authenticate
  system.facts.cart.items = [{ productId: '1', qty: 1 }];
  await system.settle();

  // Checkout constraint should NOT have fired
  expect(checkoutMock).not.toHaveBeenCalled();

  // Now authenticate
  system.facts.auth.status = 'authenticated';
  await system.settle();

  // Now checkout should fire
  expect(checkoutMock).toHaveBeenCalled();
});
```

### Simulating resolver errors and retries

```typescript
it('retries on transient failure', async () => {
  let attempts = 0;
  const fetchMock = mockResolver('FETCH_PROFILE', async (req, context) => {
    attempts++;
    if (attempts < 3) throw new Error('Network error');
    context.facts.profile = { name: 'Test', avatar: '' };
  });

  const system = createTestSystem({
    module: dashboardModule,
    resolvers: { fetchProfile: fetchMock },
  });

  await system.start();
  system.facts.userId = 'user-1';
  await system.settle();

  expect(attempts).toBe(3);
  expect(system.facts.profile.name).toBe('Test');
});
```

## Related

- [Testing Overview](/docs/testing/overview) – testing utilities reference
- [Mock Resolvers](/docs/testing/mock-resolvers) – mock API details
- [Fake Timers](/docs/testing/fake-timers) – controlling time in tests
- [Loading & Error States](/docs/how-to/loading-states) – what you're testing
