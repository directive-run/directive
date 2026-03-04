# Testing

Testing utilities for Directive modules and systems. Import from `@directive-run/core/testing`.

## Decision Tree: "How should I test this?"

```
What are you testing?
├── A single module in isolation → createTestSystem(module)
├── Multiple modules together → createTestSystemFromModules({ a, b })
├── A constraint fires correctly → Set facts, check requirements
├── A resolver mutates facts → Mock the resolver, dispatch, assert facts
├── A derivation computes correctly → Set facts, read derived value
├── Async settling behavior → settleWithFakeTimers(system, vi)
└── An effect runs → Set facts, assert side effects
```

## Creating Test Systems

```typescript
import {
  createTestSystem,
  createTestSystemFromModules,
  mockResolver,
  flushMicrotasks,
  settleWithFakeTimers,
  assertFact,
  assertDerivation,
  assertRequirement,
} from "@directive-run/core/testing";

// Single module — same API as createSystem, with testing defaults
// (time-travel off, no plugins, synchronous settling)
const system = createTestSystem(myModule);

// With options
const system = createTestSystem(myModule, {
  initialFacts: { count: 5, phase: "loading" },
  mockResolvers: [mockResolver("FETCH_USER", async (req, context) => {
    context.facts.user = { id: req.userId, name: "Test User" };
  })],
});

// Multi-module
const system = createTestSystemFromModules(
  { auth: authModule, cart: cartModule },
  { mockResolvers: [mockResolver("AUTHENTICATE", async (req, context) => {
    context.facts.auth.token = "test-token";
  })] },
);
```

## Testing Constraints

Set facts to trigger the constraint's `when()`, then assert the requirement was emitted.

```typescript
import { describe, it, expect } from "vitest";
import { createTestSystem, assertRequirement } from "@directive-run/core/testing";

describe("fetchWhenAuth constraint", () => {
  it("emits FETCH_USER when authenticated without profile", () => {
    const system = createTestSystem(userModule);

    // Set facts to satisfy the constraint's when()
    system.facts.isAuthenticated = true;
    system.facts.profile = null;

    // Assert the requirement was emitted
    assertRequirement(system, "FETCH_USER");
  });

  it("does NOT emit when already has profile", () => {
    const system = createTestSystem(userModule, {
      initialFacts: {
        isAuthenticated: true,
        profile: { id: "1", name: "Alice" },
      },
    });

    // No requirement should exist
    const inspection = system.inspect();
    const fetchReqs = inspection.requirements.filter(
      (r) => r.type === "FETCH_USER",
    );
    expect(fetchReqs).toHaveLength(0);
  });
});
```

## Testing Resolvers

Mock the resolver, trigger a requirement, and assert fact mutations.

```typescript
describe("fetchUser resolver", () => {
  it("stores fetched user in facts", async () => {
    const system = createTestSystem(userModule, {
      mockResolvers: [
        mockResolver("FETCH_USER", async (req, context) => {
          // Simulate API response
          context.facts.user = { id: req.userId, name: "Mocked User" };
          context.facts.phase = "loaded";
        }),
      ],
    });

    // Trigger the constraint that emits FETCH_USER
    system.facts.isAuthenticated = true;
    system.facts.user = null;

    // Wait for resolver to complete
    await system.settle();

    assertFact(system, "user", { id: expect.any(String), name: "Mocked User" });
    assertFact(system, "phase", "loaded");
  });
});
```

## Testing Derivations

Set facts, then read the derived value.

```typescript
describe("isOverBudget derivation", () => {
  it("returns true when total exceeds budget", () => {
    const system = createTestSystem(budgetModule, {
      initialFacts: { total: 150, budget: 100 },
    });

    assertDerivation(system, "isOverBudget", true);
  });

  it("returns false when under budget", () => {
    const system = createTestSystem(budgetModule, {
      initialFacts: { total: 50, budget: 100 },
    });

    assertDerivation(system, "isOverBudget", false);
  });

  it("recomputes when facts change", () => {
    const system = createTestSystem(budgetModule, {
      initialFacts: { total: 50, budget: 100 },
    });

    assertDerivation(system, "isOverBudget", false);

    system.facts.total = 200;

    assertDerivation(system, "isOverBudget", true);
  });
});
```

## Async Testing with Fake Timers

Use `settleWithFakeTimers` when resolvers have retry delays or timeouts.

```typescript
import { describe, it, vi } from "vitest";
import { createTestSystem, settleWithFakeTimers } from "@directive-run/core/testing";

describe("retry behavior", () => {
  it("retries on failure with exponential backoff", async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const system = createTestSystem(myModule, {
      mockResolvers: [
        mockResolver("FETCH_DATA", async (req, context) => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error("Temporary failure");
          }
          context.facts.data = "success";
        }),
      ],
    });

    system.facts.needsData = true;

    // Advances fake timers through retry delays and settles
    await settleWithFakeTimers(system, vi);

    expect(attempts).toBe(3);
    assertFact(system, "data", "success");

    vi.useRealTimers();
  });
});
```

## Flushing Microtasks

Use `flushMicrotasks()` when you need to process pending promises without fully settling.

```typescript
it("processes intermediate state", async () => {
  const system = createTestSystem(myModule);

  system.facts.trigger = true;

  // Flush pending microtasks without waiting for full settlement
  await flushMicrotasks();

  // Check intermediate state
  assertFact(system, "phase", "loading");

  // Now settle fully
  await system.settle();

  assertFact(system, "phase", "done");
});
```

## Common Mistakes

### Testing real resolvers instead of mocking

```typescript
// WRONG — tests hit real APIs, slow and flaky
const system = createTestSystem(myModule);
system.facts.needsFetch = true;
await system.settle(); // Makes real HTTP call

// CORRECT — mock the resolver
const system = createTestSystem(myModule, {
  mockResolvers: [mockResolver("FETCH", async (req, context) => {
    context.facts.data = { mocked: true };
  })],
});
```

### Forgetting to settle before asserting async results

```typescript
// WRONG — resolver hasn't completed yet
system.facts.trigger = true;
assertFact(system, "result", "done"); // Fails!

// CORRECT — wait for resolution
system.facts.trigger = true;
await system.settle();
assertFact(system, "result", "done");
```

### Using ctx instead of context in mock resolvers

```typescript
// WRONG
mockResolver("FETCH", async (req, ctx) => { /* ... */ }),

// CORRECT
mockResolver("FETCH", async (req, context) => { /* ... */ }),
```
