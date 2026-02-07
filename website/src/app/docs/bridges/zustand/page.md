---
title: Zustand Bridge
description: Sync Directive state with Zustand stores for incremental migration.
---

Bridge Directive with existing Zustand stores. {% .lead %}

---

## Installation

```bash
npm install directive directive/bridges
```

---

## Basic Sync

Sync Directive facts to a Zustand store:

```typescript
import { createZustandBridge } from 'directive/bridges';
import { useStore } from './zustand-store';

const bridge = createZustandBridge({
  system,
  zustandStore: useStore,
  sync: {
    // Directive fact -> Zustand state
    'user': 'currentUser',
    'items': 'cartItems',
  },
});

// Start syncing
bridge.connect();

// Stop syncing
bridge.disconnect();
```

---

## Two-Way Sync

Enable bidirectional synchronization:

```typescript
const bridge = createZustandBridge({
  system,
  zustandStore: useStore,
  sync: {
    'user': { to: 'currentUser', from: 'currentUser' },
    'theme': { to: 'theme', from: 'theme' },
  },
  bidirectional: true,
});
```

---

## Selective Sync

Only sync specific facts:

```typescript
const bridge = createZustandBridge({
  system,
  zustandStore: useStore,
  sync: {
    'cart.items': 'items',
    'cart.total': 'total',
  },
  filter: (key, value) => {
    // Don't sync loading states
    if (key.includes('loading')) return false;
    return true;
  },
});
```

---

## Transform Values

Transform values during sync:

```typescript
const bridge = createZustandBridge({
  system,
  zustandStore: useStore,
  sync: {
    'user': {
      to: 'currentUser',
      transform: (user) => ({
        ...user,
        displayName: `${user.firstName} ${user.lastName}`,
      }),
    },
  },
});
```

---

## Migration Strategy

1. Start with Zustand as source of truth
2. Add Directive for new features
3. Bridge existing state
4. Gradually move logic to Directive
5. Remove Zustand when migration complete

---

## Next Steps

- See From Zustand migration guide
- See Redux Bridge for Redux integration
- See React Query Bridge for data fetching
