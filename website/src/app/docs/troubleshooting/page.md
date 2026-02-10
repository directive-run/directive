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
// Debug: log the condition result
constraints: {
  needsUser: {
    when: (facts) => {
      const result = facts.userId > 0 && !facts.user;
      console.log('needsUser condition:', result, { userId: facts.userId, user: facts.user });
      return result;
    },
    require: { type: "FETCH_USER" },
  },
},
```

2. **Check priority conflicts**:
```typescript
// Higher priority constraints run first
constraints: {
  critical: {
    priority: 100,  // Runs first
    when: (facts) => true,
    require: { type: "CRITICAL_ACTION" },
  },
  normal: {
    priority: 50,  // May be blocked
    when: (facts) => true,
    require: { type: "NORMAL_ACTION" },
  },
},
```

3. **Requirement already resolved**:
```typescript
// Check if resolver is deduping
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    key: (req) => `fetch-${req.payload?.id}`, // Unique key prevents deduping
    resolve: async (req, context) => { /* ... */ },
  },
},
```

### Constraint fires repeatedly (infinite loop)

**Symptoms**: Resolver runs continuously, console fills with logs, browser freezes.

**Cause**: The resolver changes facts in a way that makes the constraint true again.

**Solution**: Update facts to break the condition:

```typescript
// Bad: constraint keeps firing
constraints: {
  loadData: {
    when: (facts) => facts.shouldLoad,  // Never becomes false
    require: { type: "LOAD_DATA" },
  },
},
resolvers: {
  loadData: {
    requirement: "LOAD_DATA",
    resolve: async (req, context) => {
      const data = await fetchData();
      context.facts.data = data;
      // Forgot to set shouldLoad = false!
    },
  },
},

// Good: break the condition
resolvers: {
  loadData: {
    requirement: "LOAD_DATA",
    resolve: async (req, context) => {
      context.facts.shouldLoad = false;  // Break the condition first
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
    retry: { attempts: 3, backoff: "exponential" },
    resolve: async (req, context) => {
      try {
        context.facts.user = await api.getUser(context.facts.userId);
      } catch (error) {
        context.facts.error = error instanceof Error ? error.message : 'Unknown error';
        // Don't re-throw - the error is handled
      }
    },
  },
},
```

Or use the error boundary configuration:

```typescript
const system = createSystem({
  module: myModule,
  errorBoundary: {
    onResolverError: (error, resolver) => {
      console.error('Resolver error:', error, resolver);
      // Report to error tracking service
    },
    onConstraintError: (error, constraint) => {
      console.error('Constraint error:', error, constraint);
    },
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
// Bad: modifying wrong object
resolve: async (req, context) => {
  const facts = context.facts;
  facts.user = await api.getUser(); // This works

  const user = await api.getUser();
  user.name = "John"; // This doesn't update facts!
},

// Good: assign to context.facts directly
resolve: async (req, context) => {
  context.facts.user = await api.getUser();
},
```

2. **Mutating nested objects**:
```typescript
// Bad: mutation isn't tracked
context.facts.user.name = "John";

// Good: replace the entire object
context.facts.user = { ...context.facts.user, name: "John" };
```

### Resolver timeout

**Symptoms**: Error "Resolver timed out after Xms"

**Solution**: Increase timeout or optimize the operation:

```typescript
resolvers: {
  fetchLargeData: {
    requirement: "FETCH_LARGE_DATA",
    timeout: 30000, // 30 seconds
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
// Bad: value captured at definition time
const userId = 123;
derive: {
  userDisplay: () => `User ${userId}`,  // Always shows "User 123"
},

// Good: read from facts
derive: {
  userDisplay: (facts) => `User ${facts.userId}`,
},
```

### Derivation causes infinite loop

**Symptoms**: Maximum call stack exceeded, browser freezes.

**Cause**: Derivation A depends on B, B depends on A.

```typescript
// Bad: circular dependency
derive: {
  a: (facts, derive) => derive.b + 1,
  b: (facts, derive) => derive.a + 1,  // Circular!
},

// Good: break the cycle
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
// Bad: system not created or not imported
function UserProfile() {
  const name = useFact(undefined, "name");  // Error!
}

// Good: pass a valid system reference
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
// Bad: subscribing to the whole user fact when you only need the name
const user = useFact(system, "user");

// Good: use useFact with a selector to select only what you need
const userName = useFact(system, "user", (u) => u?.name);
```

2. **Reading from stale closure**:
```tsx
// Bad: stale closure
useEffect(() => {
  const interval = setInterval(() => {
    console.log(count); // Always logs initial value
  }, 1000);
  return () => clearInterval(interval);
}, []);

// Good: read from facts via hook
const count = useFact(system, "count");
```

---

## TypeScript Issues

### Type not assignable to parameter

**Symptoms**: TypeScript error when setting facts.

```typescript
// Error: Type 'string' is not assignable to type 'number'
context.facts.userId = "123";

// Fix: use correct type
context.facts.userId = 123;
// Or parse the string
context.facts.userId = parseInt(userId, 10);
```

### Property does not exist on type

**Symptoms**: TypeScript error accessing fact or derivation.

**Cause**: Typo or missing schema definition.

```typescript
// Check your schema
schema: {
  facts: {
    userId: t.number(),  // Note: userId, not user_id
  },
},

// Access with correct name
context.facts.userId  // Correct
context.facts.user_id // Error: property does not exist
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
// Good: tree-shakeable imports
import { createModule, createSystem } from 'directive';
import { loggingPlugin } from 'directive/plugins';

// Also good
import { useFact } from 'directive/react';
```

---

## Still Stuck?

1. **Enable debug mode**:
```typescript
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true },  // Enables verbose logging
});
```

2. **Use the DevTools plugin**:
```typescript
import { devtoolsPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});
```

3. **Check the FAQ** at [/docs/faq](/docs/faq)

4. **Ask for help**:
   - [GitHub Discussions](https://github.com/sizls/directive/discussions)
   - [Discord](https://discord.gg/directive)
