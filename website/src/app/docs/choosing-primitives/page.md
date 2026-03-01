---
title: Choosing the Right Primitive
description: A decision guide for picking between facts, derivations, constraints, resolvers, effects, and events.
---

When to use each Directive primitive — and when not to. {% .lead %}

---

## Decision Tree

Start here when you're unsure which primitive to reach for:

1. **Are you storing a value the user or server provides directly?** → **Fact**
2. **Are you computing a value from other facts?** → **Derivation**
3. **Do you need to react to a user action synchronously?** → **Event**
4. **Do you need to declare "this must be true" and let the runtime figure out how?** → **Constraint** + **Resolver**
5. **Do you need a fire-and-forget side effect (logging, DOM updates, analytics)?** → **Effect**

If you're still unsure, ask: _does this thing produce requirements, or consume them?_ Constraints produce requirements. Resolvers consume them. Everything else is either data (facts, derivations) or reactions (events, effects).

---

## Comparison Table

| Primitive | Purpose | Sync/Async | Reads State | Writes State | Example |
|-----------|---------|------------|-------------|--------------|---------|
| **Fact** | Source of truth | Sync | — | Yes | `facts.user = data` |
| **Derivation** | Computed value | Sync | Yes | No | `isAdmin: (facts) => facts.role === 'admin'` |
| **Event** | Synchronous mutation | Sync | Yes | Yes | `events.addItem(facts, payload)` |
| **Constraint** | Declares a requirement | Sync or Async | Yes | No | `when: (facts) => !facts.user` → `require: { type: 'FETCH_USER' }` |
| **Resolver** | Fulfills a requirement | Async | Yes | Yes | `resolve: async (req, context) => { ... }` |
| **Effect** | Side effect | Sync | Yes | No (should not) | `run: (facts) => document.title = facts.title` |

Key distinctions:

- **Derivations vs Effects**: Derivations compute values. Effects perform side effects. If you need the result, it's a derivation. If you need the action, it's an effect.
- **Events vs Resolvers**: Events are synchronous and immediate. Resolvers handle async work triggered by constraints.
- **Constraints vs Effects**: Constraints say "something is missing." Effects say "something changed, react to it."

---

## Common Mistakes

### Putting async logic in events

```typescript
// Wrong — events are synchronous
events: {
  fetchUser: async (facts) => {
    const res = await fetch('/api/user'); // Don't do this
    facts.user = await res.json();
  },
},

// Right — use a constraint + resolver
constraints: {
  needsUser: {
    when: (facts) => !facts.user && facts.token,
    require: { type: 'FETCH_USER' },
  },
},
resolvers: {
  fetchUser: {
    requirement: 'FETCH_USER',
    resolve: async (req, context) => {
      const res = await fetch('/api/user');
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      context.facts.user = await res.json();
    },
  },
},
```

### Mutating facts in effects

```typescript
// Wrong — effects shouldn't write to facts
effects: {
  syncTheme: {
    run: (facts) => {
      facts.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light'; // Don't mutate facts here
    },
  },
},

// Right — use a constraint + resolver to read the system preference
constraints: {
  needsThemeDetection: {
    when: (facts) => !facts.themeDetected,
    require: { type: 'DETECT_THEME' },
  },
},
resolvers: {
  detectTheme: {
    requirement: 'DETECT_THEME',
    resolve: async (req, context) => {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      context.facts.theme = dark ? 'dark' : 'light';
      context.facts.themeDetected = true;
    },
  },
},
```

### Using constraints for synchronous transforms

```typescript
// Wrong — constraint + resolver for a simple computation
constraints: {
  needsFullName: {
    when: (facts) => !facts.fullName && facts.firstName,
    require: { type: 'COMPUTE_NAME' },
  },
},

// Right — just use a derivation
derive: {
  fullName: (facts) => `${facts.firstName} ${facts.lastName}`,
},
```

### Over-constraining: when a simple event is enough

```typescript
// Overkill — constraint + resolver for a synchronous toggle
constraints: {
  needsToggle: {
    when: (facts) => facts.toggleRequested,
    require: { type: 'TOGGLE_SIDEBAR' },
  },
},

// Right — just use an event
events: {
  toggleSidebar: (facts) => {
    facts.sidebarOpen = !facts.sidebarOpen;
  },
},
```

---

## Same Feature, Two Ways

### 1. Theme Toggle

**Wrong: Constraint + Resolver**
```typescript
constraints: {
  needsThemeSwitch: {
    when: (facts) => facts.themeChangeRequested,
    require: { type: 'SWITCH_THEME' },
  },
},
resolvers: {
  switchTheme: {
    requirement: 'SWITCH_THEME',
    resolve: async (req, context) => {
      context.facts.theme = context.facts.theme === 'light' ? 'dark' : 'light';
      context.facts.themeChangeRequested = false;
    },
  },
},
```

**Right: Event (synchronous, no async needed)**
```typescript
events: {
  toggleTheme: (facts) => {
    facts.theme = facts.theme === 'light' ? 'dark' : 'light';
  },
},
```

### 2. Filtered List

**Wrong: Effect that writes facts**
```typescript
effects: {
  filterItems: {
    deps: ['searchQuery', 'items'],
    run: (facts) => {
      facts.filtered = facts.items.filter(i => i.name.includes(facts.searchQuery));
    },
  },
},
```

**Right: Derivation (pure computation)**
```typescript
derive: {
  filteredItems: (facts) => {
    return facts.items.filter(i => i.name.includes(facts.searchQuery));
  },
},
```

### 3. Loading User Data

**Wrong: Event with async logic**
```typescript
events: {
  loadUser: async (facts) => {
    facts.loading = true;
    const user = await fetchUser(facts.userId);
    facts.user = user;
    facts.loading = false;
  },
},
```

**Right: Constraint + Resolver**
```typescript
constraints: {
  needsUser: {
    when: (facts) => !facts.user && facts.userId,
    require: (facts) => ({ type: 'LOAD_USER', userId: facts.userId }),
  },
},
resolvers: {
  loadUser: {
    requirement: 'LOAD_USER',
    resolve: async (req, context) => {
      const user = await fetchUser(req.userId);
      context.facts.user = user;
    },
  },
},
```

### 4. Page Title Sync

**Wrong: Derivation with side effects**
```typescript
derive: {
  pageTitle: (facts) => {
    const title = `${facts.currentPage} - MyApp`;
    document.title = title; // Side effect in a derivation!

    return title;
  },
},
```

**Right: Derivation + Effect**
```typescript
derive: {
  pageTitle: (facts) => `${facts.currentPage} - MyApp`,
},
effects: {
  syncTitle: {
    deps: ["currentPage"],
    run: (facts) => {
      document.title = `${facts.currentPage} - MyApp`;
    },
  },
},
```

### 5. Auto-Save

**Wrong: Effect that triggers async work**
```typescript
effects: {
  autoSave: {
    deps: ['document'],
    run: async (facts) => {
      await fetch('/api/save', {
        method: 'POST',
        body: JSON.stringify(facts.document),
      });
    },
  },
},
```

**Right: Constraint + Resolver (with debounce)**
```typescript
constraints: {
  needsSave: {
    when: (facts) => facts.isDirty && !facts.isSaving,
    require: (facts) => ({ type: 'SAVE_DOCUMENT', content: facts.document }),
  },
},
resolvers: {
  saveDocument: {
    requirement: 'SAVE_DOCUMENT',
    resolve: async (req, context) => {
      const res = await fetch('/api/save', {
        method: 'POST',
        body: JSON.stringify(req.content),
      });
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
      }
      context.facts.isDirty = false;
    },
  },
},
```

---

## Related

- [Core Concepts](/docs/core-concepts) — overview of all primitives
- [Facts](/docs/facts) — proxy-based state
- [Derivations](/docs/derivations) — auto-tracked computed values
- [Constraints](/docs/constraints) — declaring requirements
- [Resolvers](/docs/resolvers) — fulfilling requirements
- [Effects](/docs/effects) — fire-and-forget side effects
- [Events](/docs/events) — synchronous mutations
