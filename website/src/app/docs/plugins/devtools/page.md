---
title: DevTools Plugin
description: Debug Directive systems with browser DevTools integration.
---

Integrate Directive with browser DevTools for visual debugging. {% .lead %}

---

## Installation

```typescript
import { devtoolsPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});
```

---

## Features

- **State Inspector**: View all facts and derivations
- **Event Timeline**: See all dispatched events
- **Requirement Tracker**: Monitor active constraints
- **Time-Travel**: Jump to previous states
- **Diff View**: Compare state changes

---

## Configuration

```typescript
devtoolsPlugin({
  name: 'MyApp',           // Display name in DevTools
  maxHistory: 100,         // State history limit
  trace: true,             // Enable stack traces
  features: {
    jump: true,            // Allow time-travel
    skip: true,            // Allow skipping actions
    persist: true,         // Persist across page reloads
  },
})
```

---

## Redux DevTools

Works with Redux DevTools extension:

```typescript
devtoolsPlugin({
  // Uses Redux DevTools if available
  useReduxDevTools: true,
})
```

---

## Custom Panel

Access DevTools data programmatically:

```typescript
const devtools = devtoolsPlugin({
  expose: true,
});

// Access via window for debugging
window.__DIRECTIVE_DEVTOOLS__ = devtools;
```

---

## Production

Disable in production for security:

```typescript
const plugins = [];

if (process.env.NODE_ENV === 'development') {
  plugins.push(devtoolsPlugin());
}
```

---

## Next Steps

- See Logging for console output
- See Time-Travel for debugging
- See Plugin Overview for all plugins
