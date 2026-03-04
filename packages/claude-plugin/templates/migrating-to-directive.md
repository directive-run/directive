---
name: migrating-to-directive
description: "Migrate state management code from Redux, Zustand, XState, MobX, Recoil, or Jotai to Directive. Provides concept mapping, step-by-step migration patterns, and before/after code examples. Use when asked to migrate, convert, or port existing state management to Directive."
---

# Migrating to Directive

## Prerequisites

This skill applies when migrating TO Directive. The user should have or plan to install `@directive-run/core`: `npm install @directive-run/core`.

## When Claude Should Use This Skill

### Auto-Invoke Triggers
- User mentions migrating FROM Redux, Zustand, XState, MobX, Recoil, or Jotai
- User asks "how do I convert this Redux code to Directive"
- User wants to replace their state management with Directive
- User asks about Directive equivalents of concepts from other libraries
- User has existing code in another library and wants Directive version

### Exclusions — Use a Different Skill
- User is writing Directive from scratch (no migration) → `writing-directive-modules`
- User wants to understand Directive basics → `getting-started-with-directive`

---

## Concept Mapping

## Redux → Directive

| Redux | Directive | Notes |
|-------|-----------|-------|
| Store | System | `createSystem()` wraps modules |
| Slice / Reducer | Module | `createModule()` with schema + init |
| State fields | Facts | Schema keys with `t.*()` type builders |
| Selectors | Derivations | Auto-tracked, no `createSelector` needed |
| Actions | Requirements | Typed with `UPPER_SNAKE_CASE` |
| Thunks / Sagas | Resolvers | Async handlers with retry, dedup |
| Middleware | Plugins | Lifecycle hooks |
| `useSelector` | `useSelector` | From `@directive-run/react` |
| `dispatch(action)` | `system.dispatch(event)` | Or constraint auto-triggers |
| `configureStore` | `createSystem` | With plugins instead of middleware |

### Migration Pattern

```typescript
// BEFORE: Redux Toolkit
const counterSlice = createSlice({
  name: "counter",
  initialState: { value: 0, status: "idle" },
  reducers: {
    increment: (state) => { state.value += 1; },
    decrement: (state) => { state.value -= 1; },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchCount.fulfilled, (state, action) => {
      state.value = action.payload;
      state.status = "loaded";
    });
  },
});

// AFTER: Directive
const counter = createModule("counter", {
  schema: {
    value: t.number(),
    status: t.string<"idle" | "loading" | "loaded">(),
  },
  init: (facts) => {
    facts.value = 0;
    facts.status = "idle";
  },
  // Reducers become direct mutations:
  //   system.facts.value += 1  (no action dispatch needed)
  //
  // Async thunks become constraint + resolver:
  constraints: {
    needsData: {
      when: (facts) => facts.status === "idle",
      require: { type: "FETCH_COUNT" },
    },
  },
  resolvers: {
    fetchCount: {
      requirement: "FETCH_COUNT",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.status = "loading";
        const response = await fetch("/api/count");
        const data = await response.json();
        context.facts.value = data.count;
        context.facts.status = "loaded";
      },
    },
  },
});
```

## Zustand → Directive

| Zustand | Directive | Notes |
|---------|-----------|-------|
| `create()` | `createModule()` | Module is more structured |
| State object | Schema + init | Explicit types with `t.*()` |
| Actions (set) | Direct mutation | `system.facts.x = y` |
| Selectors | Derivations | Auto-tracked |
| Middleware | Plugins | Built-in logging, devtools |
| `useStore` | `useSelector` | From React adapter |

### Migration Pattern

```typescript
// BEFORE: Zustand
const useStore = create((set) => ({
  bears: 0,
  increasePopulation: () => set((state) => ({ bears: state.bears + 1 })),
  removeAllBears: () => set({ bears: 0 }),
}));

// AFTER: Directive
const bearStore = createModule("bear-store", {
  schema: { bears: t.number() },
  init: (facts) => { facts.bears = 0; },
});
const system = createSystem({ module: bearStore });

// Actions become direct mutations:
system.facts.bears += 1;   // increasePopulation
system.facts.bears = 0;    // removeAllBears
```

## XState → Directive

| XState | Directive | Notes |
|--------|-----------|-------|
| Machine | Module | States → facts, transitions → constraints |
| States | Fact values | `status: t.string<"idle" \| "loading">()` |
| Context | Facts | All state in schema |
| Events | Events / Requirements | `dispatch()` or auto-triggered |
| Guards | Constraint `when()` | Predicate functions |
| Actions | Resolver `resolve()` | Async handlers |
| Services | Resolvers | With retry policies |
| `useMachine` | `useSystem` | React adapter |

### Migration Pattern

```typescript
// BEFORE: XState
const toggleMachine = createMachine({
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } },
  },
});

// AFTER: Directive
const toggle = createModule("toggle", {
  schema: {
    status: t.string<"active" | "inactive">(),
  },
  init: (facts) => { facts.status = "inactive"; },
  events: {
    TOGGLE: (facts) => {
      facts.status = facts.status === "active" ? "inactive" : "active";
    },
  },
});
const system = createSystem({ module: toggle });

// Trigger: system.dispatch({ type: "TOGGLE" });
```

## MobX → Directive

| MobX | Directive | Notes |
|------|-----------|-------|
| `observable` | Facts (schema) | Proxy-based, similar feel |
| `computed` | Derivations | Auto-tracked in both |
| `action` | Events / direct mutation | Both work |
| `reaction` | Constraints | When/require pattern |
| `autorun` | Effects | Fire-and-forget |

## Recoil / Jotai → Directive

| Recoil/Jotai | Directive | Notes |
|--------------|-----------|-------|
| Atoms | Facts | Individual state units |
| Selectors/Derived atoms | Derivations | Auto-tracked |
| `useRecoilValue` | `useSelector` | React adapter |
| Async selectors | Constraint + Resolver | Explicit async pattern |

---

## Migration Steps

## Step-by-Step Process

```
1. Identify state shape
   → Map to schema with t.*() type builders
   → Every state field → fact

2. Identify computed values
   → Map to derive {} block
   → Auto-tracked, no dependency arrays needed

3. Identify synchronous actions
   → Direct mutations: system.facts.x = y
   → Or events: events: { ACTION_NAME: (facts, payload) => { ... } }

4. Identify async operations
   → Constraint: when should this async work trigger?
   → Resolver: how to fulfill the requirement?
   → Add retry policies for network calls

5. Identify side effects
   → Map to effects {} block
   → Logging, analytics, DOM sync

6. Identify middleware
   → Map to plugins [] array
   → Use built-in: loggingPlugin, devtoolsPlugin, persistencePlugin

7. Update React components
   → Replace useSelector/useStore with Directive's useSelector
   → Replace dispatch with direct mutation or system.dispatch
```

## Key Differences to Explain

```
Redux:     Action → Reducer → New State (immutable)
Directive: Mutation → Auto-constraint-check → Auto-resolve (mutable proxy)

Zustand:   set() callback → New state
Directive: Direct mutation → Reactive updates

XState:    Event → Guard → Transition → Action
Directive: Fact change → Constraint when() → Requirement → Resolver
```

## Reference Files

Supporting knowledge files loaded with this skill:
- `core-patterns.md` — Directive patterns reference
- `schema-types.md` — Type builder reference for migration
- `anti-patterns.md` — Common mistakes when migrating
