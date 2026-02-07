---
title: Time-Travel
description: Debug your application with time-travel state navigation.
---

Navigate through state history for debugging. {% .lead %}

---

## Enable Time-Travel

```typescript
const system = createSystem({
  module: myModule,
  debug: {
    timeTravel: true,
    maxSnapshots: 100,
  },
});
```

---

## Basic Navigation

```typescript
// Get history
const history = system.timeTravel.history;
console.log(`${history.length} snapshots`);

// Go back
system.timeTravel.back();

// Go forward
system.timeTravel.forward();

// Jump to specific snapshot
system.timeTravel.goto(5);

// Go to beginning
system.timeTravel.goto(0);
```

---

## Snapshot Details

Each snapshot contains:

```typescript
interface Snapshot {
  id: number;
  timestamp: number;
  facts: Record<string, unknown>;
  trigger: {
    type: 'fact' | 'resolver' | 'event';
    key?: string;
    value?: unknown;
  };
}
```

---

## React Integration

```typescript
function TimeTravelControls() {
  const { history, position, back, forward, goto } = useTimeTravel();

  return (
    <div>
      <button onClick={back} disabled={position === 0}>
        Back
      </button>
      <span>{position} / {history.length - 1}</span>
      <button onClick={forward} disabled={position === history.length - 1}>
        Forward
      </button>

      <input
        type="range"
        min={0}
        max={history.length - 1}
        value={position}
        onChange={(e) => goto(Number(e.target.value))}
      />
    </div>
  );
}
```

---

## Export/Import

Save and restore history:

```typescript
// Export
const exported = system.timeTravel.export();
localStorage.setItem('debug-session', JSON.stringify(exported));

// Import
const saved = JSON.parse(localStorage.getItem('debug-session'));
system.timeTravel.import(saved);
```

---

## Replay

Replay from a snapshot:

```typescript
// Go to snapshot 5 and replay
system.timeTravel.goto(5);
system.timeTravel.replay();
```

---

## Next Steps

- See Snapshots for state serialization
- See DevTools for browser integration
- See Testing for debugging tests
