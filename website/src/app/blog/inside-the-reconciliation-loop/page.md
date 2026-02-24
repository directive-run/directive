---
title: Inside Directive's Reconciliation Loop
description: A technical deep-dive into Directive's five-phase reconciliation cycle – how fact mutations propagate through derivations, constraints, and resolvers to reach a settled state.
layout: blog
date: 2026-02-02
dateModified: 2026-02-02
slug: inside-the-reconciliation-loop
author: directive-labs
categories: [Architecture, Engineering]
---

React taught the frontend world a powerful idea: declare what the UI should look like, and let a reconciliation algorithm figure out the minimal DOM updates. You don't manually insert and remove nodes. You describe the desired state, and the reconciler diffs the previous virtual tree against the new one, producing the smallest set of mutations needed.

Directive applies the same idea to application state. You declare constraints – what must be true – and the reconciliation loop figures out the minimal set of resolver executions needed to satisfy them. When facts change, the loop re-evaluates, diffs, and dispatches. When resolvers complete, facts update, and the loop runs again. It resolves to a settled state where all constraints are satisfied and no work remains.

This article is a technical deep-dive into that loop. If you're evaluating Directive for a production system, understanding the reconciliation cycle will help you write better constraints, debug unexpected behavior, and reason about performance characteristics.

---

## The five-phase cycle

Every reconciliation cycle follows five phases. Here's the simplified model:

{% five-phase-diagram /%}

These phases don't map to five sequential function calls – the actual implementation interleaves them through callbacks and microtask scheduling. But conceptually, every cycle follows this order.

Let's walk through each phase.

### Phase 1: Fact mutation triggers tracking

When you write `context.facts.phase = "green"`, you're setting a value on a proxy. The proxy's `set` trap does three things:

1. Stores the new value.
2. Records the key (`"phase"`) in a `changedKeys` set.
3. Calls `scheduleReconcile()`.

If multiple facts change in rapid succession – say, inside a resolver that sets `phase` and `elapsed` – `store.batch()` coalesces them into a single notification. The batch collects all changed keys and fires one `onBatch` callback instead of multiple `onChange` callbacks.

```typescript
// Pseudocode: what happens inside store.batch()
function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn(); // mutations collected, listeners deferred
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flush(); // fire onBatch with all collected changes
    }
  }
}
```

This matters because Phase 2 needs to see all changed keys at once to invalidate derivations correctly.

### Phase 2: Derivations invalidated and recomputed

When the `onBatch` callback fires, the engine calls `invalidateMany(keys)` on the derivations manager. This marks every derivation that depends on any changed fact as stale.

Derivations are lazy – invalidation doesn't recompute them. It sets `isStale = true` and queues a notification. The actual recomputation happens when something reads the derivation: a constraint's `when` function, a React component via `useSyncExternalStore`, or another derivation that depends on it.

This lazy approach means the engine never computes derivations that nobody reads. If a constraint doesn't reference a particular derivation, that derivation's compute function never runs during this cycle.

### Phase 3: Constraints re-evaluated

The engine passes the set of changed keys to the constraints manager's `evaluate()` method. Each constraint's `when` function runs against the current facts (which may trigger lazy derivation recomputation). If `when` returns `true`, the constraint is active and its `require` property produces a requirement.

```typescript
// Pseudocode: constraint evaluation
function evaluate(changedKeys: Set<string>): Requirement[] {
  const requirements: Requirement[] = [];
  for (const [id, constraint] of definitions) {
    const active = constraint.when(facts);
    if (active) {
      const req = typeof constraint.require === "function"
        ? constraint.require(facts)
        : constraint.require;
      requirements.push({ ...req, fromConstraint: id });
    }
  }
  return requirements;
}
```

Constraint evaluation is where the declarative model pays off. You don't decide which constraints to check – the engine evaluates all of them on every cycle. If a resolver's fact mutation makes a previously-satisfied constraint unsatisfied, the next cycle catches it automatically.

### Phase 4: Requirements diffed and deduplicated

The engine maintains a `RequirementSet` from the previous cycle. After evaluation, it diffs the current requirements against the previous set:

- **Added requirements**: constraints that just became active. These need resolvers.
- **Removed requirements**: constraints that were active but are now satisfied. Their in-flight resolvers get canceled.
- **Unchanged requirements**: still active, already being resolved. No action needed.

Deduplication uses typed identity keys. Each requirement has a `type` and an optional `key` function. Two requirements with the same type and key are considered identical – even if they came from different constraints. This prevents redundant resolver executions.

```typescript
// Pseudocode: requirement diffing
const { added, removed } = currentSet.diff(previousSet);

for (const req of removed) {
  resolversManager.cancel(req.id);
}

for (const req of added) {
  resolversManager.resolve(req);
}

previousRequirements = currentSet;
```

This diff-and-patch approach is directly analogous to React's virtual DOM diffing. React doesn't re-render the entire DOM – it patches the delta. Directive doesn't re-execute all resolvers – it dispatches only the new ones and cancels the stale ones.

### Phase 5: Resolvers dispatched, effects scheduled

New requirements are matched to resolvers by their `requirement` type. Each resolver runs asynchronously with an `AbortController` for cancellation. When a resolver completes, its `onResolutionComplete` callback fires, which does two things: it notifies settlement listeners (so `isSettled` recalculates) and it calls `scheduleReconcile()` to start the next cycle. The resolver's fact mutations – wrapped in `store.batch()` – then propagate through phases 1-4 again.

Cancellation is worth its own mention. When a requirement is *removed* during diffing (Phase 4), the engine calls `resolversManager.cancel(req.id)`, which aborts the resolver's `AbortController`. The resolver's `resolve` function receives this signal via `context.signal` – the standard `AbortSignal` interface. If the resolver is mid-fetch, it can pass the signal to `fetch()` for clean cancellation. The `.finally()` handler on the resolver's promise checks whether `inflight.delete()` succeeds before firing `onResolutionComplete`, preventing double-settlement notifications from a cancel/complete race.

Effects run for the changed keys from this cycle. Unlike resolvers (which fulfill requirements), effects are fire-and-forget side effects: logging, analytics, WebSocket messages. They run *before* constraint evaluation in the current implementation, so they see the facts that changed but not the new requirements produced by those changes. Effects are also wrapped in `store.batch()` to coalesce any fact mutations they make – an effect that sets two facts produces one notification, not two.

After all synchronous work completes, the engine checks: are there more changed keys? If yes, `scheduleReconcile()` queues another cycle on the next microtask. If no, and no resolvers are in flight, the system has settled.

---

## Batched notifications

Batching is the first line of defense against unnecessary work. Without it, a resolver that sets three facts would trigger three separate reconciliation cycles.

The `store.batch()` API defers all notifications until the batch completes. Inside a batch, `store.set()` records changes but doesn't fire listeners. When the batch ends, `flush()` fires a single `onBatch` callback with all changed keys.

The engine uses this in two critical places:

1. **Module initialization.** When `system.start()` calls each module's `init` function, all fact mutations are batched. This prevents reconciliation from running with partially-initialized state.

2. **Resolver execution.** Resolver fact mutations are wrapped in `store.batch()` so a resolver that sets `authenticated = true` and `tokenExpiry = Date.now() + 3600000` produces one reconciliation cycle, not two.

The `onBatch` callback is where batching and derivation invalidation intersect. The callback fires *before* individual key listeners, so derivations see all changed keys at once:

```typescript
// Inside the engine: onBatch fires before store key listeners
onBatch: (changes) => {
  const keys = changes.map((c) => c.key);
  // Invalidate ALL affected derivations before any listeners fire.
  // Listeners see consistent state – no partial invalidation.
  derivationsManager.invalidateMany(keys);
  for (const change of changes) {
    changedKeys.add(change.key);
  }
  scheduleReconcile();
}
```

This ordering guarantee – invalidate all derivations, then fire listeners – is what prevents listeners from observing a state where some derivations are stale and others aren't.

There's a third place batching plays a role that's easy to overlook: **event handlers.** When you dispatch an event via `system.dispatch()` or `system.events.someEvent()`, the handler runs inside `store.batch()`. An event handler that updates five facts produces one reconciliation cycle. This is the same pattern React uses with its event handler batching – group the state updates, flush once.

{% batched-notifications-diagram /%}

---

## Re-entrance protection

The trickiest part of the reconciliation loop is what happens when a listener mutates facts during notification. Consider this scenario:

1. Fact `count` changes.
2. Derivation `isHigh` (which depends on `count`) is invalidated and listeners fire.
3. A listener – say, a React component calling `useSyncExternalStore` – reads `isHigh`, triggering recomputation.
4. The recomputation calls `updateDependencies()`, which modifies the `factToDerivedDeps` Set.
5. But we're still iterating over that same Set from step 2.

In JavaScript, Set iterators visit entries added during iteration. Combined with the `isStale` flag resetting after recomputation, this creates an infinite loop: invalidate, recompute (adds entry back to Set), iterator visits new entry, invalidates again, recomputes again, and so on.

Directive solves this with deferred notifications and a safety valve.

**Deferred notifications.** During invalidation, the derivations manager doesn't fire listeners immediately. Instead, it collects derivation IDs in a `pendingNotifications` set. After all invalidations complete, `flushNotifications()` drains the set and fires listeners. This separation means `updateDependencies()` never runs while the invalidation Set is being iterated.

```typescript
// Pseudocode: invalidation with deferred notifications
let invalidationDepth = 0;
const pendingNotifications = new Set<string>();
let isFlushing = false;

function invalidateDerivation(id: string, visited = new Set()): void {
  if (visited.has(id)) {
    return;
  }

  visited.add(id);
  state.isStale = true;
  pendingNotifications.add(id);      // defer, don't fire
  // recursively invalidate dependents
}

function invalidate(factKey: string): void {
  invalidationDepth++;
  try {
    for (const id of dependents) {
      invalidateDerivation(id);
    }
  } finally {
    invalidationDepth--;
    flushNotifications();             // fire after all invalidations
  }
}
```

**The `isFlushing` guard.** If a listener fires during `flushNotifications()` and that listener triggers a new invalidation (by mutating a fact), the new invalidation will add entries to `pendingNotifications`. The `while (pendingNotifications.size > 0)` loop in `flushNotifications()` drains these re-entrant additions. But to prevent infinite loops, a `MAX_FLUSH_ITERATIONS` counter (set to 100) acts as a safety valve. If the loop exceeds 100 iterations, it throws an error with the remaining derivation IDs – a clear signal that a listener is creating a circular dependency.

Similarly, the engine's `reconcile()` function has a `MAX_RECONCILE_DEPTH` counter (set to 50). If resolvers keep mutating facts that re-trigger their own constraints, the loop breaks and warns that you have a circular requirement chain.

These aren't theoretical safeguards. During development, both safety valves caught real bugs – a derivation listener that called `store.set()` in its callback, and a resolver whose fact mutations re-activated the constraint that produced its requirement.

---

## Derivation dependency tracking

Derivations use automatic dependency tracking – no manual `deps` arrays. When a derivation function runs, the tracking context records every fact and derivation it reads. These recorded accesses become the derivation's dependencies.

The tracking uses two maps:

- `factToDerivedDeps`: maps a fact key to the set of derivations that depend on it. When fact `"phase"` changes, the engine looks up this map to know which derivations to invalidate.
- `derivedToDerivedDeps`: maps a derivation to the set of derivations that depend on *it*. This enables composition – a derivation `status` that reads `isRed` will be invalidated when `isRed` is invalidated.

```typescript
// Example: dependency tracking in action
derive: {
  isRed: (facts) => facts.phase === "red",        // depends on: ["phase"]
  status: (facts, derive) => ({
    phase: facts.phase,
    isRed: derive.isRed,                           // depends on: ["phase", "isRed"]
  }),
}
```

When `isRed` recomputes, it calls `updateDependencies()` to reconcile its old dependency set with its new one. Old dependencies are removed from the tracking maps; new ones are added. This is necessary because derivation dependencies can change between computations – a derivation with a conditional branch might depend on different facts depending on the branch taken.

The composition proxy (`derivedProxy`) does something subtle: when a derivation reads `derive.isRed`, the proxy calls `trackAccess("isRed")` so the consuming derivation records the dependency, and then it returns the (possibly recomputed) value. This is how derivation-to-derivation dependencies are established without explicit wiring.

One guard worth noting: the derivation proxy blocks access to `__proto__`, `constructor`, and `prototype`. Without this, code that enumerates proxy properties (common in serialization libraries and devtools) would create spurious dependency tracking entries and pollute the `factToDerivedDeps` Map with keys that aren't real facts. This is a small detail, but prototype pollution through proxy traps is a real attack vector in libraries that accept user-defined functions – which Directive does, in every constraint and derivation.

---

## Settlement

{% settlement-state-machine-diagram /%}

A system is **settled** when three conditions are met:

1. No reconciliation is in progress (`isReconciling === false`).
2. No reconciliation is scheduled (`reconcileScheduled === false`).
3. No resolvers are in flight (`inflight.length === 0`).

Settlement is the steady state. All constraints have been evaluated, all requirements have been dispatched to resolvers, all resolvers have completed, and no new fact mutations are pending.

The `system.isSettled` property checks these conditions synchronously. For async code, `system.settle(maxWait)` returns a promise that resolves when the system reaches settlement or rejects if it times out:

```typescript
system.start();
system.facts.authenticated = false; // triggers reconciliation

await system.settle(5000); // wait up to 5 seconds

// At this point:
// - All constraints evaluated
// - All resolvers completed (or timed out)
// - No pending work
console.log(system.isSettled); // true
```

Settlement is not permanent. Any fact mutation – from user input, a WebSocket message, a timer – breaks settlement and starts a new reconciliation cycle. The system oscillates between settled and unsettled states as it responds to changes. In practice, a healthy system spends most of its time settled, with brief unsettled bursts when external input arrives.

One subtlety: the engine schedules the next reconcile *before* notifying settlement listeners. This prevents a brief `isSettled = true` flash when more changes are pending. If `changedKeys` is non-empty after a reconcile finishes, `scheduleReconcile()` runs first, so `isSettled` remains `false` when listeners check it. Without this ordering, a React component subscribed to `isSettled` might briefly render a "ready" state and then immediately re-render when the next cycle starts – a visual flicker with no semantic meaning.

The `settle()` method is the primary tool for testing reconciliation behavior. It polls on a short interval (10ms), checking the three settlement conditions. When it times out, the error message includes diagnostic information: which resolvers are still in flight, whether a reconcile is in progress, and which requirements remain unmet. This makes timeout failures actionable rather than opaque.

```typescript
// Testing pattern: settle, assert, mutate, settle again
const system = createSystem({ module: checkout });
system.start();
await system.settle();

expect(system.facts.authenticated).toBe(true);

system.facts.authenticated = false; // simulate session expiry
await system.settle();

// The needsAuth constraint re-activated,
// the authenticate resolver re-ran
expect(system.facts.authenticated).toBe(true);
```

---

## Error boundaries and retry

When a resolver throws, the error doesn't crash the reconciliation loop. Instead, it flows through the error boundary system, which selects a recovery strategy.

The available strategies are:

- **skip**: Ignore the error. The requirement stays unmet until the next evaluation cycle.
- **retry**: Re-execute the resolver immediately with the same requirement.
- **retry-later**: Schedule a retry with configurable delay and backoff.
- **disable**: Disable the constraint that produced the requirement.
- **throw**: Re-throw the error, halting the system.

Retry policies are declared on the resolver:

```typescript
resolvers: {
  processPayment: {
    requirement: "PROCESS_PAYMENT",
    retry: { attempts: 3, backoff: "exponential", maxDelay: 10000 },
    resolve: async (req, context) => {
      const result = await chargeCard();
      context.facts.paymentConfirmed = result.success;
    },
  },
}
```

When a resolver with a retry policy fails, the resolvers manager tracks the attempt count and calculates the next delay using exponential backoff. The requirement stays in the `previousRequirements` set, so the next reconciliation cycle sees it as unchanged (not added or removed) and doesn't create a duplicate resolver.

The error boundary callbacks (`onError`, `onRecovery`) are themselves wrapped in try-catch. A throwing error handler doesn't bypass recovery strategy selection – it falls through to the default strategy. This is defense-in-depth: the reconciliation loop must be resilient to failures in the error handling code itself.

One interaction worth noting: when a resolver fails and the strategy is `retry-later`, the system may briefly appear settled (no in-flight resolvers, no scheduled reconcile). The retry timer is outside the reconciliation loop's awareness. When the timer fires and re-dispatches the resolver, the system becomes unsettled again. If you're using `settle()` in tests, be aware that it resolves at the *first* settlement point – you may need to call it again after retry timers fire.

---

## Why this matters

Understanding the reconciliation loop helps in three practical ways.

**Writing better constraints.** Constraints should be cheap, pure functions of facts. If a constraint's `when` function is expensive (parsing JSON, running regex on large strings, making calculations), it runs on every cycle. Move expensive work into derivations, which are memoized and only recompute when their dependencies change.

**Debugging unexpected behavior.** If a resolver keeps firing, it means the constraint that produces its requirement is still active after the resolver completes. Check that the resolver is actually mutating the facts the constraint reads. The `system.explain(requirementId)` method prints the constraint, its active state, the relevant facts, and the resolver status – a direct window into the reconciliation loop's decision-making.

**Reasoning about performance.** The loop's cost is proportional to the number of active constraints and the number of changed keys, not the total number of facts. A system with 500 facts but 10 constraints evaluates 10 `when` functions per cycle. Derivations add cost only when read. Batching ensures that multiple fact mutations in the same tick produce one cycle, not many.

**Avoiding common traps.** Knowing how the loop works helps you avoid patterns that fight it. A resolver that sets a fact but doesn't satisfy the constraint that triggered it will cause infinite re-evaluation – the constraint stays active, the resolver fires again, and the loop hits `MAX_RECONCILE_DEPTH`. A derivation that reads `Date.now()` will produce a different value on every computation, defeating memoization. An effect that calls `store.set()` unconditionally will trigger a new cycle on every run. Each of these patterns becomes obvious once you understand the five-phase cycle.

The reconciliation loop is Directive's core contribution – the mechanism that makes declarative state management work. React proved that diffing a virtual tree is a viable approach to UI updates. Directive extends the same principle to application logic: diff the constraints, patch the resolvers, resolve to the desired state.

---

## Go deeper

This article covered the reconciliation loop at a conceptual level. For the full picture:

- **[Advanced Overview](/docs/advanced/overview)** covers error boundaries, snapshot management, and performance tuning.
- **[Time-Travel Debugging](/docs/advanced/time-travel)** explains how snapshots capture the loop's state at each cycle.
- **[Testing Overview](/docs/testing/overview)** shows how to use `settle()`, mock resolvers, and fake timers to test reconciliation behavior.
- **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** introduces the paradigm from scratch, if you haven't read it yet.

The engine's job is simple: evaluate constraints, diff requirements, dispatch resolvers, repeat until settled. The engineering is in the details – batched notifications, deferred invalidation, re-entrance guards, dependency tracking, error isolation. These details are what make the declarative model reliable under real-world conditions.
