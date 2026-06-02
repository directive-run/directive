# Naming Conventions

> Covers all `@directive-run/*` packages — terminology, parameter names, return-style rules.

Directive uses precise vocabulary by design: each concept has one canonical name across every package, every language adapter, and every doc. The names are non-negotiable for code Directive ships, AND every term has a cross-paradigm alias so a developer coming from Redux / Zustand / XState / Jotai / React Query can find the right Directive concept on the first search.

This file is both the rules and the bridge. Search for the term you already know; you'll land on the Directive equivalent.

## Coming from another library? Start here

| If you call it… | (in this library) | Directive calls it… | Why the name |
|---|---|---|---|
| **state**, **store**, **atom**, **signal**, **observable** | Redux, Zustand, Jotai, Preact Signals, MobX | **facts** | "Facts about the world" — the system observes them. Same value-bag role as state, with a proxy that auto-tracks reads. |
| **selector**, **computed**, **getter**, **memo**, **derived store** | Redux, Vue/MobX, Zustand getters, Memoize, Svelte | **derivations** / `derive` | Auto-tracked computed values. No dep arrays. Directive's name aligns with "derived from facts." |
| **action**, **dispatch**, **reducer**, **command**, **intent** | Redux, Redux Toolkit, CQRS | **events** + **resolvers** | Events are the user-facing trigger; resolvers fulfill them. Reducers are split into the two halves Directive cares about. |
| **thunk**, **saga**, **effect**, **middleware**, **listener** | Redux Toolkit, redux-saga, redux-observable, NgRx | **resolvers** | Async logic that mutates state in response to a requirement. Same role as a thunk; declared once, run by the runtime. |
| **rule**, **condition**, **guard**, **trigger**, **policy** | XState guards, Cerbos, OPA, business-rule engines | **constraints** | Declarative "when X is true, Y must happen." Constraints emit requirements; resolvers fulfill them. |
| **request**, **query**, **side-effect spec** | React Query / TanStack Query queries, Apollo queries | **requirements** | The object a constraint emits. The runtime dedupes them, dispatches to resolvers, tracks status. |
| **subscription**, **listener**, **reaction**, **watcher** | Zustand subscribe, MobX reactions, Redux subscriptions | **effects** | Side-effects that run when watched facts change. Cleaner than `subscribe()` callbacks because effects auto-track. |
| **slice**, **feature**, **domain**, **bounded context** | Redux Toolkit slices, NgRx feature modules | **modules** | Encapsulates facts + derivations + constraints + resolvers + events for one bounded slice of the system. |
| **store**, **container**, **context**, **app state** | Redux Store, Pinia, React Context, NgRx Store | **system** | The runtime that wires modules together, evaluates constraints, dispatches resolvers, and exposes observation. |
| **state machine**, **statechart**, **xstate machine** | XState | (closest: **module** + **constraints**) | Directive isn't a state machine — but if your XState `states` model business rules (not UI flow), constraints + facts express the same logic declaratively with no transition functions. |
| **cache**, **query cache**, **stale-while-revalidate** | TanStack Query, SWR, Apollo cache | (closest: `@directive-run/query` + **constraints**) | Use `@directive-run/query` for the cache; constraints decide when refetches fire. Directive doesn't replace TanStack Query — it composes with it. |
| **agent**, **chain**, **graph**, **workflow** | LangChain, LangGraph, OpenAI Assistants | **agent** + **orchestrator** | `@directive-run/ai` keeps the names — agents are agents, orchestrators are orchestrators — but they run under the same constraint engine as the rest of Directive. |
| **guardrail**, **filter**, **safety check**, **moderation** | OpenAI moderation API, NVIDIA NeMo Guardrails | **guardrails** | Same name, same role; declarative input/output/tool-call checks. |

If your term isn't in the table, search the canonical name in this doc's [Terminology quick reference](#terminology-quick-reference) — both directions are listed.

## Canonical terms (non-negotiable for code Directive ships)

Above is the bridge from your existing vocabulary. Below are the canonical names — the only ones that should appear in `@directive-run/*` source, tests, docs, and generated AI rules.

### `facts` — the value bag

Not state, not store, not atoms. **Facts.** Accessed at `system.facts.x`. Mutated through events and resolvers. Read through derivations, hooks, and `system.facts.$store`.

### `derivations` — auto-tracked computed values

Declared via `derive: { name: (facts) => … }`. Read at `system.derive.name`. The hook is `useDerived` (not `useComputed`, not `useSelector` — Directive's `useSelector` is a different, broader primitive that takes a selector function).

### `constraints` — when-then declarations

Declared via `constraints: { name: { when: …, require: … } }`. The `when` returns a boolean; the `require` returns a requirement.

### `resolvers` — requirement fulfillment

Declared via `resolvers: { name: { requirement: …, resolve: async (req, context) => … } }`. Mutate `context.facts`; never return data from `resolve`.

### `requirements` — what constraints emit

Tagged union `{ type: "FETCH_USER", … }`. Constraints emit them; the runtime dedupes by `type` + `key()`; resolvers fulfill them.

### `effects` — side effects from watched changes

Declared via `effects: { name: { run: (facts, prev) => … } }`. Run on relevant fact changes. The auto-tracking dependency model means no `deps` array unless you specifically need a partial dep set.

### `events` — typed mutation entry points

Declared via `events: { name: (facts, payload) => … }`. Called as `system.events.name(payload)`. The typed events accessor is the canonical way to dispatch — `system.dispatch({type, ...payload})` works but the typed accessor carries autocomplete.

### `module` — bounded slice

Created via `createModule(name, { schema, init, derive, effects, events, constraints, resolvers })`. Composes into systems.

### `system` — the runtime

Created via `createSystem({ module })` or `createSystem({ modules: { x, y } })`. Hosts the reconciliation loop.

## Parameter naming

### `req` = requirement (NOT request)

The `req` parameter in resolvers and constraint `key()` functions is short for **requirement** — the object emitted by a constraint's `require` property.

```typescript
// CORRECT — req is a requirement
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    key: (req) => `fetch-${req.userId}`,
    resolve: async (req, context) => {
      // req.type === "FETCH_USER"
      const user = await fetchUser(req.userId);
      context.facts.user = user;
    },
  },
},

// WRONG — never "request" or "r"
resolve: async (request, context) => { /* ... */ },
resolve: async (r, context) => { /* ... */ },
```

### `context` is never abbreviated

```typescript
// CORRECT
resolve: async (req, context) => {
  context.facts.status = "loaded";
  context.signal;       // AbortSignal
  context.snapshot();   // facts snapshot
},

// WRONG — never abbreviate to ctx
resolve: async (req, ctx) => { /* ... */ },
```

## Return style

### Braces for `if` blocks with `return` (NOT for arrow expressions)

The brace rule applies to control-flow blocks — not to arrow-expression bodies.

**Arrow expressions** (single-line derivations, predicates, computed requirements): the concise form is preferred. No braces, no explicit `return`.

```typescript
// CORRECT — single-line arrow expressions stay concise
derive: {
  isReady: (facts) => facts.phase === "ready",
  greeting: (facts) => `Hi, ${facts.name}!`,
},

constraints: {
  check: {
    when: (facts) => facts.count > 10,
    require: { type: "PROCESS" },
  },
},
```

**Control-flow statements** (`if`, `for`, `while`): braces required, even for single-line bodies. Single-line `if (x) return y` shapes are never used.

```typescript
// WRONG — single-line if return
if (facts.user) return "ready";

// CORRECT — always wrap the body in braces
if (facts.user) {
  return "ready";
}
```

### Blank line before `return`

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
```

## Multi-line code formatting

Never put properties or statements on a single line inside braces. Always expand to one item per line with proper indentation. This applies everywhere: schema definitions, init functions, events, effects, requirement types, and any other object or block.

```typescript
// WRONG — properties crammed on one line
schema: {
  facts: { phase: t.string(), count: t.number() },
  requirements: { FETCH_USER: { id: t.string() }, RESET: {} },
},

// CORRECT — one property per line, always expanded
schema: {
  facts: {
    phase: t.string(),
    count: t.number(),
  },
  requirements: {
    FETCH_USER: {
      id: t.string(),
    },
    RESET: {},
  },
},

// WRONG — statements crammed on one line
init: (facts) => { facts.phase = "idle"; facts.count = 0; },

// CORRECT — one statement per line
init: (facts) => {
  facts.phase = "idle";
  facts.count = 0;
},
```

Single-expression arrows (no braces) are fine on one line. Empty objects `{}` are fine inline.

```typescript
// OK — single expression, no braces
derive: {
  isReady: (facts) => facts.phase === "ready",
},

// OK — empty object
RESET: {},
```

## Multi-module naming

### `facts.self.*` for own module

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

### System-level access uses dot notation

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

## Type casting rules

### Never cast when reading

The schema provides all types. Do not add `as` casts when reading facts or derivations from the system.

```typescript
// CORRECT — schema provides the type
const profile = system.facts.profile;
const isReady = system.derive.isReady;

// WRONG — unnecessary cast
const profile = system.facts.profile as UserProfile;
const isReady = system.derive.isReady as boolean;
```

### Cast only in schema definition

Type assertions are only valid in schema definition using the `{} as {}` pattern, or via the `t.*` builders (preferred):

```typescript
// CORRECT — cast in schema definition
schema: {
  facts: {} as { profile: UserProfile; settings: AppSettings },
  derivations: {} as { displayName: string },
},

// PREFERRED — t.* builders
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

## Terminology quick reference

Two-way lookup. Search the term you know.

| Directive term | Cross-paradigm aliases (use these to search) |
|---|---|
| **facts** | state, store, atoms, signals, observables, model |
| **derivations** / `derive` | computed, selectors, getters, memos, derived stores, $: blocks (Svelte) |
| **constraints** | rules, conditions, triggers, guards, policies, invariants |
| **resolvers** | handlers, actions, reducers, sagas, thunks, effects (Redux), middleware, listeners |
| **requirements** | requests, commands, intents, queries (TanStack), tasks |
| **effects** | watchers, subscriptions, reactions, autoruns, listeners |
| **events** | actions, intents, commands, methods (Pinia), signals (NgRx) |
| **module** | slice, feature, domain, bounded context, NgRx feature module |
| **system** | store, container, context, app state, app shell |
| **`req`** (parameter) | request, r, requirement (spelled out) |
| **`context`** (parameter) | ctx, c, resolverContext |

The forbidden direction is also non-negotiable: in code Directive ships, the columns reverse. Do NOT use `state`, `store`, `selectors`, `computed`, `actions`, `reducers`, `subscriptions`, `slices`, `request`, or `ctx` in `@directive-run/*` source. The alias map is for retrieval — the canonical names are for code.

## See also

- [`core-patterns.md`](./core-patterns.md) — the actual code shapes every naming rule here applies to
- [`multi-module.md`](./multi-module.md) — `facts.self.*` convention and dot-notation rules
- [`anti-patterns.md`](./anti-patterns.md) — naming-shaped mistakes (`request` for `req`, `ctx` for `context`, hallucinated TS schema types)
