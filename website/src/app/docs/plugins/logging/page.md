---
title: Logging Plugin
description: Log state changes, events, and resolver activity in Directive systems.
---

The logging plugin provides detailed logs for debugging. {% .lead %}

---

## Basic Usage

```typescript
import { loggingPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin()],
});
```

---

## Configuration

```typescript
loggingPlugin({
  // What to log
  facts: true,         // Log fact changes
  derivations: true,   // Log derivation updates
  events: true,        // Log dispatched events
  requirements: true,  // Log raised requirements
  resolvers: true,     // Log resolver execution

  // Formatting
  collapsed: true,     // Collapse log groups
  timestamp: true,     // Include timestamps
  diff: true,          // Show before/after diff

  // Filtering
  filter: (type, data) => {
    // Only log user-related changes
    return data.key?.startsWith('user');
  },
})
```

---

## Log Levels

```typescript
loggingPlugin({
  level: 'debug',  // Options: debug, info, warn, error
})
```

---

## Custom Logger

Use your own logging implementation:

```typescript
loggingPlugin({
  logger: {
    log: (...args) => myLogger.info(...args),
    group: (label) => myLogger.group(label),
    groupEnd: () => myLogger.groupEnd(),
  },
})
```

---

## Production

Disable in production:

```typescript
const plugins = [];

if (process.env.NODE_ENV !== 'production') {
  plugins.push(loggingPlugin());
}
```

---

## Example Output

```text
[Directive] fact:count 0 to 1
[Directive] derivation:doubled 0 to 2
[Directive] requirement FETCH_USER { userId: 123 }
[Directive] resolver:fetchUser started
[Directive] resolver:fetchUser completed (45ms)
[Directive] event USER_LOADED { user: {...} }
```

---

## Next Steps

- See DevTools for browser integration
- See Plugin Overview for all plugins
- See Testing for test logging
