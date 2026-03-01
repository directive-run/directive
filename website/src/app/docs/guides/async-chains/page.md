---
title: How to Chain Async Operations Across Modules
description: Build cross-module async chains with after ordering, error propagation, and retry — auth to permissions to dashboard data.
---

Auth → permissions → feature flags → dashboard data. Cross-module `after` chains with error propagation, retry, and parallel branches. {% .lead %}

---

## The Problem

The auth guide shows a single-module chain. Real apps need cross-module chains: auth → permissions → feature flags → dashboard data. The `after` syntax for cross-module refs (`"auth::refreshNeeded"`) has zero worked examples. Understanding how errors propagate through chains, how to retry a single step, and when to use `after` vs `crossModuleDeps` requires seeing the pattern in action.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { loggingPlugin, devtoolsPlugin } from '@directive-run/core/plugins';

const auth = createModule('auth', {
  schema: {
    token: t.string(),
    status: t.string<'idle' | 'validating' | 'valid' | 'expired'>(),
  },

  init: (facts) => {
    facts.token = '';
    facts.status = 'idle';
  },

  derive: {
    isValid: (facts) => facts.status === 'valid',
  },

  constraints: {
    validateSession: {
      when: (facts) => facts.token !== '' && facts.status === 'idle',
      require: (facts) => ({
        type: 'VALIDATE_SESSION',
        token: facts.token,
      }),
    },
  },

  resolvers: {
    validateSession: {
      requirement: 'VALIDATE_SESSION',
      retry: { attempts: 2, backoff: 'exponential' },
      resolve: async (req, context) => {
        context.facts.status = 'validating';
        const res = await fetch('/api/auth/validate', {
          headers: { Authorization: `Bearer ${req.token}` },
        });

        if (!res.ok) {
          context.facts.status = 'expired';
          throw new Error('Session expired');
        }

        context.facts.status = 'valid';
      },
    },
  },
});

const permissions = createModule('permissions', {
  schema: {
    role: t.string(),
    permissions: t.object<string[]>(),
    loaded: t.boolean(),
  },

  init: (facts) => {
    facts.role = '';
    facts.permissions = [];
    facts.loaded = false;
  },

  derive: {
    canEdit: (facts) => facts.permissions.includes('edit'),
    canPublish: (facts) => facts.permissions.includes('publish'),
    canManageUsers: (facts) => facts.role === 'admin',
  },

  constraints: {
    loadPermissions: {
      after: ['auth::validateSession'],
      crossModuleDeps: ['auth.isValid'],
      when: (facts) => facts.auth.isValid && !facts.loaded,
      require: { type: 'LOAD_PERMISSIONS' },
    },
  },

  resolvers: {
    loadPermissions: {
      requirement: 'LOAD_PERMISSIONS',
      resolve: async (req, context) => {
        const res = await fetch('/api/permissions');
        const data = await res.json();
        context.facts.role = data.role;
        context.facts.permissions = data.permissions;
        context.facts.loaded = true;
      },
    },
  },
});

const dashboard = createModule('dashboard', {
  schema: {
    widgets: t.object<Array<{ id: string; type: string; data: unknown }>>(),
    loaded: t.boolean(),
  },

  init: (facts) => {
    facts.widgets = [];
    facts.loaded = false;
  },

  constraints: {
    loadDashboard: {
      after: ['permissions::loadPermissions'],
      crossModuleDeps: ['permissions.canEdit', 'permissions.role'],
      when: (facts) => facts.permissions.role !== '' && !facts.loaded,
      require: (facts) => ({
        type: 'LOAD_DASHBOARD',
        role: facts.permissions.role,
        canEdit: facts.permissions.canEdit,
      }),
    },
  },

  resolvers: {
    loadDashboard: {
      requirement: 'LOAD_DASHBOARD',
      resolve: async (req, context) => {
        const res = await fetch(`/api/dashboard?role=${req.role}`);
        const data = await res.json();
        context.facts.widgets = data.widgets;
        context.facts.loaded = true;
      },
    },
  },
});

const system = createSystem({
  modules: { auth, permissions, dashboard },
  plugins: [
    loggingPlugin(),
    devtoolsPlugin({ trace: true }),
  ],
});
```

```tsx
function App({ system }) {
  const authStatus = useFact(system, 'auth::status');
  const dashLoaded = useFact(system, 'dashboard::loaded');
  const widgets = useFact(system, 'dashboard::widgets');

  if (authStatus === 'validating') {
    return <Spinner label="Validating session..." />;
  }
  if (authStatus === 'expired') {
    return <LoginForm system={system} />;
  }
  if (!dashLoaded) {
    return <Spinner label="Loading dashboard..." />;
  }

  return (
    <div>
      {widgets.map((w) => (
        <Widget key={w.id} type={w.type} data={w.data} />
      ))}
    </div>
  );
}
```

## Step by Step

1. **`after` blocks constraint evaluation** — `loadPermissions` won't even evaluate its `when` until `auth::validateSession`'s resolver has settled (fulfilled or rejected). This is a hard dependency on completion, not just on a fact value.

2. **`crossModuleDeps` reads facts from other modules** — permissions reads `auth.isValid`, dashboard reads `permissions.role` and `permissions.canEdit`. These are tracked as dependencies so the constraint re-evaluates when they change.

3. **`after` vs `crossModuleDeps`** — `after` is about _ordering_ (wait for that constraint's resolver to finish). `crossModuleDeps` is about _data_ (read facts from other modules). You often use both together: wait for auth to finish (`after`), then check if it succeeded (`crossModuleDeps`).

4. **Error propagation** — if `validateSession` throws (after retries), it stays in rejected state. `loadPermissions` never evaluates because `auth.isValid` is false. `loadDashboard` is doubly blocked: its `after` dependency (`loadPermissions`) never ran.

5. **Retry a single step** — dispatching a new `VALIDATE_SESSION` requirement restarts only the auth step. If it succeeds, the chain resumes from where it left off — permissions and dashboard load automatically.

6. **`devtoolsPlugin({ trace: true })`** logs the full chain trace: which constraints are waiting on which `after` dependencies, and the timestamp of each resolver start/end.

## Common Variations

### Parallel branches after auth

```typescript
// Permissions and notifications load in parallel after auth
constraints: {
  loadPermissions: {
    after: ['auth::validateSession'],
    when: (facts) => facts.auth.isValid && !facts.loaded,
    require: { type: 'LOAD_PERMISSIONS' },
  },
},
// In a separate notifications module:
constraints: {
  loadNotifications: {
    after: ['auth::validateSession'],
    when: (facts) => facts.auth.isValid && !facts.loaded,
    require: { type: 'LOAD_NOTIFICATIONS' },
  },
},
```

Both fire simultaneously once auth settles — no need to serialize them.

### Chain timeout

```typescript
resolvers: {
  loadDashboard: {
    requirement: 'LOAD_DASHBOARD',
    timeout: 10000,
    resolve: async (req, context) => { /* ... */ },
  },
},
```

### Retry the entire chain

```typescript
events: {
  retryAll: (facts) => {
    facts.token = facts.token; // re-trigger validateSession
    // Reset downstream state
  },
},
```

## Related

- [Interactive Example](/docs/examples/async-chains) — try it in your browser
- [Constraints](/docs/constraints) — `after` and `crossModuleDeps` reference
- [Resolvers](/docs/resolvers) — retry policies and timeout
- [Multi-Module](/docs/advanced/multi-module) — module composition
- [Authentication Flow](/docs/guides/auth-flow) — single-module auth chain
