---
title: Redux Bridge
description: Sync Directive state with Redux stores for incremental migration.
---

Bridge Directive with existing Redux stores. {% .lead %}

---

## Installation

```bash
npm install directive directive/bridges
```

---

## Basic Setup

Connect Directive to a Redux store:

```typescript
import { createReduxBridge } from 'directive/bridges';
import { store } from './redux-store';

const bridge = createReduxBridge({
  system,
  reduxStore: store,
  sync: {
    // Directive fact -> Redux state path
    'user': 'auth.user',
    'items': 'cart.items',
  },
});

bridge.connect();
```

---

## Dispatch Actions

Map Directive events to Redux actions:

```typescript
const bridge = createReduxBridge({
  system,
  reduxStore: store,
  actions: {
    USER_LOGGED_IN: (payload) => ({
      type: 'auth/setUser',
      payload: payload.user,
    }),
    CART_UPDATED: (payload) => ({
      type: 'cart/setItems',
      payload: payload.items,
    }),
  },
});
```

---

## Listen to Redux

Update Directive when Redux changes:

```typescript
const bridge = createReduxBridge({
  system,
  reduxStore: store,
  selectors: {
    'user': (state) => state.auth.user,
    'theme': (state) => state.settings.theme,
  },
  bidirectional: true,
});

// Redux changes update Directive facts
```

---

## Thunk Integration

Trigger Redux thunks from Directive:

```typescript
const bridge = createReduxBridge({
  system,
  reduxStore: store,
  thunks: {
    FETCH_USER: (req, dispatch) => {
      dispatch(fetchUserThunk(req.userId));
    },
  },
});
```

---

## Migration Path

1. Add bridge to existing Redux app
2. Create Directive modules for new features
3. Sync shared state through bridge
4. Move logic from Redux to Directive
5. Remove Redux when complete

---

## Next Steps

- See From Redux migration guide
- See Zustand Bridge for Zustand integration
- See Module and System for setup
