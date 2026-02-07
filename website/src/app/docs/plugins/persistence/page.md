---
title: Persistence Plugin
description: Persist and restore Directive state across sessions.
---

Save and restore state with the persistence plugin. {% .lead %}

---

## Basic Usage

```typescript
import { persistencePlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    persistencePlugin({
      key: 'my-app-state',
    }),
  ],
});
```

---

## Storage Options

```typescript
// localStorage (default)
persistencePlugin({
  key: 'my-app',
  storage: localStorage,
})

// sessionStorage
persistencePlugin({
  key: 'my-app',
  storage: sessionStorage,
})

// Custom storage
persistencePlugin({
  key: 'my-app',
  storage: {
    getItem: (key) => customStore.get(key),
    setItem: (key, value) => customStore.set(key, value),
    removeItem: (key) => customStore.delete(key),
  },
})
```

---

## Selective Persistence

Only persist specific facts:

```typescript
persistencePlugin({
  key: 'my-app',
  include: ['user', 'preferences', 'cart'],
})

// Or exclude sensitive data
persistencePlugin({
  key: 'my-app',
  exclude: ['password', 'token', 'tempData'],
})
```

---

## Versioning

Handle schema changes:

```typescript
persistencePlugin({
  key: 'my-app',
  version: 2,
  migrate: (state, fromVersion) => {
    if (fromVersion === 1) {
      return {
        ...state,
        newField: 'default',
      };
    }
    return state;
  },
})
```

---

## Throttling

Limit save frequency:

```typescript
persistencePlugin({
  key: 'my-app',
  throttle: 1000, // Save at most once per second
})
```

---

## Encryption

Encrypt sensitive data:

```typescript
persistencePlugin({
  key: 'my-app',
  serialize: (state) => encrypt(JSON.stringify(state)),
  deserialize: (data) => JSON.parse(decrypt(data)),
})
```

---

## Next Steps

- See Plugin Overview for all plugins
- See Logging for debugging
- See Custom Plugins for building your own
