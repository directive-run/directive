---
title: How to Debug with Time-Travel & DevTools
description: Step-by-step debugging workflow when constraints aren't firing as expected.
---

Step-by-step debugging workflow when constraints aren't firing, resolvers are stuck, or state looks wrong. {% .lead %}

---

## The Problem

Something's broken: a constraint that should fire isn't firing, a resolver runs but the UI doesn't update, or the system enters an unexpected state. Console logging every fact change floods the output. You need to see exactly what the engine did – which constraints evaluated, what requirements were produced, which resolvers ran, and how facts changed at each step.

## The Solution

```typescript
import { createSystem } from '@directive-run/core';
import { loggingPlugin, devtoolsPlugin } from '@directive-run/core/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    loggingPlugin({ level: 'debug' }),
    devtoolsPlugin(),
  ],
  debug: {
    timeTravel: true,
    maxSnapshots: 200,
  },
});
```

```tsx
import { useDirective, useExplain, useInspect, useConstraintStatus } from '@directive-run/react';

// Debug panel you can add to any page
function DebugPanel({ system }) {
  const { facts, derived } = useDirective(system);
  const inspection = useInspect(system);
  const explain = useExplain(system);

  return (
    <div className="debug-panel">
      {/* Current state overview */}
      <section>
        <h3>Facts</h3>
        <pre>{JSON.stringify(facts, null, 2)}</pre>
      </section>

      {/* Why a constraint isn't firing */}
      <section>
        <h3>Constraint Explanation</h3>
        <select onChange={(e) => explain.selectConstraint(e.target.value)}>
          {inspection.constraints.map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
        {explain.selectedConstraint && (
          <div>
            <p>Active: {explain.isActive ? 'Yes' : 'No'}</p>
            <p>when() result: {String(explain.whenResult)}</p>
            <p>Dependencies: {explain.deps.join(', ')}</p>
            <p>Requirements: {JSON.stringify(explain.requirements)}</p>
            <p>Blocked by: {explain.blockedBy.join(', ') || 'Nothing'}</p>
          </div>
        )}
      </section>

      {/* Time-travel controls */}
      <section>
        <h3>Time Travel ({inspection.snapshotIndex + 1}/{inspection.snapshotCount})</h3>
        <button onClick={() => system.debug.goBack()}>← Back</button>
        <button onClick={() => system.debug.goForward()}>Forward →</button>
        <button onClick={() => system.debug.goTo(0)}>Reset</button>
        <p>Snapshot label: {inspection.currentSnapshot?.label}</p>
      </section>

      {/* Active resolvers */}
      <section>
        <h3>In-Flight Resolvers</h3>
        <ul>
          {inspection.resolvers.active.map((r) => (
            <li key={r.key}>{r.type} – {r.status}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

### Debugging Workflow

```typescript
// Step 1: Check if the constraint's `when` is even true
const status = system.inspect().constraints.find(c => c.id === 'myConstraint');
console.log('when() result:', status.whenResult);
// If false → check which facts are wrong

// Step 2: Check what dependencies the constraint tracks
console.log('Tracked deps:', status.trackedDeps);
// If a dep is missing → the `when` function isn't reading that fact

// Step 3: Check if the constraint is blocked by `after`
console.log('Blocked by:', status.blockedBy);
// If blocked → the upstream constraint hasn't settled yet

// Step 4: Check if the requirement was produced
console.log('Requirements:', status.requirements);
// If empty → `require` returned nothing or threw

// Step 5: Check if a resolver is registered for the requirement type
console.log('Registered resolvers:', system.inspect().resolvers.registered);
// If missing → no resolver matches the requirement type

// Step 6: Step through time-travel snapshots
system.debug.goBack(); // See the previous state
system.debug.goBack(); // See the state before that
// Find the snapshot where things went wrong
```

## Step by Step

1. **Enable time-travel in the system config** – `debug: { timeTravel: true }` tells the engine to snapshot state after reconciliation cycles. By default every event that changes facts creates a snapshot. Use `snapshotEvents` on your module to limit which events create snapshots &ndash; see [Filtering Snapshot Events](/docs/advanced/time-travel#filtering-snapshot-events).

2. **`useInspect` gives you the engine's internal state** – all constraints (with their `when` results), all resolvers (with their status), and the snapshot timeline. This is read-only and doesn't affect the system.

3. **`useExplain` answers "why isn't X working?"** – select a constraint and see exactly why it's active or not: the `when()` result, which dependencies it tracks, what requirements it produced, and what's blocking it.

4. **Time-travel lets you see state at each step** – `goBack()` and `goForward()` move through the snapshot timeline. The entire system state (facts, derived, constraints) updates to show what it looked like at that point.

## Common Variations

### Conditional debug panel

```tsx
function App({ system }) {
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div>
      <MainContent system={system} />
      {process.env.NODE_ENV === 'development' && (
        <>
          <button onClick={() => setShowDebug(!showDebug)}>
            {showDebug ? 'Hide' : 'Show'} Debug
          </button>
          {showDebug && <DebugPanel system={system} />}
        </>
      )}
    </div>
  );
}
```

### Export/import snapshots for bug reports

```typescript
// Export current snapshot timeline
const exported = system.debug.exportSnapshots();
const blob = new Blob([JSON.stringify(exported)], { type: 'application/json' });

// Import a snapshot from a bug report
const imported = JSON.parse(fileContent);
system.debug.importSnapshots(imported);
system.debug.goTo(imported.failureIndex);
```

### Logging plugin for production debugging

```typescript
loggingPlugin({
  level: 'warn', // Only log warnings and errors in production
  onLog: (entry) => {
    // Send to your monitoring service
    analytics.track('directive_event', entry);
  },
}),
```

## Related

- [Time-Travel](/docs/advanced/time-travel) – time-travel API reference
- [Plugin Overview](/docs/plugins/overview) – logging and devtools plugins
- [DevTools Plugin](/docs/plugins/devtools) – browser extension integration
- [Testing](/docs/testing/overview) – debugging in test environments
