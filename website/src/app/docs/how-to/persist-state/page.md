---
title: How to Persist and Restore State
description: Save and restore Directive state across page reloads with selective filtering and schema migrations.
---

Persist state across page reloads with selective filtering, schema migrations, and SSR coordination. {% .lead %}

---

## The Problem

Users expect their preferences, draft content, and navigation state to survive page reloads. Naively serializing the entire state creates problems: some facts are transient (loading flags, WebSocket status), schema changes between versions break deserialization, and SSR hydration can conflict with persisted state.

## The Solution

```typescript
import { createSystem } from '@directive-run/core';
import { persistencePlugin } from '@directive-run/core/plugins';
import { authModule } from './modules/auth';
import { settingsModule } from './modules/settings';

const system = createSystem({
  modules: {
    auth: authModule,
    settings: settingsModule,
  },
  plugins: [
    persistencePlugin({
      // Storage backend
      storage: localStorage,
      key: 'directive-app-state',

      // Only persist specific facts
      include: [
        'settings::theme',
        'settings::locale',
        'settings::sidebarCollapsed',
        'auth::refreshToken',
      ],

      // Or exclude transient facts
      // exclude: ['auth.status', '*.isLoading'],

      // Debounce writes (ms)
      debounce: 500,

      // Schema migration
      version: 2,
      migrate: (persisted, fromVersion) => {
        if (fromVersion === 1) {
          // v1 → v2: theme was a boolean, now it's a string
          return {
            ...persisted,
            'settings.theme': persisted['settings.darkMode']
              ? 'dark'
              : 'light',
          };
        }
        return persisted;
      },
    }),
  ],
});
```

```tsx
// State is automatically restored on system start
function App() {
  return (
    <DirectiveProvider system={system}>
      <ThemeWrapper />
    </DirectiveProvider>
  );
}

function ThemeWrapper() {
  // This reads the persisted theme – no manual localStorage.getItem needed
  const theme = useDerived(system, 'settings::theme');

  return <div data-theme={theme}><Router /></div>;
}
```

## Step by Step

1. **`include` filters what's persisted** – only the listed fact paths are serialized. This keeps storage small and avoids persisting transient state like loading flags or connection status.

2. **`debounce` batches writes** – rapid fact changes (e.g., dragging a slider) only write to storage once every 500ms, preventing performance issues from synchronous localStorage writes.

3. **`version` + `migrate` handle schema changes** – when you change your schema between releases, the `migrate` function transforms the old persisted data to match the new shape. Without this, stale data crashes on deserialize.

4. **Automatic restore on start** – when the system starts, the persistence plugin reads from storage, applies migrations, and sets the initial facts. This happens before the first render, so there's no flash of default state.

## Common Variations

### SessionStorage for tab-scoped state

```typescript
persistencePlugin({
  storage: sessionStorage, // Dies with the tab
  key: 'directive-session',
  include: ['wizard.currentStep', 'wizard.formData'],
}),
```

### Custom async storage (IndexedDB, AsyncStorage)

```typescript
persistencePlugin({
  storage: {
    async getItem(key: string) {
      return idb.get(key);
    },
    async setItem(key: string, value: string) {
      await idb.set(key, value);
    },
    async removeItem(key: string) {
      await idb.delete(key);
    },
  },
  key: 'directive-idb',
  include: ['editor.document', 'editor.history'],
}),
```

### Coordinate with SSR hydration

```typescript
const system = createSystem({
  modules: { settings: settingsModule },
  plugins: [
    persistencePlugin({
      storage: localStorage,
      key: 'directive-state',
      include: ['settings::theme'],
      // Don't restore during SSR – let hydration handle it
      enabled: typeof window !== 'undefined',
    }),
  ],
  // SSR provides initial state via hydration
  initialFacts: typeof window !== 'undefined'
    ? undefined
    : serverProvidedState,
});
```

## Related

- [Plugin Overview](/docs/plugins/overview) – plugin lifecycle hooks
- [Persistence Plugin](/docs/plugins/persistence) – full API reference
- [SSR & Hydration](/docs/advanced/ssr) – server rendering patterns
- [Time-Travel & Snapshots](/docs/advanced/time-travel) – manual state serialization
