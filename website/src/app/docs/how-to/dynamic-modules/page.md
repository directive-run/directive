---
title: How to Dynamically Add Modules at Runtime
description: Code-split features with lazy loading and runtime module registration in Directive.
---

Code-split features with lazy loading and `registerModule` for on-demand module registration. {% .lead %}

---

## The Problem

Large apps have features that most users never visit – admin panels, analytics dashboards, advanced settings. Bundling every module upfront increases initial load time. You want to load modules on demand when the user navigates to a feature, but the system needs to handle the new module's constraints and resolvers seamlessly, including cross-module dependencies with already-loaded modules.

## The Solution

```typescript
// system.ts – start with core modules only
import { createSystem } from '@directive-run/core';
import { authModule } from './modules/auth';
import { uiModule } from './modules/ui';

export const system = createSystem({
  modules: {
    auth: authModule,
    ui: uiModule,
  },
});
```

```typescript
// modules/admin/index.ts – lazy-loaded module
import { createModule, t } from '@directive-run/core';

export const adminModule = createModule('admin', {
  schema: {
    users: t.array<{ id: string; name: string; role: string }>(),
    auditLog: t.array<{ action: string; timestamp: number }>(),
  },

  init: (facts) => {
    facts.users = [];
    facts.auditLog = [];
  },

  constraints: {
    loadUsers: {
      crossModuleDeps: ['auth.isAuthenticated'],
      when: (facts, derive, cross) =>
        cross.auth.isAuthenticated && facts.users.length === 0,
      require: { type: 'FETCH_ADMIN_USERS' },
    },
  },

  resolvers: {
    fetchUsers: {
      requirement: 'FETCH_ADMIN_USERS',
      resolve: async (req, context) => {
        const res = await fetch('/api/admin/users');
        context.facts.users = await res.json();
      },
    },
  },
});
```

```tsx
// Route-based lazy loading
import { lazy, Suspense } from 'react';

const AdminPanel = lazy(async () => {
  // Dynamic import loads the module and the component together
  const [{ adminModule }, { AdminPanelView }] = await Promise.all([
    import('./modules/admin'),
    import('./views/AdminPanel'),
  ]);

  // Register the module at runtime
  system.registerModule('admin', adminModule);

  return { default: AdminPanelView };
});

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<PageSkeleton />}>
            <AdminPanel system={system} />
          </Suspense>
        }
      />
    </Routes>
  );
}
```

## Step by Step

1. **Start with core modules** – the initial `createSystem` call only includes modules needed for the first render (auth, UI, etc.). This keeps the main bundle small.

2. **Define lazy modules normally** – `adminModule` uses the same `createModule` API, including `crossModuleDeps` that reference core modules. No special syntax needed.

3. **`system.registerModule()` adds the module at runtime** – this integrates the module's schema, constraints, resolvers, and effects into the running system. Cross-module dependencies are wired up automatically.

4. **React lazy + Suspense handles the loading UX** – the module code is fetched on navigation, registered, and the component renders once everything is ready.

## Common Variations

### Guard against double registration

```typescript
const AdminPanel = lazy(async () => {
  const { adminModule } = await import('./modules/admin');
  const { AdminPanelView } = await import('./views/AdminPanel');

  // Only register if not already loaded
  if (!system.hasModule('admin')) {
    system.registerModule('admin', adminModule);
  }

  return { default: AdminPanelView };
});
```

### Preload on hover

```tsx
function NavLink({ to, children, preloadModule }) {
  const handleMouseEnter = () => {
    // Start loading the module before the user clicks
    preloadModule();
  };

  return (
    <Link to={to} onMouseEnter={handleMouseEnter}>
      {children}
    </Link>
  );
}

// Usage
const preloadAdmin = () => import('./modules/admin');
<NavLink to="/admin" preloadModule={preloadAdmin}>Admin</NavLink>
```

### Unregister on route leave

```typescript
// In a route cleanup effect
useEffect(() => {
  return () => {
    // Optional: unregister to free memory
    system.unregisterModule('admin');
  };
}, []);
```

## Related

- [Module & System](/docs/module-system) – `registerModule` API
- [Organize Modules](/docs/how-to/organize-modules) – module structure patterns
- [Multi-Module](/docs/advanced/multi-module) – composition and namespacing
- [SSR & Hydration](/docs/advanced/ssr) – server-side module setup
