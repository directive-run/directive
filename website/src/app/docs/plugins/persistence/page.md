---
title: Persistence Plugin
description: Save and restore Directive facts to localStorage, sessionStorage, or any custom storage backend.
---

Automatically persist facts to storage and restore them on init, with debounced saves, selective key filtering, and prototype pollution protection. {% .lead %}

---

## Basic Usage

```typescript
import { persistencePlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    persistencePlugin({
      storage: localStorage,
      key: 'my-app-state',
    }),
  ],
});
```

Both `storage` and `key` are required. On init the plugin reads from `storage.getItem(key)`, parses the JSON, and restores matching facts. On every subsequent fact change it debounces a save back to `storage.setItem(key, ...)`.

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage` | `Storage` | — (required) | Storage backend. Must implement `getItem`, `setItem`, and `removeItem`. |
| `key` | `string` | — (required) | The key used to read and write in the storage backend. |
| `include` | `string[]` | all keys | Only persist these fact keys. |
| `exclude` | `string[]` | `[]` | Exclude these fact keys from persistence. |
| `debounce` | `number` | `100` | Milliseconds to debounce saves. |
| `onRestore` | `(data: Record<string, unknown>) => void` | — | Called after state is restored from storage. |
| `onSave` | `(data: Record<string, unknown>) => void` | — | Called after state is saved to storage. |
| `onError` | `(error: Error) => void` | — | Called on parse errors, storage failures, or security rejections. |

---

## Storage Backends

Any object implementing the `Storage` interface (`getItem`, `setItem`, `removeItem`) works.

### localStorage

Persists across tabs and browser restarts:

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
})
```

### sessionStorage

Cleared when the tab closes:

```typescript
persistencePlugin({
  storage: sessionStorage,
  key: 'my-app',
})
```

### Custom Storage

Implement the three required methods to back persistence with any store:

```typescript
persistencePlugin({
  storage: {
    getItem: (key) => redis.get(key),
    setItem: (key, value) => redis.set(key, value),
    removeItem: (key) => redis.del(key),
  },
  key: 'my-app',
})
```

---

## Selective Persistence

Use `include` to persist only specific keys:

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
  include: ['user', 'preferences', 'cart'],
})
```

Or use `exclude` to skip sensitive or transient data:

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
  exclude: ['token', 'tempData'],
})
```

When both are provided, `exclude` is checked first. A key must pass both filters to be persisted.

---

## Debounce

Saves are debounced to avoid hammering storage on rapid updates. The default is **100 ms**. Each new fact change resets the timer, so a burst of changes results in a single write after the burst settles.

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
  debounce: 500, // wait 500ms after the last change
})
```

When the system is destroyed (`onDestroy`), any pending debounce timer is cleared and a final synchronous save runs immediately so no changes are lost.

---

## Callbacks

### onRestore

Called once during init after facts are restored from storage. Receives the parsed data object:

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
  onRestore: (data) => {
    console.log('Restored state:', Object.keys(data));
  },
})
```

### onSave

Called after every successful save. Receives the data object that was written:

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
  onSave: (data) => {
    console.log('Saved', Object.keys(data).length, 'keys');
  },
})
```

### onError

Called on JSON parse failures, storage quota errors, or security rejections. Without this callback, errors are silently swallowed:

```typescript
persistencePlugin({
  storage: localStorage,
  key: 'my-app',
  onError: (error) => {
    console.error('Persistence error:', error.message);
  },
})
```

---

## Security

The plugin includes built-in prototype pollution protection. Before restoring any data from storage, it validates the parsed object with `isPrototypeSafe`. If the data contains keys like `__proto__`, `constructor`, or `prototype`, the restore is rejected and `onError` is called with a descriptive error. This prevents a tampered storage entry from polluting object prototypes at runtime.

---

## Next Steps

- [Logging Plugin](/docs/plugins/logging) -- console logging for lifecycle events
- [DevTools Plugin](/docs/plugins/devtools) -- browser integration
- [Plugin Overview](/docs/plugins/overview) -- all built-in plugins
