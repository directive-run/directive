# Traffic Light Example

A classic state machine implemented with Directive to demonstrate core concepts.

## Run It

```bash
npx ts-node examples/traffic-light/index.ts
# or
pnpm tsx examples/traffic-light/index.ts
```

## What This Demonstrates

### 1. Facts (State)

Facts are the raw state of your system. In this example:

```typescript
schema: {
  phase: t.string<"red" | "green" | "yellow">(),
  elapsed: t.number(),
  manualOverride: t.boolean(),
}
```

Access facts directly: `system.facts.phase = "green"`

### 2. Derivations (Computed Values)

Derivations are computed from facts. They auto-track dependencies (no manual deps array).

```typescript
derive: {
  isRed: (facts) => facts.phase === "red",
  canWalk: (facts) => facts.phase === "red",
  timeRemaining: (facts) => PHASE_DURATIONS[facts.phase] - facts.elapsed,

  // Composite: uses other derivations
  status: (facts, derive) => ({
    phase: facts.phase,
    canWalk: derive.canWalk,
    timeRemaining: derive.timeRemaining,
  }),
}
```

Read derivations: `system.read("canWalk")`

### 3. Constraints (Declare Requirements)

Constraints declare WHAT must be true. When the condition is met, they produce a requirement.

```typescript
constraints: {
  shouldTransition: {
    priority: 10,
    when: (facts) => facts.elapsed >= PHASE_DURATIONS[facts.phase],
    require: (facts) => ({ type: "TRANSITION", to: PHASE_SEQUENCE[facts.phase] }),
  },
}
```

The constraint says "when elapsed time exceeds duration, we need a transition."

### 4. Resolvers (Fulfill Requirements)

Resolvers declare HOW to fulfill requirements. They're matched by the `handles` predicate.

```typescript
resolvers: {
  transition: {
    handles: forType<TransitionRequirement>("TRANSITION"),
    key: (req) => `transition-to-${req.to}`, // Dedupe key
    resolve: async (req, ctx) => {
      ctx.facts.phase = req.to;
      ctx.facts.elapsed = 0;
    },
  },
}
```

### 5. Events (External Inputs)

Events are how the outside world interacts with your system.

```typescript
events: {
  tick: (facts) => { facts.elapsed += 1; },
  setPhase: (facts, event) => { facts.phase = event.phase; },
}

// Usage
system.dispatch({ type: "tick" });
system.dispatch({ type: "setPhase", phase: "green" });
```

## The Reconciliation Loop

When facts change, Directive runs a reconciliation loop:

1. **Evaluate constraints** - Check which constraints have active requirements
2. **Match resolvers** - Find resolvers that can handle each requirement
3. **Execute resolvers** - Run the matched resolvers (with retry, cancellation, etc.)
4. **Repeat** - If facts changed, loop again until settled

```
Facts Change → Constraints Evaluated → Requirements Produced → Resolvers Execute → Facts Change → ...
```

## Key Concepts

| Concept | Purpose | Example |
|---------|---------|---------|
| **Facts** | Raw state | `phase`, `elapsed` |
| **Derivations** | Computed state | `canWalk`, `timeRemaining` |
| **Constraints** | Declare requirements | "When time's up, need transition" |
| **Resolvers** | Fulfill requirements | "To transition, update phase" |
| **Events** | External input | `tick`, `setPhase` |

## Why Directive?

### vs Raw State Management

Instead of imperative:
```typescript
// Imperative approach
if (elapsed >= duration) {
  phase = nextPhase;
  elapsed = 0;
}
```

Directive is declarative:
```typescript
// Constraint declares WHAT
when: (facts) => facts.elapsed >= duration,
require: { type: "TRANSITION", to: nextPhase }

// Resolver declares HOW
resolve: (req, ctx) => {
  ctx.facts.phase = req.to;
  ctx.facts.elapsed = 0;
}
```

### Benefits

1. **Separation of concerns** - "What should happen" vs "How to make it happen"
2. **Automatic deduplication** - Same requirement won't run twice
3. **Cancellation** - Requirements auto-cancel when constraint no longer active
4. **Inspection** - See all unmet requirements, inflight resolvers
5. **Time-travel** - Debug by stepping through state history

## Try It

Modify the example to:

1. Add a "pedestrian request" button that extends the red phase
2. Add a "maintenance mode" that blinks yellow
3. Add intersection coordination (two traffic lights that can't both be green)
