---
title: How to Build an Auth Flow with Token Refresh
description: Implement login, logout, session validation, and automatic token refresh with Directive.
---

Login, logout, session validation, and automatic token refresh — all declarative. {% .lead %}

---

## The Problem

Authentication touches everything: login forms, token storage, automatic refresh before expiry, protected route gating, and logout cleanup. Imperative approaches scatter auth logic across interceptors, timers, and route guards. When token refresh races with API calls, or logout doesn't clean up properly, users see flashes of protected content or silent failures.

## The Solution

```typescript
import { createModule, t } from 'directive';

const auth = createModule('auth', {
  schema: {
    token: t.string().optional(),
    refreshToken: t.string().optional(),
    expiresAt: t.number(),
    user: t.object<{ id: string; role: string }>().optional(),
    status: t.string<'idle' | 'authenticating' | 'authenticated' | 'expired'>(),
  },

  init: (facts) => {
    facts.token = undefined;
    facts.refreshToken = undefined;
    facts.expiresAt = 0;
    facts.user = undefined;
    facts.status = 'idle';
  },

  derive: {
    isAuthenticated: (facts) => facts.status === 'authenticated',
    isExpiringSoon: (facts) => {
      if (!facts.expiresAt) return false;
      return Date.now() > facts.expiresAt - 60_000; // 1 min buffer
    },
    canRefresh: (facts) => !!facts.refreshToken,
  },

  constraints: {
    // Auto-refresh when token is about to expire
    refreshNeeded: {
      when: (facts, derive) => derive.isExpiringSoon && derive.canRefresh,
      require: (facts) => ({
        type: 'REFRESH_TOKEN',
        refreshToken: facts.refreshToken!,
      }),
    },
    // Fetch user profile after authentication
    needsUser: {
      after: ['refreshNeeded'],
      when: (facts) => !!facts.token && !facts.user,
      require: (facts) => ({
        type: 'FETCH_USER',
        token: facts.token!,
      }),
    },
  },

  resolvers: {
    login: {
      requirement: 'LOGIN',
      resolve: async (req, ctx) => {
        ctx.facts.status = 'authenticating';
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: req.email,
            password: req.password,
          }),
        });
        if (!res.ok) throw new Error('Login failed');
        const data = await res.json();
        ctx.facts.token = data.token;
        ctx.facts.refreshToken = data.refreshToken;
        ctx.facts.expiresAt = Date.now() + data.expiresIn * 1000;
        ctx.facts.status = 'authenticated';
      },
    },
    refreshToken: {
      requirement: 'REFRESH_TOKEN',
      retry: { attempts: 2, backoff: 'exponential' },
      resolve: async (req, ctx) => {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: req.refreshToken }),
        });
        if (!res.ok) {
          // Refresh failed — force logout
          ctx.facts.token = undefined;
          ctx.facts.refreshToken = undefined;
          ctx.facts.status = 'expired';
          return;
        }
        const data = await res.json();
        ctx.facts.token = data.token;
        ctx.facts.refreshToken = data.refreshToken;
        ctx.facts.expiresAt = Date.now() + data.expiresIn * 1000;
      },
    },
    fetchUser: {
      requirement: 'FETCH_USER',
      resolve: async (req, ctx) => {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${req.token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch user');
        ctx.facts.user = await res.json();
      },
    },
  },
});
```

```tsx
// Login form
function LoginForm({ system }) {
  const { facts } = useDirective(system);
  const loginStatus = useRequirementStatus(system, 'LOGIN');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    system.dispatch({
      type: 'LOGIN',
      email: form.get('email'),
      password: form.get('password'),
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button disabled={loginStatus.isPending}>
        {loginStatus.isPending ? 'Signing in...' : 'Sign in'}
      </button>
      {loginStatus.isRejected && (
        <p className="error">{loginStatus.error.message}</p>
      )}
    </form>
  );
}

// Protected route
function ProtectedRoute({ system, children }) {
  const { derived } = useDirective(system);
  if (!derived.isAuthenticated) return <Navigate to="/login" />;
  return children;
}
```

## Step by Step

1. **`refreshNeeded` constraint** watches `isExpiringSoon` — when the token is within 60 seconds of expiry and a refresh token exists, it emits `REFRESH_TOKEN`. No timers needed.

2. **`needsUser` uses `after`** — it only evaluates after `refreshNeeded` is settled, ensuring the user profile is fetched with a fresh token.

3. **Resolver handles failure gracefully** — if refresh fails, the resolver clears tokens and sets status to `expired` rather than throwing, so the UI can redirect to login.

4. **`system.dispatch` triggers login** — the login form dispatches a `LOGIN` requirement directly, and `useRequirementStatus` tracks it through pending → fulfilled/rejected.

## Common Variations

### Logout with cleanup

```typescript
// Add to the auth module's effects
effects: {
  clearOnLogout: {
    deps: ['status'],
    run: (facts) => {
      if (facts.status === 'idle') {
        localStorage.removeItem('auth_token');
      }
    },
  },
},

// Logout action
function logout(system) {
  system.batch(() => {
    system.facts.token = undefined;
    system.facts.refreshToken = undefined;
    system.facts.user = undefined;
    system.facts.expiresAt = 0;
    system.facts.status = 'idle';
  });
}
```

### Cross-module protected constraints

```typescript
// In another module, gate on auth
const cart = createModule('cart', {
  constraints: {
    checkout: {
      crossModuleDeps: ['auth.isAuthenticated'],
      when: (facts, derive, cross) => cross.auth.isAuthenticated && facts.items.length > 0,
      require: { type: 'CHECKOUT' },
    },
  },
});
```

## Related

- [Constraints](/docs/constraints) — `after`, priority, and cross-module deps
- [Resolvers](/docs/resolvers) — retry policies
- [Multi-Module](/docs/advanced/multi-module) — cross-module composition
- [Loading & Error States](/docs/how-to/loading-states) — status tracking patterns
