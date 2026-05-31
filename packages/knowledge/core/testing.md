# Testing

Testing utilities for Directive modules and systems. Import from `@directive-run/core/testing`.

## Decision tree

```
What are you testing?
├── A single module in isolation       → createTestSystem({ module })
├── Multiple modules together           → createTestSystem({ modules: {...} })
├── A constraint fires correctly        → set facts, system.assertRequirement(type)
├── A resolver mutates facts            → mocks.resolvers[TYPE], dispatch, await waitForIdle, assertFactSet
├── A derivation computes correctly     → set facts, read system.derive.x
├── Async settling with retry/timeouts  → await system.waitForIdle() (uses real timers)
├── Coverage tracking                    → createCoverageTracker(system)
└── Observation event capture            → createTestObserver(system)
```

## Creating a test system

`createTestSystem` takes an options OBJECT — the same shape as `createSystem` — and adds an optional `mocks.resolvers` map keyed by requirement type. There is no separate `createTestSystemFromModules` factory; the same overload handles both single-module (`module:`) and namespaced (`modules:`) systems.

```typescript
import { createTestSystem } from "@directive-run/core/testing";

// Single module
const system = createTestSystem({
  module: counterModule,
});

// Namespaced (multi-module)
const system = createTestSystem({
  modules: { auth: authModule, cart: cartModule },
});

// With mocks — keyed by requirement type, value is a MockResolverOptions
const system = createTestSystem({
  module: userModule,
  mocks: {
    resolvers: {
      FETCH_USER: {
        resolve: (req, context) => {
          context.facts.user = { id: req.userId, name: "Test User" };
        },
      },
    },
  },
});
```

A `TestSystem` extends the production `SingleModuleSystem<S>` / `NamespacedSystem<Modules>` with extra fields for observability:

```typescript
system.waitForIdle(maxWait?);    // wait for all in-flight resolvers (default 5000ms; throws on timeout)
system.eventHistory;              // every dispatched event
system.resolverCalls;             // Map<requirementType, Requirement[]>
system.allRequirements;           // every requirement generated (both resolved and pending)
system.getFactsHistory();         // FactChangeRecord[] since start / last reset
system.resetFactsHistory();
```

## Assertions are METHODS on the test system

Assertion helpers live on the test-system instance, not as top-level imports. `assertFact` / `assertDerivation` / `assertRequirement` as top-level imports do not exist.

```typescript
system.assertRequirement("FETCH_USER");        // a requirement of this type was generated
system.assertResolverCalled("FETCH_USER", 1);  // the resolver was called N times
system.assertFactSet("phase", "loaded");       // the fact was set to a specific value
system.assertFactChanges("count", 3);          // the fact was changed N times
```

For derivation assertions, just read the derivation value and use your test framework's expect / equality helpers:

```typescript
import { expect } from "vitest";
expect(system.derive.isOverBudget).toBe(true);
```

## Testing constraints

```typescript
import { describe, it, expect } from "vitest";
import { createTestSystem } from "@directive-run/core/testing";

describe("fetchWhenAuth constraint", () => {
  it("emits FETCH_USER when authenticated without profile", () => {
    const system = createTestSystem({ module: userModule });

    system.facts.isAuthenticated = true;
    system.facts.profile = null;

    system.assertRequirement("FETCH_USER");
  });

  it("does NOT emit when already has a profile", () => {
    const system = createTestSystem({
      module: userModule,
      initialFacts: {
        isAuthenticated: true,
        profile: { id: "1", name: "Alice" },
      },
    });

    const inspection = system.inspect();
    const fetchReqs = inspection.unmet.filter((r) => r.type === "FETCH_USER");
    expect(fetchReqs).toHaveLength(0);
  });
});
```

`SystemInspection` exposes `unmet`, `inflight`, and other typed accessors — there is no flat `inspection.requirements` field. Filter the right list (`unmet` for pending requirements, `inflight` for in-progress).

## Testing resolvers

```typescript
describe("fetchUser resolver", () => {
  it("stores fetched user in facts", async () => {
    const system = createTestSystem({
      module: userModule,
      mocks: {
        resolvers: {
          FETCH_USER: {
            resolve: (req, context) => {
              context.facts.user = { id: req.userId, name: "Mocked User" };
              context.facts.phase = "loaded";
            },
          },
        },
      },
    });

    // Trigger the constraint that emits FETCH_USER
    system.facts.isAuthenticated = true;
    system.facts.user = null;

    // Wait for the resolver to finish (default 5s timeout)
    await system.waitForIdle();

    system.assertFactSet("user", { id: expect.anything(), name: "Mocked User" });
    system.assertFactSet("phase", "loaded");
  });
});
```

`mocks.resolvers[TYPE]` accepts a `MockResolverOptions` — the most common shape is `{ resolve: (req, context) => {…} }`. You can also pass full mock-resolver behaviors (`onCall`, `respondWith`, etc.) — see `MockResolverOptions` for the full surface.

For programmatic control of when a mock resolves (e.g. holding a request to test loading states), use the `mockResolver(type)` factory:

```typescript
import { mockResolver } from "@directive-run/core/testing";

const mock = mockResolver("FETCH_USER");

const system = createTestSystem({
  module: userModule,
  mocks: {
    resolvers: { FETCH_USER: { resolve: mock.handler } },
  },
});

system.facts.isAuthenticated = true;

// Now mock.pending contains the in-flight request — resolve it manually
expect(mock.calls).toHaveLength(1);
mock.pending[0].resolve({ id: "u1", name: "Alice" });

await system.waitForIdle();
```

## Testing derivations

Set facts, read the derived value via `system.derive`.

```typescript
describe("isOverBudget derivation", () => {
  it("recomputes when facts change", () => {
    const system = createTestSystem({
      module: budgetModule,
      initialFacts: { total: 50, budget: 100 },
    });

    expect(system.derive.isOverBudget).toBe(false);

    system.facts.total = 200;

    expect(system.derive.isOverBudget).toBe(true);
  });
});
```

## Async testing with fake timers

`waitForIdle` uses real timers by default. For tests that depend on retry backoff / TTLs / timers without burning wall-clock seconds, use `createFakeTimers()` (a vitest/jest-compatible controller) or your test framework's fake-timer integration.

```typescript
import { describe, it, expect, vi } from "vitest";
import { createTestSystem } from "@directive-run/core/testing";

describe("retry behavior", () => {
  it("retries on failure with exponential backoff", async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const system = createTestSystem({
      module: myModule,
      mocks: {
        resolvers: {
          FETCH_DATA: {
            resolve: async (req, context) => {
              attempts += 1;
              if (attempts < 3) {
                throw new Error("Temporary failure");
              }
              context.facts.data = "success";
            },
          },
        },
      },
    });

    system.facts.needsData = true;

    // Advance through retry delays, then drain
    await vi.runAllTimersAsync();
    await system.waitForIdle();

    expect(attempts).toBe(3);
    system.assertFactSet("data", "success");

    vi.useRealTimers();
  });
});
```

## Microtask flush

For checking intermediate state without fully settling, use `flushMicrotasks()`.

```typescript
import { flushMicrotasks } from "@directive-run/core/testing";

it("processes intermediate state", async () => {
  const system = createTestSystem({ module: myModule });

  system.facts.trigger = true;

  // Process one round of microtasks without waiting for resolvers
  await flushMicrotasks();

  system.assertFactSet("phase", "loading");

  await system.waitForIdle();

  system.assertFactSet("phase", "done");
});
```

## Coverage tracking

```typescript
import { createCoverageTracker } from "@directive-run/core/testing";

const tracker = createCoverageTracker(system);

await tracker.run(async () => {
  system.facts.userId = 123;
  await system.waitForIdle();
});

const coverage = tracker.report();
// coverage.constraintCoverage   — 0-1
// coverage.resolverCoverage     — 0-1
// coverage.effectCoverage       — 0-1
// coverage.derivationCoverage   — 0-1
// coverage.constraintsMissed    — Set<string> of ids never triggered
```

## Test observer

Capture observation events for assertion-based testing:

```typescript
import { createTestObserver } from "@directive-run/core/testing";

const observer = createTestObserver(system);

system.facts.count = 5;
await system.waitForIdle();

const evals = observer.ofType("constraint.evaluate");
expect(evals).toHaveLength(1);

observer.clear();   // reset captured events
observer.dispose(); // stop capturing
```

## Anti-patterns

### `createTestSystem(myModule)` (module as positional arg)

```typescript
// WRONG — createTestSystem takes an options object, not a positional module
const system = createTestSystem(myModule);

// CORRECT — wrap in { module: ... }
const system = createTestSystem({ module: myModule });
```

### `createTestSystemFromModules({ a, b })`

```typescript
// WRONG — there is no separate factory; the same createTestSystem handles both forms
const system = createTestSystemFromModules({ auth, cart });

// CORRECT — pass `modules:`
const system = createTestSystem({ modules: { auth, cart } });
```

### Importing assertions as top-level helpers

```typescript
// WRONG — assertFact / assertDerivation / assertRequirement are not top-level exports
import { assertFact, assertDerivation, assertRequirement } from "@directive-run/core/testing";
assertRequirement(system, "FETCH_USER");
assertFact(system, "phase", "loaded");

// CORRECT — they live on the test system instance
system.assertRequirement("FETCH_USER");
system.assertFactSet("phase", "loaded");

// For derivation reads, use expect() directly
expect(system.derive.isOverBudget).toBe(true);
```

### `mockResolvers: [mockResolver(TYPE, fn)]` (positional array)

```typescript
// WRONG — mocks are keyed by type, not an array; and mockResolver only takes the type
const system = createTestSystem(myModule, {
  mockResolvers: [
    mockResolver("FETCH_USER", async (req, context) => { /* ... */ }),
  ],
});

// CORRECT — mocks.resolvers is a Record<type, MockResolverOptions>
const system = createTestSystem({
  module: myModule,
  mocks: {
    resolvers: {
      FETCH_USER: {
        resolve: async (req, context) => { /* ... */ },
      },
    },
  },
});
```

### `inspection.requirements`

```typescript
// WRONG — SystemInspection has `unmet` and `inflight`, not a flat `requirements`
inspection.requirements.filter((r) => r.type === "FETCH_USER")

// CORRECT — filter the right list
inspection.unmet.filter((r) => r.type === "FETCH_USER")     // pending
inspection.inflight.filter((r) => r.type === "FETCH_USER")  // in-progress
```

### Calling `system.settle()` instead of `system.waitForIdle()`

`system.settle(maxWait?)` exists on production systems. Test systems inherit it, but the recommended assertion-friendly drain on a `TestSystem` is `waitForIdle` — it shares the same semantics and integrates with the resolver-call tracking used by `assertResolverCalled`.

```typescript
// FINE — both work, but waitForIdle is the testing-flavored verb
await system.settle();
await system.waitForIdle();
```

### `ctx` instead of `context`

```typescript
// WRONG
resolve: (req, ctx) => { ctx.facts.x = 1; }

// CORRECT
resolve: (req, context) => { context.facts.x = 1; }
```

## Quick reference

| API | Path | Purpose |
|---|---|---|
| `createTestSystem(options)` | `@directive-run/core/testing` | Single overload; pass `module:` or `modules:` |
| `mockResolver(type)` | `@directive-run/core/testing` | Programmatic mock with `calls` / `pending` / `handler` |
| `createFakeTimers()` | `@directive-run/core/testing` | Vitest/Jest-compatible timer controller |
| `flushMicrotasks()` | `@directive-run/core/testing` | Advance one microtask round |
| `createCoverageTracker(system)` | `@directive-run/core/testing` | `run(fn)` + `report()` for constraint/resolver/effect/derivation hit rate |
| `createTestObserver(system)` | `@directive-run/core/testing` | Capture observation events for assertions |
| `system.assertRequirement(type)` | instance method | Assert a requirement was generated |
| `system.assertResolverCalled(type, n?)` | instance method | Assert a resolver was called |
| `system.assertFactSet(key, value?)` | instance method | Assert a fact value |
| `system.assertFactChanges(key, n)` | instance method | Assert the change count for a fact |
| `system.waitForIdle(maxWait?)` | instance method | Wait for in-flight resolvers (default 5000ms) |
