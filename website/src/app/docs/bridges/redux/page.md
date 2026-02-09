---
title: Redux Bridge
description: Replace thunks and sagas with constraint-driven orchestration while keeping your Redux store.
---

Directive integrates directly into Redux as middleware, replacing thunks and sagas with constraint-driven async orchestration — without rewriting your reducers. {% .lead %}

Redux continues to own predictable state (reducers, actions, selectors). Directive takes over the messy parts: async side effects, cross-cutting constraints, and requirement resolution. The bridge syncs Redux state into Directive facts so constraints can evaluate against your store, and resolvers can dispatch actions back.

---

## Installation

```bash
npm install directive
```

Import from the `directive/redux` subpath:

```typescript
import {
  createDirectiveMiddleware,
  createDirectiveEnhancer,
  bindReduxToDirective,
  directiveEvent,
  directiveRequire,
  isDirectiveAction,
  createDirectiveDevToolsEnhancer,
  createDirectiveSelector,
  createReduxResolver,
  createReduxConstraint,
  createActionInterceptor,
} from 'directive/redux';
```

---

## Middleware Pattern

The primary integration point. `createDirectiveMiddleware` returns standard Redux middleware that intercepts actions, syncs state to Directive facts, and lets resolvers dispatch back into Redux.

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createDirectiveMiddleware } from 'directive/redux';

interface RootState {
  auth: { isLoggedIn: boolean; token: string | null };
  user: { data: User | null; loading: boolean };
  notifications: { items: Notification[] };
}

const directiveMiddleware = createDirectiveMiddleware<RootState>({
  constraints: {
    fetchUserOnLogin: {
      when: (state) => state.auth.isLoggedIn && !state.user.data && !state.user.loading,
      require: { type: 'FETCH_USER' },
    },
    loadNotifications: {
      when: (state) => state.auth.isLoggedIn && state.notifications.items.length === 0,
      require: { type: 'FETCH_NOTIFICATIONS' },
      priority: 10,
    },
  },

  resolvers: {
    fetchUser: {
      requirement: (req): req is { type: 'FETCH_USER' } => req.type === 'FETCH_USER',
      resolve: async (req, { dispatch, getState, signal }) => {
        const { token } = getState().auth;
        const res = await fetch('/api/user', {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        const user = await res.json();
        dispatch({ type: 'user/setUser', payload: user });
      },
    },
    fetchNotifications: {
      requirement: (req): req is { type: 'FETCH_NOTIFICATIONS' } =>
        req.type === 'FETCH_NOTIFICATIONS',
      key: () => 'notifications', // Dedupe concurrent calls
      resolve: async (req, { dispatch, signal }) => {
        const res = await fetch('/api/notifications', { signal });
        const items = await res.json();
        dispatch({ type: 'notifications/set', payload: items });
      },
    },
  },

  debug: true,
});

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) => getDefault().concat(directiveMiddleware),
});
```

### How It Works

1. Every dispatched action passes through the middleware
2. After Redux reduces the action, the new state syncs to Directive facts
3. Directive evaluates constraints against the current Redux state
4. When a constraint's `when` returns `true`, it produces a requirement
5. Matching resolvers fulfill the requirement and can dispatch new Redux actions
6. The cycle continues until all constraints are satisfied

### Options Reference

| Option | Type | Description |
|--------|------|-------------|
| `constraints` | `Record<string, ReduxConstraint<S>>` | Constraints that evaluate against Redux state |
| `resolvers` | `Record<string, ReduxResolver<S>>` | Resolvers that fulfill requirements |
| `interceptors` | `ActionInterceptor<S>[]` | Convert Redux actions into Directive requirements |
| `syncActions` | `boolean \| ((action) => boolean)` | Sync dispatched actions to Directive facts |
| `onRequirementCreated` | `(req: Requirement) => void` | Callback when a requirement is produced |
| `onRequirementResolved` | `(req: Requirement) => void` | Callback when a requirement is fulfilled |
| `plugins` | `Plugin[]` | Directive plugins (logging, persistence, etc.) |
| `debug` | `boolean` | Enable time-travel debugging |

---

## Store Enhancer

`createDirectiveEnhancer` wraps your store and exposes the Directive system directly on it. Use this when you need to access the system from outside middleware (components, tests, devtools).

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createDirectiveEnhancer } from 'directive/redux';

const store = configureStore({
  reducer: rootReducer,
  enhancers: (getDefault) =>
    getDefault().concat(
      createDirectiveEnhancer<RootState>({
        constraints: {
          fetchUserOnLogin: {
            when: (state) => state.auth.isLoggedIn && !state.user.data,
            require: { type: 'FETCH_USER' },
          },
        },
        resolvers: {
          fetchUser: {
            requirement: (req): req is { type: 'FETCH_USER' } => req.type === 'FETCH_USER',
            resolve: async (req, { dispatch }) => {
              const user = await api.fetchUser();
              dispatch({ type: 'user/setUser', payload: user });
            },
          },
        },
      })
    ),
});

// Access the Directive system from the store
const system = store.directive;
console.log(system.inspect());

// Wait for all requirements to settle (useful in tests)
await store.settleDirective();
```

The enhancer accepts the same `DirectiveMiddlewareOptions<S>` as the middleware. It adds two properties to the store:

| Property | Type | Description |
|----------|------|-------------|
| `directive` | `System` | The underlying Directive system |
| `settleDirective()` | `() => Promise<void>` | Resolves when all pending requirements complete |

---

## Action Interceptors

Interceptors convert Redux actions into Directive requirements before (or instead of) reaching the reducer. This is the migration path for thunks: replace async action creators with interceptors that hand off to Directive resolvers.

```typescript
const directiveMiddleware = createDirectiveMiddleware<RootState>({
  interceptors: [
    {
      match: (action) => action.type === 'cart/checkout',
      toRequirement: (action, state) => ({
        type: 'PROCESS_CHECKOUT',
        items: state.cart.items,
        total: state.cart.total,
      }),
      blockAction: true, // Don't pass to reducer, Directive owns this
    },
    {
      match: (action) => action.type === 'search/query',
      toRequirement: (action) => ({
        type: 'DEBOUNCED_SEARCH',
        query: action.payload,
      }),
      blockAction: false, // Let reducer update optimistically
    },
  ],

  resolvers: {
    checkout: {
      requirement: (req): req is { type: 'PROCESS_CHECKOUT'; items: any[]; total: number } =>
        req.type === 'PROCESS_CHECKOUT',
      resolve: async (req, { dispatch, signal }) => {
        dispatch({ type: 'cart/setProcessing', payload: true });
        const order = await api.checkout(req.items, req.total, signal);
        dispatch({ type: 'cart/checkoutComplete', payload: order });
      },
    },
  },
});
```

### Interceptor Fields

| Field | Type | Description |
|-------|------|-------------|
| `match` | `(action: AnyAction) => boolean` | Return `true` for actions this interceptor handles |
| `toRequirement` | `(action, state) => Requirement \| null` | Convert the action to a requirement (or `null` to skip) |
| `blockAction` | `boolean` | If `true`, the action never reaches the reducer |

---

## Two-Way Binding

`bindReduxToDirective` connects an existing Redux store to an existing Directive system without middleware. Useful when the two systems were set up independently and you need to sync state between them.

```typescript
import { createSystem } from 'directive';
import { bindReduxToDirective } from 'directive/redux';

const directiveSystem = createSystem({ module: myModule });
const reduxStore = createStore(rootReducer);

const { sync, unsync } = bindReduxToDirective(reduxStore, directiveSystem, {
  // Redux state -> Directive facts
  toFacts: (state) => ({
    userId: state.user?.id,
    isLoggedIn: state.auth.isLoggedIn,
    cartTotal: state.cart.total,
  }),

  // Directive facts -> Redux actions (optional)
  fromFacts: (facts) => ({
    action: { type: 'directive/sync', payload: { isLoggedIn: facts.isLoggedIn } },
  }),

  // Only watch these fact keys for Directive -> Redux sync
  watchFacts: ['isLoggedIn', 'cartTotal'],
});

// Start synchronization
sync();

// Later, tear down
unsync();
```

The binding performs an initial sync on `sync()` and subscribes to changes in both directions. The `isSyncing` guard prevents infinite update loops.

---

## Redux DevTools Integration

`createDirectiveDevToolsEnhancer` pipes Directive state changes into Redux DevTools so you can inspect both systems in one panel.

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createDirectiveDevToolsEnhancer } from 'directive/redux';

const directiveSystem = createSystem({ module: myModule });

const store = configureStore({
  reducer: rootReducer,
  enhancers: (getDefault) =>
    getDefault().concat(createDirectiveDevToolsEnhancer(directiveSystem)),
});
```

Every Directive fact change dispatches a virtual `@@directive/STATE_UPDATE` action with the current facts snapshot, making it visible in the DevTools action log and state diff viewer.

---

## Action Creators and Selectors

### Action Creators

Dispatch Directive events and requirements through Redux:

```typescript
import { directiveEvent, directiveRequire, isDirectiveAction } from 'directive/redux';

// Dispatch a Directive event via Redux
store.dispatch(directiveEvent({ type: 'USER_ACTION', data: { clicked: true } }));

// Inject a requirement via Redux
store.dispatch(directiveRequire({ type: 'FETCH_USER', userId: 42 }));

// Type guard in reducers or middleware
function myReducer(state, action) {
  if (isDirectiveAction(action)) {
    // action is DirectiveEventAction | DirectiveRequireAction
    return state; // Let Directive handle it
  }
  // ...
}
```

| Function | Action Type | Description |
|----------|-------------|-------------|
| `directiveEvent(event)` | `@@directive/EVENT` | Dispatch a Directive system event |
| `directiveRequire(requirement)` | `@@directive/REQUIRE` | Inject a requirement into Directive |
| `isDirectiveAction(action)` | -- | Type guard for either Directive action |

### Selectors

Read Directive derivations inside Redux selectors and React components:

```typescript
import { createDirectiveSelector } from 'directive/redux';

// Store must have DirectiveStoreExtension (use createDirectiveEnhancer)
const selectIsLoading = createDirectiveSelector<RootState, boolean>(store, 'isLoading');
const selectUserStatus = createDirectiveSelector<RootState, string>(store, 'userStatus');

// In a React component
const isLoading = useSelector(selectIsLoading);
```

### Type Helpers

Identity functions that provide type inference without runtime cost:

```typescript
import {
  createReduxResolver,
  createReduxConstraint,
  createActionInterceptor,
} from 'directive/redux';

const myConstraint = createReduxConstraint<RootState>({
  when: (state) => state.auth.isLoggedIn && !state.user.data,
  require: { type: 'FETCH_USER' },
});

const myResolver = createReduxResolver<RootState, { type: 'FETCH_USER' }>({
  requirement: (req): req is { type: 'FETCH_USER' } => req.type === 'FETCH_USER',
  resolve: async (req, { dispatch }) => {
    const user = await api.fetchUser();
    dispatch({ type: 'user/setUser', payload: user });
  },
});

const myInterceptor = createActionInterceptor<RootState>({
  match: (action) => action.type === 'cart/checkout',
  toRequirement: (action, state) => ({ type: 'CHECKOUT', items: state.cart.items }),
  blockAction: true,
});
```

---

## Migration Strategy

Replace thunks and sagas incrementally. Redux keeps working the entire time.

**Step 1: Add the middleware to your existing store.**

```typescript
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) =>
    getDefault().concat(createDirectiveMiddleware<RootState>({ resolvers: {} })),
});
```

**Step 2: Move one thunk to a constraint + resolver pair.** Pick a simple async flow. Define a constraint that watches Redux state and a resolver that dispatches actions.

**Step 3: Add interceptors for action-triggered async.** Replace `createAsyncThunk` calls with interceptors that convert the action to a requirement and `blockAction: true`.

**Step 4: Repeat.** Each thunk or saga becomes a constraint/resolver. Redux reducers stay untouched.

**Step 5: Remove middleware dependencies.** Once all async logic lives in Directive, remove `redux-thunk`, `redux-saga`, or `redux-observable` from your dependencies.

---

## Next Steps

- See [From Redux](/docs/migration/from-redux) for a full migration guide
- See [Zustand Bridge](/docs/bridges/zustand) for Zustand integration
- See [Constraints](/docs/constraints) and [Resolvers](/docs/resolvers) for the core concepts
- See [Module and System](/docs/module-system) for Directive setup
