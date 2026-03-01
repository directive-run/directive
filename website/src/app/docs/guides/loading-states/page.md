---
title: How to Manage Loading & Error States
description: Track loading, error, and success states across concurrent async operations with Directive.
---

Track loading, error, and success across concurrent async operations – without manual state juggling. {% .lead %}

---

## The Problem

In a typical app, multiple async operations run concurrently – fetching a user profile, loading preferences, checking permissions. Each one needs loading, error, and success states. Managing these manually leads to a maze of boolean flags, race conditions when requests overlap, and UI flicker when states update out of sync.

## The Solution

```typescript
import { createModule, t } from '@directive-run/core';
import { useDirective, useRequirementStatus } from '@directive-run/react';

// Module with async data requirements
const dashboard = createModule('dashboard', {
  schema: {
    userId: t.string(),
    profile: t.object<{ name: string; avatar: string }>(),
    preferences: t.object<{ theme: string; locale: string }>(),
    error: t.string().optional(),
  },

  init: (facts) => {
    facts.userId = '';
    facts.profile = { name: '', avatar: '' };
    facts.preferences = { theme: 'light', locale: 'en' };
  },

  derive: {
    // Combine multiple facts into a single loading status
    isFullyLoaded: (facts) =>
      facts.profile.name !== '' && facts.preferences.theme !== '',
  },

  constraints: {
    needsProfile: {
      when: (facts) => facts.userId !== '' && facts.profile.name === '',
      require: (facts) => ({ type: 'FETCH_PROFILE', userId: facts.userId }),
    },
    needsPreferences: {
      when: (facts) => facts.userId !== '' && facts.preferences.theme === '',
      require: (facts) => ({
        type: 'FETCH_PREFERENCES',
        userId: facts.userId,
      }),
    },
  },

  resolvers: {
    fetchProfile: {
      requirement: 'FETCH_PROFILE',
      retry: { attempts: 3, backoff: 'exponential' },
      resolve: async (req, context) => {
        const res = await fetch(`/api/users/${req.userId}/profile`);
        if (!res.ok) {
          throw new Error('Failed to fetch profile');
        }

        context.facts.profile = await res.json();
      },
    },
    fetchPreferences: {
      requirement: 'FETCH_PREFERENCES',
      resolve: async (req, context) => {
        const res = await fetch(`/api/users/${req.userId}/preferences`);
        if (!res.ok) {
          throw new Error('Failed to fetch preferences');
        }

        context.facts.preferences = await res.json();
      },
    },
  },
});
```

```tsx
// React component using status hooks
function Dashboard({ system }) {
  const { facts, derived } = useDirective(system);
  const profileStatus = useRequirementStatus(system, 'FETCH_PROFILE');
  const prefsStatus = useRequirementStatus(system, 'FETCH_PREFERENCES');

  if (profileStatus.isPending || prefsStatus.isPending) {
    return <LoadingSkeleton />;
  }

  if (profileStatus.isRejected) {
    return <ErrorBanner message={profileStatus.error.message} />;
  }

  return (
    <div>
      <Avatar src={facts.profile.avatar} />
      <h1>{facts.profile.name}</h1>
      <ThemeProvider theme={facts.preferences.theme}>
        <DashboardContent />
      </ThemeProvider>
    </div>
  );
}
```

## Step by Step

1. **Constraints declare what's needed** – `needsProfile` fires when there's a `userId` but no profile data. The engine evaluates this automatically whenever facts change.

2. **Resolvers handle the async work** – `fetchProfile` runs when `FETCH_PROFILE` requirements appear. The `retry` config handles transient failures automatically.

3. **`useRequirementStatus` tracks each operation** – returns `{ isPending, isFulfilled, isRejected, error }` for any requirement type. Updates reactively as the resolver progresses.

4. **Derivations combine states** – `isFullyLoaded` gives you a single boolean for "everything is ready" without tracking individual operations.

## Common Variations

### Suspense integration

```tsx
// Throw a promise to integrate with React Suspense
import { useSuspenseRequirement } from '@directive-run/react';

function Profile({ system }) {
  // Suspends until FETCH_PROFILE resolves
  useSuspenseRequirement(system, 'FETCH_PROFILE');
  const { facts } = useDirective(system);

  return <h1>{facts.profile.name}</h1>;
}

// Wrap in Suspense boundary
<Suspense fallback={<Skeleton />}>
  <Profile system={system} />
</Suspense>
```

### Constraint-level status

```tsx
import { useConstraintStatus } from '@directive-run/react';

function StatusIndicator({ system }) {
  const status = useConstraintStatus(system, 'needsProfile');
  // status.isActive – constraint's `when` is true
  // status.requirementsPending – resolver is working
  // status.isSatisfied – requirements fulfilled
  return <Badge variant={status.isSatisfied ? 'success' : 'pending'} />;
}
```

## Related

- [Interactive Example](/docs/examples/dashboard-loader) – try it in your browser
- [Constraints](/docs/constraints) – how `when` and `require` work
- [Resolvers](/docs/resolvers) – retry policies and execution model
- [React Hooks](/docs/api/react) – full hook API reference
- [Error Handling](/docs/advanced/errors) – error boundaries and recovery strategies
