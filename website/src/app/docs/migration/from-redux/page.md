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
// Redux
import { createSlice, configureStore } from '@reduxjs/toolkit';

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

export const { increment, decrement, incrementByAmount } = counterSlice.actions;

const store = configureStore({
  reducer: { counter: counterSlice.reducer },
});

// Usage
store.dispatch(increment());
const value = store.getState().counter.value;
```

## After: Directive Counter

```typescript
// Directive
import { createModule, createSystem, t } from 'directive';

const counterModule = createModule("counter", {
  schema: {
    facts: { value: t.number() },
  },
  init: (facts) => {
    facts.value = 0;
  },
});

const system = createSystem({ module: counterModule });

// Usage - direct mutation
system.facts.value++;                    // increment
system.facts.value--;                    // decrement
system.facts.value += 10;                // incrementByAmount
const value = system.facts.value;        // read
```

---

## Migrating Selectors to Derivations

### Redux Selectors

```typescript
// Redux selectors
const selectTotal = (state) =>
  state.cart.items.reduce((sum, item) => sum + item.price, 0);

const selectItemCount = (state) => state.cart.items.length;

const selectCartSummary = createSelector(
  [selectTotal, selectItemCount],
  (total, count) => ({ total, count })
);
```

### Directive Derivations

```typescript
// Directive - no manual dependency tracking
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
    total: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price, 0),
    itemCount: (facts) => facts.items.length,
    // Composition just works
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
// Redux thunk
export const fetchUser = (userId) => async (dispatch) => {
  dispatch(fetchUserStart());
  try {
    const user = await api.getUser(userId);
    dispatch(fetchUserSuccess(user));
  } catch (error) {
    dispatch(fetchUserFailure(error.message));
  }
};

// Slice reducers
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

// Usage
dispatch(fetchUser(123));
```

### Directive Constraints + Resolvers

```typescript
// Directive - declarative data fetching
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
  // Declare WHAT must be true
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },
  // Define HOW to make it true
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

// Usage - just set the userId, fetching happens automatically
system.facts.userId = 123;
```

---

## Migrating Middleware to Plugins

### Redux Middleware

```typescript
// Redux logging middleware
const logger = (store) => (next) => (action) => {
  console.log('dispatching', action);
  const result = next(action);
  console.log('next state', store.getState());
  return result;
};

const store = configureStore({
  reducer: rootReducer,
  middleware: [logger],
});
```

### Directive Plugin

```typescript
// Directive logging plugin
import { loggingPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin()],
});

// Or custom plugin
const myPlugin = {
  onFactChange: (key, value, prev) => {
    console.log(`Fact ${key}: ${prev} -> ${value}`);
  },
  onRequirement: (req) => {
    console.log('Requirement:', req);
  },
};
```

---

## Incremental Migration

### Step 1: Add Directive alongside Redux

```typescript
// Keep Redux for existing features
const reduxStore = configureStore({ reducer: rootReducer });

// Add Directive for new features
const directiveSystem = createSystem({ module: newFeatureModule });

// Sync if needed
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
import { useSelector, useDispatch } from 'react-redux';
import { increment, decrement } from './counterSlice';

function Counter() {
  const count = useSelector((state) => state.counter.value);
  const dispatch = useDispatch();

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => dispatch(decrement())}>-</button>
      <button onClick={() => dispatch(increment())}>+</button>
    </div>
  );
}
```

### Directive Component

```typescript
import { useFact } from 'directive/react';
import { system } from './system';

function Counter() {
  const count = useFact(system, "value");

  return (
    <div>
      <p>{count}</p>
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
