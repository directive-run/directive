# Traffic Intersection Example

A comprehensive example demonstrating all of Directive's features in a visual, interactive traffic intersection simulation.

## Features Demonstrated

### Core Directive Concepts

| Feature | Description | Location |
|---------|-------------|----------|
| **Schema** | Typed state definition with validation | `schema` object |
| **Init** | Initial state setup | `init` function |
| **Derivations** | Computed values that auto-track dependencies | `derive` object |
| **Effects** | Side effects that run on state changes | `effects` object |
| **Constraints** | Rules that produce requirements when conditions met | `constraints` object |
| **Resolvers** | Async handlers that fulfill requirements | `resolvers` object |
| **Priority** | Emergency vehicles override normal operation | `priority: 100` on constraints |
| **Plugins** | Logging plugin for debugging | `createLoggingPlugin()` |
| **Time-Travel** | Debug by stepping through state history | `debug: { timeTravel: true }` |

### The Simulation

- **Two-axis intersection**: North-South (NS) and East-West (EW) traffic
- **Traffic lights**: Red, yellow, green phases with automatic cycling
- **Car queues**: Cars wait at each direction (N, S, E, W)
- **Pedestrian crossings**: Request buttons for NS and EW crosswalks
- **Emergency mode**: Override normal operation for emergency vehicles
- **Statistics**: Track cars passed and pedestrians crossed

## Running the Example

```bash
# From the project root
cd examples/traffic-intersection

# Install dependencies
pnpm install

# Start the dev server
pnpm dev

# Open http://localhost:3000
```

## Controls

### Mouse
- Click **+** buttons to add cars from each direction
- Click **pedestrian** buttons to request crosswalk
- Click **Emergency** to trigger emergency mode
- Click **Reset** to reset the intersection

### Keyboard
| Key | Action |
|-----|--------|
| `N` | Add car from North |
| `S` | Add car from South |
| `E` | Add car from East |
| `W` | Add car from West |
| `1` | Request NS pedestrian crossing |
| `2` | Request EW pedestrian crossing |
| `Space` | Toggle emergency mode |
| `R` | Reset intersection |

## Console Debugging

Open the browser console to see:
- Phase transitions
- Requirement creation/resolution
- Car arrivals/departures
- Pedestrian crossings

Access the system programmatically:
```javascript
// Get current state
intersection.getState()

// Read a derivation
intersection.system.read("totalCarsWaiting")

// Time-travel (if debug enabled)
intersection.system.timeTravel.back()
intersection.system.timeTravel.forward()
```

## Code Structure

```
src/
├── intersection.ts  # Directive module with all features
└── main.ts          # UI bindings and event handlers

index.html           # Visual representation
```

## Key Patterns

### Constraint Priority
Emergency constraints have `priority: 100`, overriding normal transitions (`priority: 50-60`).

```typescript
constraints: {
  emergencyOverride: {
    priority: 100,  // Highest priority
    when: (facts) => facts.emergencyActive && ...,
    require: { type: "EMERGENCY_MODE", ... },
  },
  nsGreenToYellow: {
    priority: 50,  // Normal priority
    when: (facts) => !facts.emergencyActive && ...,
    require: { type: "TRANSITION", ... },
  },
}
```

### Derivations for Computed State
```typescript
derive: {
  totalCarsWaiting: (facts) =>
    facts.northQueue.length +
    facts.southQueue.length +
    facts.eastQueue.length +
    facts.westQueue.length,

  canCrossNS: (facts) =>
    facts.nsPhase === "green" && !facts.emergencyActive,
}
```

### String-Based Resolver Matching
```typescript
resolvers: {
  handleTransition: {
    requirement: "TRANSITION",  // Matches req.type === "TRANSITION"
    resolve: async (req, ctx) => {
      // Handle the transition
    },
  },
}
```
