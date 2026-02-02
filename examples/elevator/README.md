# Elevator Example

Demonstrates Directive + XState for multi-elevator coordination.

## Run It

```bash
# Install dependencies
pnpm install xstate

# Run
npx ts-node examples/elevator/index.ts
```

## What This Demonstrates

### The Philosophy: "Directive WITH XState"

Instead of replacing XState, Directive complements it:
- **XState** handles individual elevator behavior (explicit state machines)
- **Directive** coordinates multiple elevators with facts-based constraints

### XState Handles (Individual Elevator)

```typescript
// Each elevator is a state machine
const elevatorMachine = createMachine({
  initial: 'idle',
  states: {
    idle: { on: { GO_TO_FLOOR: 'moving' } },
    doorsOpening: { ... },
    doorsOpen: { on: { CLOSE_DOORS: 'doorsClosing' } },
    doorsClosing: { ... },
    moving: { invoke: { src: 'moveToFloorService' } },
    arriving: { ... },
  }
});
```

### Directive Handles (Multi-Elevator Coordination)

```typescript
// Coordination constraint
constraints: {
  dispatchElevator: {
    when: (facts) => {
      // Check: request exists AND no elevator responding
      return facts.floorRequests.length > 0 &&
             !anyElevatorHeadingToFloor(facts);
    },
    require: (facts) => ({
      type: 'DISPATCH_ELEVATOR',
      floor: facts.floorRequests[0].floor,
    }),
  },
}

// Coordination resolver
resolvers: {
  dispatch: {
    handles: (req) => req.type === 'DISPATCH_ELEVATOR',
    resolve: (req, { actors, facts }) => {
      const best = findBestElevator(facts.actors, req.floor);
      actors[best].send({ type: 'GO_TO_FLOOR', floor: req.floor });
    },
  },
}
```

## Key Patterns

### 1. Actor Coordinator

Directive provides `createActorCoordinator` to manage multiple XState actors:

```typescript
const coordinator = createActorCoordinator({
  actors: [
    { id: 'elevator-1', machine: elevatorMachine },
    { id: 'elevator-2', machine: elevatorMachine },
  ],
  createActor, // XState's createActor function
  constraints: { ... },
  resolvers: { ... },
});
```

### 2. Actor State as Facts

Each actor's state is exposed as Directive facts:

```typescript
facts.actors = {
  'elevator-1': {
    id: 'elevator-1',
    machineId: 'elevator',
    status: 'active',
    value: 'idle',       // Current XState state
    startedAt: 1705320000000,
  },
  'elevator-2': {
    status: 'active',
    value: 'moving',
  },
}
```

### 3. Coordination Logic

```typescript
// Directive constraint evaluates coordination rules
when: (facts) => {
  // "If floor requested AND no elevator heading there"
  if (facts.floorRequests.length === 0) return false;

  const request = facts.floorRequests[0];
  for (const [id, state] of Object.entries(facts.actors)) {
    if (isInState(state, 'moving') && isGoingToFloor(state, request.floor)) {
      return false; // Already being handled
    }
  }
  return true; // Need to dispatch
}

// Resolver sends events to actors
resolve: (req, { actors }) => {
  const best = findBestElevator(...);
  actors[best].send({ type: 'GO_TO_FLOOR', floor: req.floor });
}
```

### 4. Separation of Concerns

| Concern | XState | Directive |
|---------|--------|-----------|
| Individual elevator behavior | ✅ State machine | |
| Door open/close timing | ✅ Delays | |
| Floor-to-floor movement | ✅ Invoke service | |
| Which elevator to dispatch | | ✅ Constraint logic |
| Handling multiple requests | | ✅ Requirement queue |
| Deduplication | | ✅ Requirement keys |

## Try It

1. Run the demo → watch elevator dispatch messages
2. Request same floor twice → see deduplication
3. Add more elevators → watch optimization change
4. Modify `findBestElevator` → different dispatch strategies

## Files

- `types.ts` - Type definitions
- `machine.ts` - XState elevator machine
- `index.ts` - Directive coordination
- `README.md` - This file

## Real-World Applications

This pattern applies to:
- **Traffic lights** - Multiple lights at intersection
- **Robot fleets** - Multiple robots, optimal dispatch
- **Server clusters** - Load balancing, failover
- **Game AI** - Multiple NPCs, coordinated behavior
- **IoT devices** - Multiple sensors, coordinated actions
