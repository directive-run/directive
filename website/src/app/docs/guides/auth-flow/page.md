---
title: How to Build an Auth Flow with Token Refresh
description: Implement login, logout, session validation, and automatic token refresh with Directive.
---

Login, logout, session validation, and automatic token refresh – all declarative. {% .lead %}

---

## The Problem

Authentication touches everything: login forms, token storage, automatic refresh before expiry, protected route gating, and logout cleanup. Imperative approaches scatter auth logic across interceptors, timers, and route guards. When token refresh races with API calls, or logout doesn't clean up properly, users see flashes of protected content or silent failures.

## The Solution

```typescript
import { createModule, t } from '@directive-run/core';

const auth = createModule('auth', {
  schema: {
    facts: {
      token: t.string().optional(),
      refreshToken: t.string().optional(),
      expiresAt: t.number(),
      user: t.object<{ id: string; role: string }>().optional(),
      status: t.string<'idle' | 'authenticating' | 'authenticated' | 'expired'>(),
      loginEmail: t.string().optional(),
      loginPassword: t.string().optional(),
    },
    derivations: {
      isAuthenticated: t.boolean(),
      isExpiringSoon: t.boolean(),
      canRefresh: t.boolean(),
    },
  },

  init: (facts) => {
    facts.token = undefined;
    facts.refreshToken = undefined;
    facts.expiresAt = 0;
    facts.user = undefined;
    facts.status = 'idle';
    facts.loginEmail = undefined;
    facts.loginPassword = undefined;
  },

  derive: {
    isAuthenticated: (facts) => facts.status === 'authenticated',
    isExpiringSoon: (facts) => {
      if (!facts.expiresAt) {
        return false;
      }

      return Date.now() > facts.expiresAt - 60_000; // 1 min buffer
    },
    canRefresh: (facts) => !!facts.refreshToken,
  },

  events: {
    requestLogin: (facts, { email, password }: { email: string; password: string }) => {
      facts.loginEmail = email;
      facts.loginPassword = password;
      facts.status = 'authenticating';
    },
  },

  constraints: {
    // Trigger login resolver when credentials are set
    loginRequested: {
      when: (facts) => facts.status === 'authenticating' && !!facts.loginEmail,
      require: (facts) => ({
        type: 'LOGIN',
        email: facts.loginEmail!,
        password: facts.loginPassword!,
      }),
    },
    // Auto-refresh when token is about to expire
    refreshNeeded: {
      when: (facts) => {
        const isExpiringSoon = !!facts.expiresAt && Date.now() > facts.expiresAt - 60_000;
        const canRefresh = !!facts.refreshToken;

        return isExpiringSoon && canRefresh;
      },
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
      resolve: async (req, context) => {
        context.facts.status = 'authenticating';
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: req.email,
            password: req.password,
          }),
        });
        if (!res.ok) {
          throw new Error('Login failed');
        }

        const data = await res.json();
        context.facts.token = data.token;
        context.facts.refreshToken = data.refreshToken;
        context.facts.expiresAt = Date.now() + data.expiresIn * 1000;
        context.facts.status = 'authenticated';
        context.facts.loginEmail = undefined;
        context.facts.loginPassword = undefined;
      },
    },
    refreshToken: {
      requirement: 'REFRESH_TOKEN',
      retry: { attempts: 2, backoff: 'exponential' },
      resolve: async (req, context) => {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: req.refreshToken }),
        });
        if (!res.ok) {
          // Refresh failed – force logout
          context.facts.token = undefined;
          context.facts.refreshToken = undefined;
          context.facts.status = 'expired';

          return;
        }
        const data = await res.json();
        context.facts.token = data.token;
        context.facts.refreshToken = data.refreshToken;
        context.facts.expiresAt = Date.now() + data.expiresIn * 1000;
      },
    },
    fetchUser: {
      requirement: 'FETCH_USER',
      resolve: async (req, context) => {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${req.token}` },
        });
        if (!res.ok) {
          throw new Error('Failed to fetch user');
        }

        context.facts.user = await res.json();
      },
    },
  },
});
```

```tsx
// Login form
function LoginForm({ system }) {
  const status = useSelector(system, (facts) => facts.status);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    system.events.auth.requestLogin({
      email: form.get('email') as string,
      password: form.get('password') as string,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button disabled={status === 'authenticating'}>
        {status === 'authenticating' ? 'Signing in...' : 'Sign in'}
      </button>
      {status === 'idle' && (
        <p className="error">Login failed. Please try again.</p>
      )}
    </form>
  );
}

// Protected route
function ProtectedRoute({ system, children }) {
  const { derived } = useDirective(system);
  if (!derived.isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return children;
}
```

## Step by Step

1. **`refreshNeeded` constraint** watches `isExpiringSoon` – when the token is within 60 seconds of expiry and a refresh token exists, it emits `REFRESH_TOKEN`. No timers needed.

2. **`needsUser` uses `after`** – it only evaluates after `refreshNeeded` is settled, ensuring the user profile is fetched with a fresh token.

3. **Resolver handles failure gracefully** – if refresh fails, the resolver clears tokens and sets status to `expired` rather than throwing, so the UI can redirect to login.

4. **`system.events.auth.requestLogin` triggers login** – the login form calls an event that sets `loginEmail` and `loginPassword` facts, which activates the `loginRequested` constraint. The `useSelector` hook tracks `status` to show loading and error states.

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
const authSchema = {
  facts: {
    token: t.string().optional(),
    status: t.string<'idle' | 'authenticating' | 'authenticated' | 'expired'>(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
  },
};

const cart = createModule('cart', {
  schema: {
    facts: {
      items: t.array<{ id: string; price: number }>(),
    },
  },
  crossModuleDeps: { auth: authSchema },

  constraints: {
    checkout: {
      when: (facts) => facts.auth.isAuthenticated && facts.self.items.length > 0,
      require: { type: 'CHECKOUT' },
    },
  },
});
```

## Related

- [Interactive Example](/docs/examples/auth-flow) – try it in your browser
- [Constraints](/docs/constraints) – `after`, priority, and cross-module deps
- [Resolvers](/docs/resolvers) – retry policies
- [Multi-Module](/docs/advanced/multi-module) – cross-module composition
- [Loading & Error States](/docs/guides/loading-states) – status tracking patterns
