---
title: Plugin Overview
description: Extend Directive with plugins for logging, persistence, devtools, and custom functionality.
---

Plugins extend Directive systems with cross-cutting functionality. {% .lead %}

---

## Using Plugins

Add plugins when creating a system:

```typescript
import { createSystem } from 'directive';
import { loggingPlugin, devtoolsPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    loggingPlugin(),
    devtoolsPlugin(),
  ],
});
```

---

## Built-in Plugins

| Plugin | Purpose |
|--------|---------|
| `loggingPlugin` | Log state changes and events |
| `devtoolsPlugin` | Browser DevTools integration |
| `persistencePlugin` | Save/restore state |

---

## Plugin Order

Plugins execute in order. Put logging first to capture all events:

```typescript
plugins: [
  loggingPlugin(),        // Logs everything
  persistencePlugin(),    // Restores state
  devtoolsPlugin(),       // DevTools last
]
```

---

## Conditional Plugins

Enable plugins based on environment:

```typescript
const plugins = [
  persistencePlugin(),
];

if (process.env.NODE_ENV === 'development') {
  plugins.unshift(loggingPlugin());
  plugins.push(devtoolsPlugin());
}

const system = createSystem({
  module: myModule,
  plugins,
});
```

---

## Plugin Lifecycle

Plugins can hook into system lifecycle:

```typescript
const myPlugin = {
  name: 'my-plugin',
  onInit: (system) => { /* System created */ },
  onStart: (system) => { /* System started */ },
  onStop: (system) => { /* System stopped */ },
  onDispose: (system) => { /* System disposed */ },
};
```

---

## Next Steps

- See Logging for logging configuration
- See DevTools for browser integration
- See Persistence for state storage
- See Custom Plugins for building your own
