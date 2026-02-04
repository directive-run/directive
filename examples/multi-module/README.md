# Multi-Module Example

Demonstrates the **new namespaced module syntax** for Directive systems.

## Namespaced vs Flat Mode

Directive supports two modes for multi-module systems:

### Namespaced Mode (Object) - NEW!

```typescript
// Pass modules as an OBJECT → namespaced access
const system = createSystem({
  modules: {
    auth: authModule,
    data: dataModule,
    ui: uiModule,
  },
});

// Access facts via namespace
system.facts.auth.token          // string | null
system.facts.data.users          // User[]
system.derive.auth.status        // "authenticated" | "guest"

// Events via namespace
system.events.auth.login({ token: "abc" });
system.events.data.refresh();
```

### Flat Mode (Array) - Existing Behavior

```typescript
// Pass modules as an ARRAY → flat access
const system = createSystem({
  modules: [authModule, dataModule],
});

// Access with manual prefixes
system.facts.auth_token          // requires auth_token in schema
system.dispatch({ type: "auth_login", token: "abc" });
```

## Cross-Module Constraints

In constraints, `facts` gives you access to ALL modules:

```typescript
// data.ts - constraint that reads auth state
constraints: {
  fetchWhenAuthenticated: {
    when: (facts) => {
      // Cross-module access - no asCombined() needed!
      return facts.auth.isAuthenticated && facts.data.users.length === 0;
    },
    require: { type: "FETCH_USERS" },
  },
},
```

## What Gets Namespaced

| Element | Namespaced | Access Pattern |
|---------|------------|----------------|
| Facts | ✅ Yes | `facts.auth.token` |
| Derivations | ✅ Yes | `derive.auth.status` |
| Events | ✅ Yes | `events.auth.login()` |
| Requirements | ❌ No | `{ type: "VALIDATE_TOKEN" }` |

Requirements stay module-scoped - resolvers are still owned by their module.

## Module Definition

With namespaced mode, modules use **clean names** without prefixes:

```typescript
// modules/auth.ts
const authSchema = {
  facts: {
    token: t.string().nullable(),      // NOT auth_token
    isAuthenticated: t.boolean(),       // NOT auth_isAuthenticated
  },
  derivations: {
    status: t.string<"authenticated" | "guest">(),
  },
  events: {
    login: { token: t.string() },       // NOT auth_login
    logout: {},
  },
  requirements: {
    VALIDATE_TOKEN: { token: t.string() },
  },
};

export const authModule = createModule("auth", {
  schema: authSchema,
  init: (facts) => {
    facts.token = null;              // Clean access!
    facts.isAuthenticated = false;
  },
  // ...
});
```

## Data Flow

```
User clicks Login
       │
       ▼
┌──────────────────────────────────────┐
│ 1. events.auth.login({ token })      │
│    → sets facts.auth.token           │
│    → sets facts.auth.isValidating    │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 2. validateToken constraint active   │
│    → triggers VALIDATE_TOKEN         │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 3. validateToken resolver runs       │
│    → API call (simulated)            │
│    → sets facts.auth.isAuthenticated │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 4. fetchUsersWhenAuthenticated       │
│    constraint NOW ACTIVE!            │
│    (reads facts.auth.isAuthenticated)│
│    → triggers FETCH_USERS            │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 5. fetchUsers resolver runs          │
│    → API call (simulated)            │
│    → sets facts.data.users           │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 6. UI effects run                    │
│    (reads facts.auth, facts.data)    │
│    → logs state changes              │
└──────────────────────────────────────┘
```

## Running the Example

```bash
# From the examples/multi-module directory
pnpm install
pnpm dev
```

Then open http://localhost:5173 in your browser.

## Files

```
src/
├── modules/
│   ├── auth.ts     # Authentication: login, logout, token validation
│   ├── data.ts     # Data fetching with cross-module constraint
│   └── ui.ts       # UI state with cross-module effects
├── types.ts        # Shared entity types (no asCombined needed!)
├── system.ts       # Combines modules using object syntax
└── main.ts         # Entry point with namespaced access
```

## Migration from Flat Mode

If migrating from flat (array) mode:

| Before (Flat) | After (Namespaced) |
|---------------|-------------------|
| `auth_token` in schema | `token` in schema |
| `system.facts.auth_token` | `system.facts.auth.token` |
| `dispatch({ type: "auth_login" })` | `events.auth.login()` |
| `asCombined(facts).auth_isAuthenticated` | `facts.auth.isAuthenticated` |

## Why This Architecture?

- **No manual prefixes**: Schema uses clean names, namespacing is automatic
- **Type-safe cross-module**: Constraints can read any module's facts
- **Clean API**: `events.auth.login()` instead of `dispatch({ type: "auth_login" })`
- **Backwards compatible**: Array syntax still works for existing code
