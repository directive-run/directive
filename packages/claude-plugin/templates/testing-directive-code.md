---
name: testing-directive-code
description: "Test Directive modules and systems using createTestSystem, mockResolver, assertFact, assertDerivation, assertRequirement, settleWithFakeTimers, and flushMicrotasks. Use when writing tests for Directive modules, constraints, resolvers, derivations, effects, or time-travel behavior."
---

# Testing Directive Code

## Prerequisites

This skill applies when the project uses `@directive-run/core`. If not found in `package.json`, suggest installing it: `npm install @directive-run/core`.

## When Claude Should Use This Skill

**Auto-invoke when the user:**
- Says "write a test", "add tests for this module", or "how do I test this resolver"
- Shows a Directive module and asks how to verify its behavior
- Asks about mocking resolvers, fake timers, or asserting facts in tests
- Asks about testing time-travel or snapshot behavior

**Do NOT invoke when:**
- Writing the module under test (see `writing-directive-modules.md`)
- Asking about system composition (see `building-directive-systems.md`)
- Asking about constraint patterns without a testing context (see `writing-directive-constraints.md`)

---

## Decision Tree: What Are You Testing?

```
What are you testing?
├── A single module in isolation       → createTestSystem(module)
├── Multiple modules together          → createTestSystemFromModules({ a, b })
├── A constraint fires correctly       → Set facts, call assertRequirement
├── A resolver mutates facts           → Mock resolver, trigger, settle, assertFact
├── A derivation computes correctly    → Set facts, call assertDerivation
├── Async/retry behavior               → settleWithFakeTimers(system, vi)
├── Intermediate state (mid-resolve)   → flushMicrotasks()
└── Time-travel / snapshots            → Enable timeTravel in createTestSystem options
```

---

## Imports

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
```

---

## Creating Test Systems

### Single module

```typescript
// Minimal – testing defaults: time-travel off, no plugins, sync settling
const system = createTestSystem(myModule);

// With initial state
const system = createTestSystem(myModule, {
  initialFacts: { count: 5, phase: "loading" },
});

// With mocked resolvers
const system = createTestSystem(myModule, {
  mockResolvers: [
    mockResolver("FETCH_USER", async (req, context) => {
      context.facts.user = { id: req.userId, name: "Test User" };
    }),
  ],
});

// Combined
const system = createTestSystem(myModule, {
  initialFacts: { isAuthenticated: true, profile: null },
  mockResolvers: [
    mockResolver("FETCH_PROFILE", async (req, context) => {
      context.facts.profile = { bio: "Test bio" };
    }),
  ],
});
```

### Multi-module

```typescript
const system = createTestSystemFromModules(
  { auth: authModule, cart: cartModule },
  {
    mockResolvers: [
      mockResolver("AUTHENTICATE", async (req, context) => {
        context.facts.auth.token = "test-token";
        context.facts.auth.isAuthenticated = true;
      }),
    ],
  },
);
```

---

## Testing Constraints

Set facts to satisfy the constraint's `when()`, then assert the requirement was emitted.

```typescript
describe("fetchWhenAuth constraint", () => {
  it("emits FETCH_USER when authenticated without profile", () => {
    const system = createTestSystem(userModule);

    system.facts.isAuthenticated = true;
    system.facts.profile = null;

    assertRequirement(system, "FETCH_USER");
  });

  it("does NOT emit when profile already loaded", () => {
    const system = createTestSystem(userModule, {
      initialFacts: {
        isAuthenticated: true,
        profile: { id: "1", name: "Alice" },
      },
    });

    const { requirements } = system.inspect();
    const fetchReqs = requirements.filter((r) => r.type === "FETCH_USER");
    expect(fetchReqs).toHaveLength(0);
  });

  it("emits dynamic requirement with correct payload", () => {
    const system = createTestSystem(userModule, {
      initialFacts: { isAuthenticated: true, userId: "u-42", profile: null },
    });

    // assertRequirement can check payload
    assertRequirement(system, "FETCH_USER", { userId: "u-42" });
  });
});
```

---

## Testing Resolvers

Mock the resolver, trigger the constraint, settle, then assert fact mutations.

```typescript
describe("fetchUser resolver", () => {
  it("stores fetched user and updates phase", async () => {
    const system = createTestSystem(userModule, {
      mockResolvers: [
        mockResolver("FETCH_USER", async (req, context) => {
          context.facts.user = { id: req.userId, name: "Mocked User" };
          context.facts.phase = "loaded";
        }),
      ],
    });

    system.facts.isAuthenticated = true;
    system.facts.user = null;

    await system.settle();

    assertFact(system, "user", { id: expect.any(String), name: "Mocked User" });
    assertFact(system, "phase", "loaded");
  });

  it("handles resolver error gracefully", async () => {
    const system = createTestSystem(userModule, {
      mockResolvers: [
        mockResolver("FETCH_USER", async () => {
          throw new Error("Network failure");
        }),
      ],
    });

    system.facts.isAuthenticated = true;
    system.facts.user = null;

    // If error boundary uses "skip", settle resolves normally
    await system.settle();
    assertFact(system, "phase", "error");
  });
});
```

---

## Testing Derivations

Set facts, then read the derived value. No need to settle – derivations are synchronous.

```typescript
describe("isOverBudget derivation", () => {
  it("returns true when total exceeds budget", () => {
    const system = createTestSystem(budgetModule, {
      initialFacts: { total: 150, budget: 100 },
    });

    assertDerivation(system, "isOverBudget", true);
  });

  it("recomputes reactively when facts change", () => {
    const system = createTestSystem(budgetModule, {
      initialFacts: { total: 50, budget: 100 },
    });

    assertDerivation(system, "isOverBudget", false);

    system.facts.total = 200;

    assertDerivation(system, "isOverBudget", true);
  });
});
```

---

## Testing with Fake Timers

Use `settleWithFakeTimers` when resolvers use retry delays, timeouts, or exponential backoff.

```typescript
import { describe, it, expect, vi } from "vitest";
import { createTestSystem, settleWithFakeTimers, mockResolver, assertFact } from "@directive-run/core/testing";

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

    // Advances fake timers through retry delays and waits for settlement
    await settleWithFakeTimers(system, vi);

    expect(attempts).toBe(3);
    assertFact(system, "data", "success");

    vi.useRealTimers();
  });
});
```

---

## Testing Intermediate Async State

Use `flushMicrotasks()` to process pending promises without fully settling.

```typescript
it("shows loading phase during resolution", async () => {
  const system = createTestSystem(myModule, {
    mockResolvers: [
      mockResolver("FETCH_DATA", async (req, context) => {
        context.facts.phase = "loading";
        await new Promise((resolve) => setTimeout(resolve, 100));
        context.facts.phase = "done";
      }),
    ],
  });

  system.facts.trigger = true;

  await flushMicrotasks();
  assertFact(system, "phase", "loading");

  await system.settle();
  assertFact(system, "phase", "done");
});
```

---

## Testing Effects

Effects run after reconciliation. Settle first, then check side effects.

```typescript
describe("logPhase effect", () => {
  it("logs when phase changes", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const system = createTestSystem(myModule, {
      initialFacts: { phase: "idle" },
    });

    system.facts.phase = "loading";
    await system.settle();

    expect(consoleSpy).toHaveBeenCalledWith("Phase: loading");

    consoleSpy.mockRestore();
  });
});
```

---

## Testing Time-Travel

Enable time-travel in the test system config. In most cases, prefer `assertFact` over snapshot testing.

```typescript
describe("time-travel", () => {
  it("can undo a fact change", () => {
    const system = createTestSystem(editorModule, {
      debug: { timeTravel: true, maxSnapshots: 20 },
    });

    system.facts.text = "Hello";
    system.facts.text = "Hello, world";

    const tt = system.debug.timeTravel;
    expect(system.facts.text).toBe("Hello, world");

    tt.undo();
    expect(system.facts.text).toBe("Hello");
  });

  it("can export and import history", () => {
    const system = createTestSystem(myModule, {
      debug: { timeTravel: true },
    });

    system.facts.count = 1;
    system.facts.count = 2;

    const tt = system.debug.timeTravel;
    const exported = tt.exportHistory();

    tt.importHistory(exported);
    tt.goToSnapshot(0);
    expect(system.facts.count).toBe(1);
  });
});
```

---

## Critical Anti-Patterns

### 1. Testing real resolvers (hitting real APIs)

```typescript
// WRONG – slow, flaky, external dependency
const system = createTestSystem(myModule);
system.facts.needsFetch = true;
await system.settle();   // Makes real HTTP call

// CORRECT – always mock resolvers in unit tests
const system = createTestSystem(myModule, {
  mockResolvers: [mockResolver("FETCH", async (req, context) => {
    context.facts.data = { mocked: true };
  })],
});
```

### 2. Forgetting to settle before asserting async results

```typescript
// WRONG – resolver hasn't completed
system.facts.trigger = true;
assertFact(system, "result", "done");   // Fails

// CORRECT
system.facts.trigger = true;
await system.settle();
assertFact(system, "result", "done");
```

### 3. Resolver parameter naming
Always use `(req, context)` – never `(req, ctx)` or `(request, context)`. Applies to `mockResolver` callbacks too.

### 4. Testing implementation details instead of behavior

```typescript
// WRONG – testing internal resolver call count without behavior check
expect(mockFn).toHaveBeenCalledTimes(1);

// CORRECT – test the observable outcome (facts, derivations)
assertFact(system, "user", { id: "1", name: "Alice" });
assertDerivation(system, "isLoggedIn", true);
```

### 5. Using createSystem instead of createTestSystem

```typescript
// WRONG – production system, no test defaults, runs plugins
const system = createSystem({ module: myModule });

// CORRECT – isolated, no plugins, testing utilities available
const system = createTestSystem(myModule);
```

### 6. Not resetting fake timers

```typescript
// WRONG – leaks fake timers to other tests
vi.useFakeTimers();
await settleWithFakeTimers(system, vi);
// Missing vi.useRealTimers()

// CORRECT – always restore in afterEach or at the end of the test
vi.useFakeTimers();
await settleWithFakeTimers(system, vi);
vi.useRealTimers();
```

### 7. Enabling time-travel when you don't need it

```typescript
// Prefer assertFact/assertDerivation for most tests.
// Only enable time-travel when specifically testing undo/redo or snapshot export.
```

### 8. Forgetting to destroy the system between tests

```typescript
// CORRECT – use afterEach to clean up
let system: ReturnType<typeof createTestSystem>;

beforeEach(() => {
  system = createTestSystem(myModule);
});

afterEach(() => {
  system.destroy();
});
```

---

## Assertion Quick Reference

```typescript
// Assert a fact value
assertFact(system, "phase", "done");
assertFact(system, "user", { id: expect.any(String) });

// Assert a derivation value
assertDerivation(system, "isLoading", false);
assertDerivation(system, "itemCount", 3);

// Assert a requirement was emitted
assertRequirement(system, "FETCH_USER");
assertRequirement(system, "FETCH_USER", { userId: "u-42" });  // With payload

// Inspect raw state
const { facts, requirements, resolvers, inflight } = system.inspect();
```

---

## Reference Files

- `testing.md` – full testing API, createTestSystem options, multi-module test setup
- `time-travel.md` – time-travel API, changesets, export/import, performance considerations
