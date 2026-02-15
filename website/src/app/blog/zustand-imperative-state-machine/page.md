---
title: Your Zustand Store Is Secretly an Imperative State Machine
description: Zustand starts simple. But as loading states, retry logic, and cross-store dependencies pile up, you end up maintaining an ad-hoc state machine without the guarantees. Here's how to spot the inflection point.
layout: blog
date: 2026-02-08
dateModified: 2026-02-08
slug: zustand-imperative-state-machine
author: directive-labs
categories: [Comparison, State Management]
---

Zustand deserves its reputation.

No providers. No boilerplate. No opinions about how you structure your state. You call `create`, pass a function, and you have a store. In a world where state management libraries competed on feature count, Zustand competed on simplicity &ndash; and won. It's the right tool for a lot of applications, and if it's working well for you today, nothing in this article is telling you to stop.

But there's a pattern that shows up in Zustand codebases around the six-month mark. It's subtle enough that you don't notice it happening, and by the time you do, it's load-bearing. The pattern: your Zustand store has become an imperative state machine &ndash; managing states, transitions, and side effects &ndash; without any of the guarantees that a formal state machine provides.

Let's look at how it happens.

---

## The clean version

Here's a Zustand store for fetching user data. This is the version you write on day one:

```typescript
import { create } from "zustand";

interface UserStore {
  userId: number | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  fetchUser: (id: number) => Promise<void>;
}

const useUserStore = create<UserStore>((set) => ({
  userId: null,
  user: null,
  loading: false,
  error: null,

  fetchUser: async (id) => {
    set({ userId: id, loading: true, error: null });
    try {
      const user = await api.getUser(id);
      set({ user, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },
}));
```

Clean. Readable. 20 lines of meaningful code. This is Zustand at its best &ndash; a thin, transparent wrapper around your state.

---

## Six months later

The product evolves. Now the user store needs to handle token refresh before fetching. It needs to retry failed requests with backoff. It fetches user preferences after the user loads. It coordinates with a separate permissions store. Error recovery depends on the error type.

Here's what that same store looks like:

```typescript
import { create } from "zustand";

interface UserStore {
  userId: number | null;
  user: User | null;
  preferences: UserPrefs | null;
  loading: boolean;
  loadingPrefs: boolean;
  error: string | null;
  retryCount: number;
  retryTimeoutId: number | null;
  lastFetchedId: number | null;
  fetchUser: (id: number) => Promise<void>;
  retryFetch: () => Promise<void>;
  reset: () => void;
}

const useUserStore = create<UserStore>((set, get) => ({
  userId: null,
  user: null,
  preferences: null,
  loading: false,
  loadingPrefs: false,
  error: null,
  retryCount: 0,
  retryTimeoutId: null,
  lastFetchedId: null,

  fetchUser: async (id) => {
    const { lastFetchedId, loading } = get();
    if (loading || id === lastFetchedId) {
      return;
    }

    set({
      userId: id,
      loading: true,
      error: null,
      retryCount: 0,
      user: null,
      preferences: null,
    });

    try {
      // Refresh token if needed
      const token = await authStore.getState().ensureValidToken();
      if (!token) {
        set({ loading: false, error: "Authentication required" });

        return;
      }

      const user = await api.getUser(id);
      set({ user, loading: false, lastFetchedId: id });

      // Now fetch preferences
      set({ loadingPrefs: true });
      try {
        const prefs = await api.getUserPrefs(id);
        set({ preferences: prefs, loadingPrefs: false });
      } catch {
        set({ loadingPrefs: false });
        // Swallow – prefs are non-critical
      }

      // Sync permissions
      permissionsStore.getState().loadPermissions(user.role);
    } catch (err) {
      const { retryCount } = get();
      if (err.status === 429 && retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000;
        const timeoutId = setTimeout(() => get().retryFetch(), delay);
        set({
          retryCount: retryCount + 1,
          retryTimeoutId: timeoutId,
          loading: false,
        });
      } else {
        set({ error: err.message, loading: false });
      }
    }
  },

  retryFetch: async () => {
    const { userId } = get();
    if (userId) {
      set({ retryTimeoutId: null });
      await get().fetchUser(userId);
    }
  },

  reset: () => {
    const { retryTimeoutId } = get();
    if (retryTimeoutId) clearTimeout(retryTimeoutId);
    set({
      userId: null,
      user: null,
      preferences: null,
      loading: false,
      loadingPrefs: false,
      error: null,
      retryCount: 0,
      retryTimeoutId: null,
      lastFetchedId: null,
    });
  },
}));
```

Nobody planned this. It grew organically, one requirement at a time. Each addition was reasonable in isolation. But step back and look at what you've built:

- **Boolean flags as states.** `loading`, `loadingPrefs`, `error` &ndash; these are encoding a state machine's states as independent booleans. Nothing prevents `loading: true` and `error: "failed"` from coexisting. Nothing prevents `loadingPrefs: true` when `user` is `null`.

- **Imperative sequencing as transitions.** The `fetchUser` method encodes a specific ordering: validate token, fetch user, fetch preferences, sync permissions. If you need to change the order or add a step, you're editing a deeply nested function and hoping the error handling still covers every branch.

- **Manual retry as recovery.** `retryCount`, `retryTimeoutId`, `setTimeout`, exponential backoff &ndash; all hand-built. Each store that needs retry rebuilds this from scratch, slightly differently every time.

You've built a state machine. It has states (the combination of boolean flags), transitions (the imperative code paths), and side effects (the API calls). But it has none of the guarantees: no enforcement of valid states, no protection against impossible transitions, no formal recovery strategy.

---

## Three failure modes

This pattern breaks in predictable ways. Here are the three most common.

### 1. Cross-store derived state

Your user store needs data from the auth store. The permissions store needs data from the user store. The UI needs a derived value that combines all three.

```typescript
// Zustand: manual cross-store subscriptions
const useAuthStore = create((set) => ({
  token: null,
  ensureValidToken: async () => {
    /* refresh logic */
  },
}));

const usePermissionsStore = create((set) => ({
  permissions: [],
  loadPermissions: async (role) => {
    const perms = await api.getPermissions(role);
    set({ permissions: perms });
  },
}));

// In your component – gluing stores together manually
function Dashboard() {
  const user = useUserStore((s) => s.user);
  const permissions = usePermissionsStore((s) => s.permissions);

  // Derived value computed on every render
  const canEdit = user?.role === "admin" || permissions.includes("edit");

  // Manual synchronization – when user changes, fetch permissions
  useEffect(() => {
    if (user?.role) {
      usePermissionsStore.getState().loadPermissions(user.role);
    }
  }, [user?.role]);

  return canEdit ? <Editor /> : <ReadOnly />;
}
```

The `useEffect` is doing constraint enforcement &ndash; "when the user's role is known, permissions must be loaded" &ndash; but it's buried in a component. If another component also needs permissions, it either duplicates the effect or relies on Dashboard mounting first. The derived value `canEdit` recalculates on every render because there's no caching layer.

### 2. Conditional async chains

Fetch B only after A succeeds. Fetch C only if B returns a specific value. Skip D on weekends.

```typescript
// Zustand: nested async orchestration inside an action
const useOnboardingStore = create((set, get) => ({
  profile: null,
  team: null,
  config: null,
  step: "idle",

  startOnboarding: async (userId) => {
    set({ step: "fetching-profile" });

    try {
      const profile = await api.getProfile(userId);
      set({ profile, step: "fetching-team" });

      if (profile.teamId) {
        const team = await api.getTeam(profile.teamId);
        set({ team, step: "fetching-config" });

        if (team.plan === "enterprise") {
          const config = await api.getEnterpriseConfig(team.id);
          set({ config, step: "complete" });
        } else {
          set({ step: "complete" });
        }
      } else {
        set({ step: "complete" });
      }
    } catch (err) {
      set({ step: "error" });
      // Which step failed? What should we retry?
      // The error object doesn't carry that context.
    }
  },
}));
```

The function is a procedural script masquerading as state management. Each conditional branch is a transition, but the branching logic is implicit. If the enterprise config fetch fails, there's no way to retry just that step &ndash; the catch block doesn't know which request threw. Adding a new step means weaving it into the existing nesting.

### 3. Retry and error recovery

The retry logic from the expanded user store is representative. Every store that needs retry ends up with some variation of:

```typescript
// Zustand: hand-rolled retry in every store that needs it
const useDataStore = create((set, get) => ({
  data: null,
  error: null,
  retryCount: 0,
  maxRetries: 3,

  fetchData: async () => {
    set({ error: null });

    try {
      const data = await api.getData();
      set({ data, retryCount: 0 });
    } catch (err) {
      const { retryCount, maxRetries } = get();
      if (retryCount < maxRetries) {
        // Manual backoff
        const delay = Math.pow(2, retryCount) * 1000;
        setTimeout(() => {
          set({ retryCount: retryCount + 1 });
          get().fetchData();
        }, delay);
      } else {
        set({ error: "Max retries exceeded" });
      }
    }
  },
}));
```

This is reimplemented in every store. The backoff formula varies. Some stores forget to clear `retryCount` on success. Some forget to clear the timeout on unmount. The `setTimeout` creates a closure over stale state that works most of the time but fails under rapid re-renders.

---

## The same three scenarios in Directive

Each of these failure modes maps to a first-class Directive concept. Cross-store dependencies become multi-module derivations. Conditional async chains become constraints with automatic sequencing. Retry becomes a declarative policy.

### Cross-module derivations

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const auth = createModule("auth", {
  schema: {
    token: t.string().nullable(),
    valid: t.boolean(),
  },
  init: (facts) => {
    facts.token = null;
    facts.valid = false;
  },
});

const user = createModule("user", {
  schema: {
    userId: t.number(),
    user: t.object<User>().nullable(),
    role: t.string().nullable(),
  },
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.role = null;
  },
});

const permissions = createModule("permissions", {
  schema: {
    entries: t.array(t.string()),
  },
  init: (facts) => {
    facts.entries = [];
  },
});

const system = createSystem({
  modules: { auth, user, permissions },

  // Derivations can read across all modules – auto-tracked
  derive: {
    canEdit: (facts) =>
      facts.user.role === "admin" ||
      facts.permissions.entries.includes("edit"),
  },

  // Constraints react to cross-module state changes
  constraints: {
    needsPermissions: {
      when: (facts) =>
        facts.user.role !== null &&
        facts.permissions.entries.length === 0,
      require: (facts) => ({
        type: "LOAD_PERMISSIONS",
        role: facts.user.role,
      }),
    },
  },

  resolvers: {
    loadPermissions: {
      requirement: "LOAD_PERMISSIONS",
      resolve: async (req, context) => {
        const perms = await api.getPermissions(req.role);
        context.facts.permissions.entries = perms;
      },
    },
  },
});
```

The `canEdit` derivation auto-tracks its dependencies across modules. When `user.role` changes, it recomputes. When `permissions.entries` changes, it recomputes. No `useEffect`, no manual subscriptions, no render-time recalculation. The `needsPermissions` constraint fires automatically when the role is set and permissions are empty &ndash; regardless of which component triggered the change.

### Constraint-driven async chains

```typescript
const onboarding = createModule("onboarding", {
  schema: {
    userId: t.number(),
    profile: t.object<Profile>().nullable(),
    team: t.object<Team>().nullable(),
    config: t.object<Config>().nullable(),
  },

  init: (facts) => {
    facts.userId = 0;
    facts.profile = null;
    facts.team = null;
    facts.config = null;
  },

  derive: {
    complete: (facts) =>
      facts.profile !== null &&
      (facts.profile.teamId === null || facts.team !== null) &&
      (facts.team?.plan !== "enterprise" || facts.config !== null),
  },

  constraints: {
    needsProfile: {
      when: (facts) => facts.userId > 0 && !facts.profile,
      require: { type: "FETCH_PROFILE" },
    },
    needsTeam: {
      when: (facts) =>
        facts.profile !== null &&
        facts.profile.teamId !== null &&
        !facts.team,
      require: (facts) => ({
        type: "FETCH_TEAM",
        teamId: facts.profile!.teamId,
      }),
    },
    needsConfig: {
      when: (facts) =>
        facts.team !== null &&
        facts.team.plan === "enterprise" &&
        !facts.config,
      require: (facts) => ({
        type: "FETCH_CONFIG",
        teamId: facts.team!.id,
      }),
    },
  },

  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      resolve: async (_req, context) => {
        context.facts.profile = await api.getProfile(context.facts.userId);
      },
    },
    fetchTeam: {
      requirement: "FETCH_TEAM",
      resolve: async (req, context) => {
        context.facts.team = await api.getTeam(req.teamId);
      },
    },
    fetchConfig: {
      requirement: "FETCH_CONFIG",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.config = await api.getEnterpriseConfig(req.teamId);
      },
    },
  },
});
```

Set `userId` and walk away. The reconciliation loop evaluates `needsProfile`, fetches the profile, re-evaluates, sees that `needsTeam` is now active (because `profile` is populated and has a `teamId`), fetches the team, re-evaluates, and so on. The chain emerges from independent constraints, not from nested `if` blocks. If the config fetch fails, only the config resolver retries. The profile and team data are untouched.

### Declarative retry

```typescript
// Directive: retry is a policy, not a pattern you reimplement
const data = createModule("data", {
  schema: {
    result: t.object<DataResult>().nullable(),
  },
  init: (facts) => {
    facts.result = null;
  },
  constraints: {
    needsData: {
      when: (facts) => !facts.result,
      require: { type: "FETCH_DATA" },
    },
  },
  resolvers: {
    fetchData: {
      requirement: "FETCH_DATA",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (_req, context) => {
        context.facts.result = await api.getData();
      },
    },
  },
});
```

Three lines of retry configuration replace twenty lines of manual `setTimeout`, `retryCount`, and stale closure management. The policy is visible, consistent, and tested once in the framework rather than re-tested in every store.

---

## Stay with Zustand if...

Directive is not a replacement for every Zustand store. Be honest about this.

**Your state is simple.** A theme toggle. A sidebar open/close flag. A search input value. Zustand handles these perfectly, and adding a constraint engine would be over-engineering.

**You have no async coordination.** If your stores are synchronous state with simple selectors, Zustand's model is exactly right. The complexity Directive addresses &ndash; conditional async chains, cross-store reactions, retry policies &ndash; doesn't exist in your app.

**Your team is productive.** If your team ships features quickly with Zustand and the codebase is maintainable, that's the right tool. Architecture decisions are about the team you have, not the one you wish you had.

The inflection point is when you find yourself writing `useEffect` to synchronize stores, adding boolean flags to track async state, or copy-pasting retry logic across files. That's when the implicit state machine has outgrown what Zustand was designed for.

---

## The bridge: use both

Zustand and Directive aren't mutually exclusive. A practical migration path keeps Zustand for simple UI state and introduces Directive for the orchestration layer.

```typescript
import { create } from "zustand";
import { createModule, createSystem, t } from "@directive-run/core";

// Zustand: simple UI state that doesn't need orchestration
const useUIStore = create(() => ({
  sidebarOpen: false,
  theme: "light" as "light" | "dark",
  toggleSidebar: () =>
    useUIStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme: "light" | "dark") => useUIStore.setState({ theme }),
}));

// Directive: async orchestration with cross-cutting concerns
const dataLayer = createModule("data-layer", {
  schema: {
    userId: t.number(),
    user: t.object<User>().nullable(),
    permissions: t.array(t.string()),
    config: t.object<AppConfig>().nullable(),
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.permissions = [];
    facts.config = null;
  },

  derive: {
    canEdit: (facts) =>
      facts.permissions.includes("write") ||
      facts.user?.role === "admin",
    isReady: (facts) =>
      facts.user !== null &&
      facts.permissions.length > 0 &&
      facts.config !== null,
  },

  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user,
      require: { type: "FETCH_USER" },
    },
    needsPermissions: {
      when: (facts) => facts.user !== null && facts.permissions.length === 0,
      require: { type: "FETCH_PERMISSIONS" },
    },
    needsConfig: {
      when: (facts) => facts.user !== null && !facts.config,
      require: { type: "FETCH_CONFIG" },
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (_req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
    fetchPermissions: {
      requirement: "FETCH_PERMISSIONS",
      resolve: async (_req, context) => {
        context.facts.permissions = await api.getPermissions(context.facts.user!.role);
      },
    },
    fetchConfig: {
      requirement: "FETCH_CONFIG",
      resolve: async (_req, context) => {
        context.facts.config = await api.getAppConfig();
      },
    },
  },
});

const system = createSystem({ module: dataLayer });
system.start();
```

Zustand handles what it's best at &ndash; synchronous, component-scoped state with a minimal API. Directive handles what *it's* best at &ndash; async coordination, cross-cutting constraints, and self-correcting resolution. The two don't compete; they address different layers of the same application.

---

## The inflection point

Zustand's simplicity is genuine, not a marketing claim. For the problem it was designed to solve &ndash; shared state across React components without ceremony &ndash; it's one of the best tools available.

The question isn't whether Zustand is good. It's whether the problem you're solving today is still the problem Zustand was built for. When your stores start accumulating boolean flags, `useEffect` synchronization, manual retry logic, and cross-store `getState()` calls, you've crossed the inflection point. You're not managing state anymore. You're managing a state machine, by hand, without the guarantees.

Directive doesn't ask you to throw away your Zustand stores. It asks you to notice the moment when simplicity has become complexity &ndash; and to reach for a tool that was designed for it.

---

## Next steps

- **[Zustand Migration Guide](/docs/migration/from-zustand)** &ndash; step-by-step migration with before/after comparisons for every Zustand pattern.
- **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** &ndash; the paradigm behind Directive, explained from first principles.
- **[Core Concepts](/docs/core-concepts)** &ndash; facts, constraints, resolvers, and the reconciliation loop.
- **[Quick Start](/docs/quick-start)** &ndash; install Directive and build your first module in five minutes.
