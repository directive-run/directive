---
title: Migrating from Redux
description: Step-by-step guide to migrate from Redux to Directive with before/after comparisons.
---

Migrate your Redux application to Directive incrementally. {% .lead %}

---

## Key Differences

| Redux | Directive |
|-------|-----------|
| Actions + Reducers | Facts (direct mutation) |
| Selectors | Derivations (auto-tracked) |
| Thunks/Sagas | Constraints + Resolvers |
| Middleware | Plugins |
| dispatch() | Direct assignment |

---

## Before: Redux Counter

```typescript
// Before: Redux approach – slices, actions, reducers, dispatch
import { createSlice, configureStore } from '@reduxjs/toolkit';

// Define a slice with name, initial state, and reducer functions
const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    increment: (state) => { state.value += 1 },
    decrement: (state) => { state.value -= 1 },
    incrementByAmount: (state, action) => {
      state.value += action.payload
    },
  },
});

// Export auto-generated action creators
export const { increment, decrement, incrementByAmount } = counterSlice.actions;

// Wire up the store with all slice reducers
const store = configureStore({
  reducer: { counter: counterSlice.reducer },
});

// Usage – dispatch action objects, read via getState()
store.dispatch(increment());
const value = store.getState().counter.value;
```

## After: Directive Counter

```typescript
// After: Directive approach – no actions, no reducers, no dispatch
import { createModule, createSystem, t } from 'directive';

// Define a module with typed schema
const counterModule = createModule("counter", {
  schema: {
    facts: { value: t.number() },
  },

  init: (facts) => {
    facts.value = 0;
  },
});

// Create and start the system
const system = createSystem({ module: counterModule });
system.start();

// Usage – mutate facts directly, no action creators needed
system.facts.value++;                    // increment
system.facts.value--;                    // decrement
system.facts.value += 10;               // incrementByAmount
const value = system.facts.value;        // read
```

---

## Migrating Selectors to Derivations

### Redux Selectors

```typescript
// Before: Redux selectors – manual dependency declarations with createSelector
const selectTotal = (state) =>
  state.cart.items.reduce((sum, item) => sum + item.price, 0);

const selectItemCount = (state) => state.cart.items.length;

// Must explicitly list input selectors for memoization
const selectCartSummary = createSelector(
  [selectTotal, selectItemCount],
  (total, count) => ({ total, count })
);
```

### Directive Derivations

```typescript
// After: Directive derivations – dependencies are auto-tracked, no manual wiring
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
    },
  },

  init: (facts) => {
    facts.items = [];
  },

  derive: {
    // Reads `items` automatically – recomputes only when items change
    total: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price, 0),

    itemCount: (facts) => facts.items.length,

    // Derivations can compose other derivations – no createSelector needed
    summary: (facts, derive) => ({
      total: derive.total,
      count: derive.itemCount,
    }),
  },
});
```

---

## Migrating Thunks to Constraints + Resolvers

### Redux Thunk

```typescript
// Before: Redux thunk – async logic dispatches multiple actions to update state
export const fetchUser = (userId) => async (dispatch) => {
  dispatch(fetchUserStart());          // Signal loading started

  try {
    const user = await api.getUser(userId);
    dispatch(fetchUserSuccess(user));   // Signal success with data
  } catch (error) {
    dispatch(fetchUserFailure(error.message)); // Signal failure
  }
};

// Slice reducers – one for each loading state transition
const userSlice = createSlice({
  name: 'user',
  initialState: { user: null, loading: false, error: null },
  reducers: {
    fetchUserStart: (state) => { state.loading = true },

    fetchUserSuccess: (state, action) => {
      state.loading = false;
      state.user = action.payload;
    },

    fetchUserFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },
  },
});

// Usage – caller must dispatch the thunk manually
dispatch(fetchUser(123));
```

### Directive Constraints + Resolvers

```typescript
// After: Directive – declarative data fetching, no thunks or dispatch
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },

  // Declare WHAT must be true – replaces the thunk trigger logic
  constraints: {
    needsUser: {
      // Automatically fires when userId is set and no user data exists
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },

  // Define HOW to fulfill the requirement – replaces the thunk body
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.loading = true;

        try {
          context.facts.user = await api.getUser(context.facts.userId);
          context.facts.error = null;
        } catch (error) {
          context.facts.error = error.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});

// Usage – just set the fact, the constraint handles the rest
system.facts.userId = 123;
```

---

## Migrating Middleware to Plugins

### Redux Middleware

```typescript
// Before: Redux logging middleware – triple-nested function signature
const logger = (store) => (next) => (action) => {
  console.log('dispatching', action);   // Log before reducer runs
  const result = next(action);           // Pass action down the chain
  console.log('next state', store.getState()); // Log after reducer runs
  return result;
};

const store = configureStore({
  reducer: rootReducer,
  middleware: [logger],
});
```

### Directive Plugin

```typescript
// After: Directive plugin – use the built-in or write a simple object
import { loggingPlugin } from 'directive/plugins';

// Built-in plugin handles common logging needs
const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin()],
});

// Or define a custom plugin – plain object with lifecycle hooks
const myPlugin = {
  // Called whenever a fact value changes
  onFactSet: (key, value, prev) => {
    console.log(`Fact ${key}: ${prev} -> ${value}`);
  },

  // Called whenever a requirement is generated by a constraint
  onRequirement: (req) => {
    console.log('Requirement:', req);
  },
};
```

---

## Incremental Migration

### Step 1: Add Directive alongside Redux

```typescript
// Step 1: Run both side by side – Redux for existing code, Directive for new features
const reduxStore = configureStore({ reducer: rootReducer });

const directiveSystem = createSystem({ module: newFeatureModule });
directiveSystem.start();

// Optional: sync Directive fact changes back into Redux during migration
directiveSystem.facts.$store.subscribeAll((key, value) => {
  reduxStore.dispatch(syncFromDirective({ [key]: value }));
});
```

### Step 2: Migrate one slice at a time

```typescript
// Move counter from Redux to Directive
// 1. Create Directive module
// 2. Update components to use useFact(system, "key") instead of useSelector()
// 3. Remove Redux slice
```

### Step 3: Remove Redux when done

```bash
npm uninstall @reduxjs/toolkit react-redux
```

---

## React Component Migration

### Redux Component

```typescript
// Before: Redux component – useSelector to read, useDispatch to write
import { useSelector, useDispatch } from 'react-redux';
import { increment, decrement } from './counterSlice';

function Counter() {
  // Read state through a selector function
  const count = useSelector((state) => state.counter.value);
  const dispatch = useDispatch();

  return (
    <div>
      <p>{count}</p>
      {/* Dispatch action creators to update state */}
      <button onClick={() => dispatch(decrement())}>-</button>
      <button onClick={() => dispatch(increment())}>+</button>
    </div>
  );
}
```

### Directive Component

```typescript
// After: Directive component – useFact to read, direct mutation to write
import { useFact } from 'directive/react';
import { system } from './system';

function Counter() {
  // Subscribe to a single fact – re-renders only when this value changes
  const count = useFact(system, "value");

  return (
    <div>
      <p>{count}</p>
      {/* Mutate facts directly – no dispatch, no action creators */}
      <button onClick={() => system.facts.value--}>-</button>
      <button onClick={() => system.facts.value++}>+</button>
    </div>
  );
}
```

---

## Next Steps

- See the [Quick Start](/docs/quick-start) for a complete tutorial
- See [Constraints](/docs/constraints) for declarative logic
- See the [React Adapter](/docs/adapters/react) for hook patterns
