# Constraints

Constraints declare WHEN something is needed. They are the demand side of the constraint-resolver pattern. Constraints evaluate conditions against facts and emit requirements that resolvers fulfill.

## Decision Tree: "Should this be a constraint?"

```
Is this a condition that triggers work?
├── Yes, and the work is async/side-effectful → Constraint + Resolver
├── Yes, but the work is just a state derivation → Use derive instead
├── No, it's reacting to a change that already happened → Use effect
└── No, it's user-initiated → Use event handler
```

## Basic Constraint Anatomy

A constraint has two parts: `when` (condition) and `require` (what's needed).

```typescript
constraints: {
  fetchUserWhenReady: {
    // when() returns boolean – evaluated on every fact change
    when: (facts) => facts.isAuthenticated && !facts.user,

    // require – the requirement to emit when condition is true
    require: { type: "FETCH_USER", userId: facts.userId },
  },
},
```

### Static vs Dynamic Requirements

```typescript
// Static requirement – same object every time
constraints: {
  loadConfig: {
    when: (facts) => facts.config === null,
    require: { type: "LOAD_CONFIG" },
  },
},

// Dynamic requirement – function that reads facts
constraints: {
  fetchUser: {
    when: (facts) => facts.isAuthenticated && !facts.profile,
    require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
  },
},

// Multiple requirements – return an array
constraints: {
  loadAll: {
    when: (facts) => facts.phase === "init",
    require: [
      { type: "LOAD_CONFIG" },
      { type: "LOAD_USER" },
    ],
  },
},
```

## Priority

Higher priority constraints are evaluated first. Use priority for conflict resolution when multiple constraints could fire simultaneously.

```typescript
constraints: {
  normalTransition: {
    priority: 50,
    when: (facts) => facts.phase === "red" && facts.elapsed > 30,
    require: { type: "TRANSITION", to: "green" },
  },

  emergencyOverride: {
    priority: 100, // Evaluated before normalTransition
    when: (facts) => facts.emergencyActive,
    require: { type: "TRANSITION", to: "red" },
  },
},
```

Default priority is 0. Higher numbers run first.

## Ordering with `after`

Use `after` to declare that a constraint should only be evaluated after another constraint's resolver completes. This is different from priority (evaluation order) -- `after` blocks evaluation entirely until the dependency is resolved.

```typescript
constraints: {
  authenticate: {
    when: (facts) => !facts.token,
    require: { type: "AUTHENTICATE" },
  },

  // Only evaluate after authenticate's resolver completes
  loadProfile: {
    after: ["authenticate"],
    when: (facts) => facts.token && !facts.profile,
    require: { type: "LOAD_PROFILE" },
  },

  // Cross-module after reference
  loadData: {
    after: ["auth::authenticate"],
    when: (facts) => facts.self.dataNeeded,
    require: { type: "LOAD_DATA" },
  },
},
```

If the dependency's `when()` returns false (no requirement emitted), the blocked constraint proceeds normally. If the dependency's resolver fails, the blocked constraint remains blocked.

## Async Constraints

For conditions that require async evaluation (e.g., remote validation). Async constraints MUST declare `deps` for dependency tracking.

```typescript
constraints: {
  validateToken: {
    async: true,
    deps: ["token"], // REQUIRED for async constraints

    when: async (facts) => {
      const valid = await validateTokenRemotely(facts.token);

      return valid;
    },

    require: { type: "REFRESH_TOKEN" },
    timeout: 5000, // Optional timeout in ms
  },
},
```

### Why `deps` is Required for Async

Synchronous constraints use auto-tracking (proxy-based). Async constraints cannot be auto-tracked because the function is suspended across await boundaries. The `deps` array tells the engine which facts to watch.

```typescript
// WRONG – async without deps, engine cannot track dependencies
constraints: {
  check: {
    async: true,
    when: async (facts) => await validate(facts.token),
    require: { type: "REFRESH" },
  },
},

// CORRECT – deps tells the engine to re-evaluate when token changes
constraints: {
  check: {
    async: true,
    deps: ["token"],
    when: async (facts) => await validate(facts.token),
    require: { type: "REFRESH" },
  },
},
```

## Disabling Constraints at Runtime

```typescript
const system = createSystem({ module: myModule });
system.start();

// Disable a constraint – it won't be evaluated
system.constraints.disable("fetchUserWhenReady");

// Check if disabled
system.constraints.isDisabled("fetchUserWhenReady"); // true

// Re-enable – triggers re-evaluation on next cycle
system.constraints.enable("fetchUserWhenReady");
```

## Common Mistakes

### Putting async logic in resolvers instead of constraints

```typescript
// WRONG – resolver checks conditions (constraint's job)
resolvers: {
  fetchData: {
    requirement: "FETCH",
    resolve: async (req, context) => {
      if (!context.facts.isAuthenticated) {
        return; // Should be in constraint's when()
      }
      // ...
    },
  },
},

// CORRECT – constraint declares when, resolver just does the work
constraints: {
  fetchWhenAuth: {
    when: (facts) => facts.isAuthenticated && !facts.data,
    require: { type: "FETCH" },
  },
},

resolvers: {
  fetchData: {
    requirement: "FETCH",
    resolve: async (req, context) => {
      const res = await fetch("/api/data");
      context.facts.data = await res.json();
    },
  },
},
```

### String literal for require

```typescript
// WRONG – require must be an object
require: "FETCH_DATA",

// CORRECT – object with type property
require: { type: "FETCH_DATA" },

// CORRECT – with payload
require: { type: "FETCH_DATA", endpoint: "/api/users" },

// CORRECT – dynamic from facts
require: (facts) => ({ type: "FETCH_DATA", userId: facts.currentUserId }),
```

### Returning null to conditionally skip

```typescript
// require can return null to suppress the requirement
constraints: {
  conditionalFetch: {
    when: (facts) => facts.needsUpdate,
    require: (facts) => {
      if (!facts.userId) {
        return null; // No requirement emitted
      }

      return { type: "FETCH_USER", userId: facts.userId };
    },
  },
},
```

## Constraints vs Effects vs Derivations

| Feature | Purpose | Triggers |
|---|---|---|
| Constraint | Declare a need (emit requirement) | Fact changes, re-evaluated automatically |
| Resolver | Fulfill a need (async work) | Requirement emitted by constraint |
| Effect | React to changes (fire-and-forget) | Fact changes, runs after reconciliation |
| Derivation | Compute a value (synchronous, cached) | Fact changes, recomputed lazily |

### When to Use Which

```
"When X is true, the system needs Y" → Constraint
"Do Y" → Resolver
"Whenever X changes, log it" → Effect
"X is always facts.a + facts.b" → Derivation
```
