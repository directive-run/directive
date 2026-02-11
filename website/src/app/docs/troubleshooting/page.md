---
title: Troubleshooting
description: Common errors and solutions when using Directive.
---

Solutions to common problems you might encounter when using Directive. {% .lead %}

---

## Constraint Issues

### Constraint never fires

**Symptoms**: Your constraint's `when` condition seems true, but the resolver never runs.

**Causes and solutions**:

1. **Check the condition logic**:
```typescript
constraints: {
  needsUser: {
    when: (facts) => {
      // Temporarily log to see why the constraint isn't activating
      const result = facts.userId > 0 && !facts.user;
      console.log('needsUser condition:', result, {
        userId: facts.userId,
        user: facts.user,
      });
      return result;
    },
    require: { type: "FETCH_USER" },
  },
},
```

2. **Check priority conflicts**:
```typescript
constraints: {
  critical: {
    priority: 100,  // Higher number = evaluated first
    when: (facts) => true,
    require: { type: "CRITICAL_ACTION" },
  },

  normal: {
    priority: 50,  // Lower priority – may be blocked by the critical constraint
    when: (facts) => true,
    require: { type: "NORMAL_ACTION" },
  },
},
```

3. **Requirement already resolved**:
```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",

    // A unique key per payload ensures each request runs independently
    key: (req) => `fetch-${req.payload?.id}`,

    resolve: async (req, context) => { /* ... */ },
  },
},
```

### Constraint fires repeatedly (infinite loop)

**Symptoms**: Resolver runs continuously, console fills with logs, browser freezes.

**Cause**: The resolver changes facts in a way that makes the constraint true again.

**Solution**: Update facts to break the condition:

```typescript
// BAD: constraint keeps firing because shouldLoad is never cleared
constraints: {
  loadData: {
    when: (facts) => facts.shouldLoad,
    require: { type: "LOAD_DATA" },
  },
},
resolvers: {
  loadData: {
    requirement: "LOAD_DATA",
    resolve: async (req, context) => {
      const data = await fetchData();
      context.facts.data = data;
      // Forgot to set shouldLoad = false – infinite loop!
    },
  },
},

// GOOD: clear the flag first to break the constraint cycle
resolvers: {
  loadData: {
    requirement: "LOAD_DATA",
    resolve: async (req, context) => {
      context.facts.shouldLoad = false;  // Disarm the constraint immediately
      const data = await fetchData();
      context.facts.data = data;
    },
  },
},
```

---

## Resolver Issues

### Resolver throws but error isn't caught

**Symptoms**: Unhandled promise rejection, app crashes.

**Solution**: Add error handling in your resolver or use the error boundary:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    retry: { attempts: 3, backoff: "exponential" },  // Retry up to 3 times

    resolve: async (req, context) => {
      try {
        context.facts.user = await api.getUser(context.facts.userId);
      } catch (error) {
        // Store the error in facts so the UI can display it
        context.facts.error = error instanceof Error ? error.message : 'Unknown error';
        // Don't re-throw – swallowing the error marks it as handled
      }
    },
  },
},
```

Or use the error boundary configuration:

```typescript
// Centralized error handling – catches errors from any resolver or constraint
const system = createSystem({
  module: myModule,
  errorBoundary: {
    onResolverError: (error, resolver) => {
      console.error('Resolver error:', error, resolver);
    },

    onConstraintError: (error, constraint) => {
      console.error('Constraint error:', error, constraint);
    },

    // Catch-all for anything else
    onError: (error) => {
      console.error('System error:', error);
    },
  },
});
```

### Resolver runs but facts don't update

**Symptoms**: Resolver completes, but `system.facts` shows old values.

**Causes**:

1. **Not using context.facts**:
```typescript
// BAD: mutating a local variable has no effect on the store
resolve: async (req, context) => {
  const facts = context.facts;
  facts.user = await api.getUser(); // This works – writing through the proxy

  const user = await api.getUser();
  user.name = "John"; // This does NOT update facts – it's a detached object
},

// GOOD: always assign through context.facts to trigger reactivity
resolve: async (req, context) => {
  context.facts.user = await api.getUser();
},
```

2. **Mutating nested objects**:
```typescript
// BAD: nested mutation bypasses the proxy – no listeners fire
context.facts.user.name = "John";

// GOOD: replace the entire object so the proxy detects the change
context.facts.user = { ...context.facts.user, name: "John" };
```

### Resolver timeout

**Symptoms**: Error "Resolver timed out after Xms"

**Solution**: Increase timeout or optimize the operation:

```typescript
resolvers: {
  fetchLargeData: {
    requirement: "FETCH_LARGE_DATA",
    timeout: 30000,  // Extend from the default to allow 30 seconds

    resolve: async (req, context) => {
      // Long-running operation
    },
  },
},
```

---

## Derivation Issues

### Derivation returns stale value

**Symptoms**: Derivation doesn't update when facts change.

**Cause**: Derivation isn't reading from facts correctly.

```typescript
// BAD: closes over a constant – never recomputes when state changes
const userId = 123;
derive: {
  userDisplay: () => `User ${userId}`,  // Always shows "User 123"
},

// GOOD: read from facts so the derivation tracks the dependency
derive: {
  userDisplay: (facts) => `User ${facts.userId}`,
},
```

### Derivation causes infinite loop

**Symptoms**: Maximum call stack exceeded, browser freezes.

**Cause**: Derivation A depends on B, B depends on A.

```typescript
// BAD: a reads b, and b reads a – stack overflow
derive: {
  a: (facts, derive) => derive.b + 1,
  b: (facts, derive) => derive.a + 1,  // Circular!
},

// GOOD: root at least one derivation in facts to break the cycle
derive: {
  a: (facts) => facts.value + 1,
  b: (facts, derive) => derive.a + 1,
},
```

---

## React Issues

### "Cannot read properties of undefined"

**Symptoms**: Error when using `useFact()` or `useDerived()`.

**Cause**: The system reference passed to the hook is undefined or not yet created.

```tsx
// BAD: passing undefined instead of a system crashes at runtime
function UserProfile() {
  const name = useFact(undefined, "name");  // Error!
}

// GOOD: import and pass a valid system reference
import { system } from './system';

function UserProfile() {
  const name = useFact(system, "name");
}
```

### Component doesn't re-render

**Symptoms**: Facts change but UI stays the same.

**Causes**:

1. **Subscribing too broadly**:
```tsx
// BAD: any change to the user object triggers a re-render
const user = useFact(system, "user");

// GOOD: selector narrows the subscription to just the name property
const userName = useFact(system, "user", (u) => u?.name);
```

2. **Reading from stale closure**:
```tsx
// BAD: empty deps array captures the initial count forever
useEffect(() => {
  const interval = setInterval(() => {
    console.log(count); // Always logs the initial value
  }, 1000);
  return () => clearInterval(interval);
}, []);

// GOOD: let the hook manage the subscription – always fresh
const count = useFact(system, "count");
```

---

## TypeScript Issues

### Type not assignable to parameter

**Symptoms**: TypeScript error when setting facts.

```typescript
// TypeScript catches the mismatch at compile time
context.facts.userId = "123";  // Error: Type 'string' is not assignable to type 'number'

// Fix: assign the correct type directly
context.facts.userId = 123;

// Or parse the string into a number first
context.facts.userId = parseInt(userId, 10);
```

### Property does not exist on type

**Symptoms**: TypeScript error accessing fact or derivation.

**Cause**: Typo or missing schema definition.

```typescript
// The schema defines the exact property names TypeScript will enforce
schema: {
  facts: {
    userId: t.number(),  // camelCase – this is the canonical name
  },
},

// Access must match the schema key exactly
context.facts.userId   // Correct
context.facts.user_id  // Error: property does not exist
```

---

## Build Issues

### Module not found

**Symptoms**: Build error "Cannot find module 'directive'"

**Solution**: Install the package:

```bash
npm install directive
# or
pnpm add directive
# or
yarn add directive
```

### Tree-shaking not working

**Symptoms**: Bundle includes unused code.

**Solution**: Ensure you're importing from subpaths:

```typescript
// Import from subpaths so the bundler can tree-shake unused exports
import { createModule, createSystem } from 'directive';
import { loggingPlugin } from 'directive/plugins';
import { useFact } from 'directive/react';
```

---

## Still Stuck?

1. **Enable debug mode**:
```typescript
// Time-travel mode records every state transition for inspection
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true },
});
```

2. **Use the DevTools plugin**:
```typescript
import { devtoolsPlugin } from 'directive/plugins';

// DevTools shows live constraint evaluations, resolver activity, and facts
const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});
```

3. **Check the FAQ** at [/docs/faq](/docs/faq)

4. **Ask for help**:
   - [GitHub Discussions](https://github.com/sizls/directive/discussions)
   - [Discord](https://discord.gg/directive)
