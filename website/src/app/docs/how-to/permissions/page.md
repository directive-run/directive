---
title: How to Implement Role-Based Permissions
description: Build RBAC with derivation composition, dynamic constraint enable/disable, and cross-module permission gating.
---

Admin sees user management, editor can publish, viewer can only read — role-based UI gating with derivations, cross-module constraints, and dynamic `disable()`. {% .lead %}

---

## The Problem

The auth guide covers login/logout but not role-based access control. Real apps need: computed permissions from roles, UI elements that appear/disappear based on permissions, features gated by constraints that are disabled entirely for unauthorized users, and permission loading from an API. This is a natural constraint-satisfaction problem — "this feature requires admin permissions" is literally a constraint.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const auth = createModule('auth', {
  schema: {
    userId: t.string(),
    role: t.string<'admin' | 'editor' | 'viewer' | ''>(),
    token: t.string(),
  },

  init: (facts) => {
    facts.userId = '';
    facts.role = '';
    facts.token = '';
  },

  derive: {
    isAuthenticated: (facts) => facts.token !== '',
  },

  constraints: {
    validateSession: {
      when: (facts) => facts.token !== '' && facts.role === '',
      require: (facts) => ({
        type: 'VALIDATE_SESSION',
        token: facts.token,
      }),
    },
  },

  resolvers: {
    validateSession: {
      requirement: 'VALIDATE_SESSION',
      resolve: async (req, context) => {
        const res = await fetch('/api/auth/validate', {
          headers: { Authorization: `Bearer ${req.token}` },
        });
        const data = await res.json();
        context.facts.userId = data.userId;
        context.facts.role = data.role;
      },
    },
  },
});

const permissions = createModule('permissions', {
  schema: {
    permissions: t.object<string[]>(),
    loaded: t.boolean(),
  },

  init: (facts) => {
    facts.permissions = [];
    facts.loaded = false;
  },

  derive: {
    canEdit: (facts) => facts.permissions.includes('content.edit'),
    canPublish: (facts) => facts.permissions.includes('content.publish'),
    canManageUsers: (facts) => facts.permissions.includes('users.manage'),
    canViewAnalytics: (facts) => facts.permissions.includes('analytics.view'),
    // Composition: admin inherits all permissions
    isAdmin: (facts, derive) => {
      return derive.canManageUsers;
    },
  },

  constraints: {
    loadPermissions: {
      after: ['auth::validateSession'],
      crossModuleDeps: ['auth.role'],
      when: (facts) => facts.auth.role !== '' && !facts.loaded,
      require: (facts) => ({
        type: 'FETCH_PERMISSIONS',
        role: facts.auth.role,
      }),
    },
  },

  resolvers: {
    fetchPermissions: {
      requirement: 'FETCH_PERMISSIONS',
      resolve: async (req, context) => {
        const res = await fetch(`/api/permissions?role=${req.role}`);
        const data = await res.json();
        context.facts.permissions = data.permissions;
        context.facts.loaded = true;
      },
    },
  },
});

const content = createModule('content', {
  schema: {
    articles: t.object<Array<{ id: string; title: string; status: string }>>(),
    loaded: t.boolean(),
    publishRequested: t.string(),
  },

  init: (facts) => {
    facts.articles = [];
    facts.loaded = false;
    facts.publishRequested = '';
  },

  constraints: {
    loadContent: {
      after: ['permissions::loadPermissions'],
      crossModuleDeps: ['permissions.canEdit'],
      when: (facts) => !facts.loaded,
      require: { type: 'LOAD_CONTENT' },
    },
    publishArticle: {
      crossModuleDeps: ['permissions.canPublish'],
      when: (facts) => {
        return facts.publishRequested !== '' && facts.permissions.canPublish;
      },
      require: (facts) => ({
        type: 'PUBLISH_ARTICLE',
        articleId: facts.publishRequested,
      }),
    },
  },

  resolvers: {
    loadContent: {
      requirement: 'LOAD_CONTENT',
      resolve: async (req, context) => {
        const res = await fetch('/api/content');
        const data = await res.json();
        context.facts.articles = data.articles;
        context.facts.loaded = true;
      },
    },
    publishArticle: {
      requirement: 'PUBLISH_ARTICLE',
      resolve: async (req, context) => {
        await fetch(`/api/content/${req.articleId}/publish`, { method: 'POST' });
        context.facts.articles = context.facts.articles.map((a) =>
          a.id === req.articleId ? { ...a, status: 'published' } : a,
        );
        context.facts.publishRequested = '';
      },
    },
  },

  events: {
    requestPublish: (facts, { articleId }: { articleId: string }) => {
      facts.publishRequested = articleId;
    },
  },
});

const system = createSystem({
  modules: { auth, permissions, content },
});
```

```tsx
function ContentList({ system }) {
  const articles = useFact(system, 'content::articles');
  const canPublish = useDerived(system, 'permissions::canPublish');
  const canEdit = useDerived(system, 'permissions::canEdit');

  return (
    <ul>
      {articles.map((article) => (
        <li key={article.id}>
          <span>{article.title}</span>
          <span className="badge">{article.status}</span>
          {canEdit && <button>Edit</button>}
          {canPublish && article.status === 'draft' && (
            <button onClick={() => system.events.requestPublish({ articleId: article.id })}>
              Publish
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AdminPanel({ system }) {
  const canManageUsers = useDerived(system, 'permissions::canManageUsers');

  if (!canManageUsers) {
    return null;
  }

  return <UserManagement system={system} />;
}
```

## Step by Step

1. **Permission derivations** — `canEdit`, `canPublish`, `canManageUsers` are computed from the `permissions` array. Components read these derivations to conditionally render UI elements.

2. **Constraint ordering** — `loadPermissions` uses `after: ['auth::validateSession']` to wait for auth. `loadContent` uses `after: ['permissions::loadPermissions']` to wait for permissions. The chain: auth → permissions → content.

3. **Cross-module gating** — `publishArticle` checks `facts.permissions.canPublish` in its `when` clause. If the user doesn't have publish permission, the constraint never fires even if `publishRequested` is set.

4. **Dynamic constraint disable** — for more aggressive gating, use `system.constraints.disable('content::publishArticle')` when the user lacks permissions. This is more efficient than `when` returning false because it removes the constraint from evaluation entirely.

5. **Permission inheritance** — the `isAdmin` derivation composes other permission derivations. Admin UI checks `isAdmin` instead of individual permissions.

## Common Variations

### Dynamic permissions from API

```typescript
constraints: {
  refreshPermissions: {
    when: (facts) => facts.permissionsStale,
    require: { type: 'FETCH_PERMISSIONS' },
  },
},
```

### Feature gating with constraint disable

```typescript
// Disable entire feature modules based on permissions
effects: {
  gateFeatures: {
    deps: ['loaded'],
    run: (facts) => {
      // Constraint gating is handled by crossModuleDeps — constraints that
      // read permissions facts automatically skip when permissions are absent.
      // For explicit disable, call system.constraints.disable() from outside the effect.
    },
  },
},
```

### Permission inheritance hierarchy

```typescript
derive: {
  effectivePermissions: (facts) => {
    const rolePermissions = {
      admin: ['users.manage', 'content.publish', 'content.edit', 'analytics.view'],
      editor: ['content.publish', 'content.edit', 'analytics.view'],
      viewer: ['analytics.view'],
    };

    const base = rolePermissions[facts.role] || [];

    return [...new Set([...base, ...facts.permissions])];
  },
},
```

## Related

- [Interactive Example](/docs/examples/permissions) — try it in your browser
- [Authentication Flow](/docs/how-to/auth-flow) — login and session management
- [Async Chains](/docs/how-to/async-chains) — cross-module `after` patterns
- [Dynamic Modules](/docs/how-to/dynamic-modules) — loading modules conditionally
- [Constraints](/docs/constraints) — `disable()` and cross-module deps
