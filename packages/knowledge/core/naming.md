# Naming Conventions

Directive naming rules that AI coding assistants must follow. These are non-negotiable project conventions.

## Decision Tree: "What do I call this?"

```
Resolver parameter names?
  → (req, context)     req = requirement, NEVER "request"
  → NEVER (req, ctx)   context is NEVER abbreviated

Computed values?
  → "derivations" / derive   NEVER "computed", "selectors", "getters"
  → system.derive.myValue    NEVER system.computed.myValue

State values?
  → "facts"                  NEVER "state", "store", "atoms"
  → system.facts.count       NEVER system.state.count

Conditional triggers?
  → "constraints"            NEVER "rules", "conditions", "triggers"
  → when() + require()       NEVER if/then, trigger/action

Fulfillment logic?
  → "resolvers"              NEVER "handlers", "actions", "reducers"
  → resolve(req, context)    NEVER handle(req, ctx)
```

## Parameter Naming

### `req` = requirement (NOT request)

The `req` parameter in resolvers and constraint `key()` functions is short for **requirement** -- the object emitted by a constraint's `require` property.

```typescript
// CORRECT — req is a requirement
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    key: (req) => `fetch-${req.userId}`,
    resolve: async (req, context) => {
      // req.type === "FETCH_USER"
      // req.userId from the requirement payload
      const user = await fetchUser(req.userId);
      context.facts.user = user;
    },
  },
},

// WRONG — never use "request" or "r"
resolve: async (request, context) => { /* ... */ },
resolve: async (r, context) => { /* ... */ },
```

### `context` is Never Abbreviated

```typescript
// CORRECT
resolve: async (req, context) => {
  context.facts.status = "loaded";
  context.signal; // AbortSignal
  context.snapshot(); // facts snapshot
},

// WRONG — never abbreviate to ctx
resolve: async (req, ctx) => { /* ... */ },
```

## Return Style

### Always Use Braces

No single-line returns. Always wrap in braces.

```typescript
// WRONG
derive: {
  isReady: (facts) => facts.phase === "ready",
},

constraints: {
  check: {
    when: (facts) => facts.count > 10,
    require: { type: "PROCESS" },
  },
},

// Wait -- the above IS correct for one-line arrow expressions.
// The brace rule applies to if/return blocks:

// WRONG — single-line if return
if (facts.user) return "ready";

// CORRECT — always use braces
if (facts.user) {
  return "ready";
}
```

### Blank Line Before `return`

Add a blank line before `return` when there is code above it. Skip the blank line when `return` is the first statement in a block.

```typescript
// CORRECT — blank line before return when code precedes it
function getStatus(facts) {
  const phase = facts.phase;
  const hasUser = facts.user !== null;

  return phase === "ready" && hasUser;
}

// CORRECT — no blank line when return is first statement
function isReady(facts) {
  return facts.phase === "ready";
}

// CORRECT — blank line after brace-style return block
function process(facts) {
  if (!facts.ready) {
    return null;
  }

  const result = computeResult(facts);

  return result;
}

// WRONG — no blank line before return after code
function getStatus(facts) {
  const phase = facts.phase;
  return phase === "ready"; // Missing blank line
}
```

## Multi-Module Naming

### `facts.self.*` for Own Module

In multi-module systems, constraints, effects, and derivations with `crossModuleDeps` receive namespaced facts. Own module facts are always at `facts.self.*`.

```typescript
// CORRECT
constraints: {
  loadWhenAuth: {
    when: (facts) => facts.auth.isAuthenticated && !facts.self.loaded,
    require: { type: "LOAD_DATA" },
  },
},

// WRONG — bare facts.* in multi-module context
constraints: {
  loadWhenAuth: {
    when: (facts) => facts.isAuthenticated && !facts.loaded,
    require: { type: "LOAD_DATA" },
  },
},
```

### System-Level Access Uses Dot Notation

```typescript
// CORRECT — dot notation through namespace proxy
system.facts.auth.token;
system.facts.cart.items;
system.derive.auth.isLoggedIn;
system.events.auth.login({ token: "..." });

// WRONG — bracket notation with internal separator
system.facts["auth::token"];
system.facts["auth_token"];
```

## Type Casting Rules

### Never Cast When Reading

The schema provides all types. Do not add `as` casts when reading facts or derivations from the system.

```typescript
// CORRECT — schema provides the type
const profile = system.facts.profile;
const isReady = system.derive.isReady;

// WRONG — unnecessary cast
const profile = system.facts.profile as UserProfile;
const isReady = system.derive.isReady as boolean;
```

### Cast Only in Schema Definition

Type assertions are only valid in schema definition using the `{} as {}` pattern:

```typescript
// CORRECT — cast in schema definition
schema: {
  facts: {} as { profile: UserProfile; settings: AppSettings },
  derivations: {} as { displayName: string },
},

// OR use t.* builders (preferred)
schema: {
  facts: {
    profile: t.object<UserProfile>(),
    settings: t.object<AppSettings>(),
  },
  derivations: {
    displayName: t.string(),
  },
},
```

## Terminology Quick Reference

| Directive Term | NEVER Use |
|---|---|
| facts | state, store, atoms, signals |
| derivations / derive | computed, selectors, getters, memos |
| constraints | rules, conditions, triggers, guards |
| resolvers | handlers, actions, reducers, sagas |
| requirements | requests, commands, intents |
| effects | watchers, subscriptions, reactions |
| module | slice, feature, domain |
| system | store, container, context |
| `req` (parameter) | request, r, requirement (spelled out) |
| `context` (parameter) | ctx, c, resolverContext |
