# React Adapter

> Covers `@directive-run/react` — `useFact`, `useDerived`, `useEvents`, `useSelector`, `useDirective`, `createDirectiveContext`.

The React adapter connects Directive systems to React components. Import from `@directive-run/react`.

## Canonical pattern: `createDirectiveContext`

This is the recommended way to use Directive in React. One call returns a typed `Provider` plus bound hooks — no system arg needed at every call site, no `useContext` boilerplate, full type inference from the schema.

```tsx
// counter-context.ts — create once, import everywhere
import { createSystem } from "@directive-run/core";
import { createDirectiveContext } from "@directive-run/react";
import { counterModule } from "./counter-module";

export const counterSystem = createSystem({ module: counterModule });
export const Counter = createDirectiveContext(counterSystem);
```

```tsx
// App.tsx
import { Counter } from "./counter-context";
import { Display } from "./Display";

export function App() {
  return (
    <Counter.Provider>
      <Display />
    </Counter.Provider>
  );
}
```

```tsx
// Display.tsx
import { Counter } from "./counter-context";

export function Display() {
  const count = Counter.useFact("count");
  const doubled = Counter.useDerived("doubled");
  const events = Counter.useEvents();

  return (
    <div>
      <p>Count: {count} (doubled: {doubled})</p>
      <button onClick={() => events.increment()}>+1</button>
      <button onClick={() => events.reset()}>Reset</button>
    </div>
  );
}
```

`createDirectiveContext(system)` returns: `{ Provider, useSystem, useFact, useDerived, useEvents, useDispatch, useSelector, useWatch, useInspect, useExplain, useHistory }`. All bound to the typed system — no system argument needed when calling them.

The Provider accepts an optional `system` prop override for testing:

```tsx
<Counter.Provider system={testSystem}>
  <ComponentUnderTest />
</Counter.Provider>
```

## Standalone hooks (without a context)

When you don't want a context (e.g. one-off components, prototypes), import the hooks directly and pass the system to each call:

```tsx
// system.ts
import { createSystem } from "@directive-run/core";
import { counterModule } from "./counter-module";

export const system = createSystem({ module: counterModule });
```

```tsx
// Counter.tsx
import { useFact, useDerived, useEvents } from "@directive-run/react";
import { system } from "./system";

export function Counter() {
  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);

  return (
    <div>
      <p>Count: {count} (doubled: {doubled})</p>
      <button onClick={() => events.increment()}>+1</button>
    </div>
  );
}
```

## Hook reference

### `useFact(system, key)` or `useFact(system, [keys])`

Reads one fact (single key) or many facts (array of keys). Re-renders only when the selected fact(s) change. Return type is narrowed by the schema.

```tsx
import { useFact } from "@directive-run/react";

function Profile() {
  // Single key — typed: name is string | undefined
  const name = useFact(system, "name");

  // Multi-key — typed: { name: string; age: number }
  const { name, age } = useFact(system, ["name", "age"]);

  return <div>{name} ({age})</div>;
}
```

### `useDerived(system, id)` or `useDerived(system, [ids])`

Same shape as `useFact` but for derivations. Re-renders only when the derivation's value changes.

```tsx
import { useDerived } from "@directive-run/react";

function Status() {
  const isReady = useDerived(system, "isReady");
  const { isReady, isLoading } = useDerived(system, ["isReady", "isLoading"]);

  return <div>{isReady ? "ready" : "loading"}</div>;
}
```

### `useEvents(system)`

Returns the system's typed events accessor. Stable identity — does not cause re-renders. **This is the primary way to dispatch events from a component** — it carries autocomplete for every event name and payload shape.

```tsx
import { useEvents } from "@directive-run/react";

function CartActions() {
  const events = useEvents(system);

  return (
    <>
      <button onClick={() => events.addItem({ productId: "p1" })}>Add</button>
      <button onClick={() => events.checkout()}>Checkout</button>
    </>
  );
}

// Namespaced (multi-module) system — events are nested by module name
function Header() {
  const events = useEvents(namespacedSystem);

  return <button onClick={() => events.cart.addItem({ productId: "p1" })}>Add</button>;
}
```

### `useSelector(system, selector, equalityFn?)`

For computed values across multiple facts and derivations. Auto-tracks accessed keys; re-renders only when the selected result changes (by `Object.is` equality, override with `equalityFn`).

```tsx
import { useSelector, shallowEqual } from "@directive-run/react";

function CheckoutSummary() {
  const summary = useSelector(system, (state) => ({
    itemCount: state.items.length,
    total: state.cartTotal,
    isReady: state.canCheckout,
  }), shallowEqual);

  return <div>{summary.itemCount} items · {summary.total}</div>;
}
```

`state` carries both facts and derivations in a flat namespace — that's why it's typed `InferSelectorState<S>`, not `InferFacts<S>`.

### `useDispatch(system)`

Returns a raw `dispatch(event)` function. Useful when you need to forward events programmatically or when the event name is computed at runtime. Prefer `useEvents` for normal dispatch — it carries typing.

```tsx
import { useDispatch } from "@directive-run/react";

function ToolBar({ actions }: { actions: SystemEvent[] }) {
  const dispatch = useDispatch(system);

  return actions.map((a) => (
    <button key={a.type} onClick={() => dispatch(a)}>{a.type}</button>
  ));
}
```

### `useDirective(moduleOrOptions, selections?)`

Convenience hook that **creates a scoped system** AND selects facts/derivations in one call. The system lives for the lifetime of the component (created on mount, destroyed on unmount). Use this when the system's lifecycle should match a component's lifecycle — game boards, wizard flows, modal forms.

```tsx
import { useDirective } from "@directive-run/react";
import { gameModule } from "./game-module";

function GameBoard() {
  // Selective subscription — only re-renders when score or isOver change
  const { facts: { score }, derived: { isOver }, events } = useDirective(gameModule, {
    facts: ["score"],
    derived: ["isOver"],
  });

  return (
    <div>
      <p>Score: {score}{isOver && " — game over!"}</p>
      <button onClick={() => events.move({ direction: "up" })}>Up</button>
    </div>
  );
}

// Subscribe to everything (omit keys)
function Debug() {
  const { facts, derived, events, dispatch } = useDirective(gameModule);

  return <pre>{JSON.stringify({ facts, derived }, null, 2)}</pre>;
}
```

For app-wide state, prefer `createDirectiveContext` over `useDirective` — the context pattern creates the system once instead of per-component.

### `useDirectiveRef(moduleOrOptions, config?)`

Just the system-lifecycle half of `useDirective`. Returns the `SingleModuleSystem<S>` instance. Use this when you need a scoped system without consuming its state in this component (e.g., you're going to thread it through props or a context).

### `useWatch(system, factOrDerivationId, callback)`

Imperative side-effect when a fact or derivation changes. Does NOT cause re-renders — use this for analytics, logging, focus management. For state you want to render, use `useFact` / `useDerived` / `useSelector`.

### Status + introspection hooks

| Hook | Purpose |
|---|---|
| `useRequirementStatus(system, type)` | Reactive `idle / running / success / error` status for a requirement type |
| `useConstraintStatus(system, id)` | Reactive constraint enabled/disabled state |
| `useSuspenseRequirement(system, type)` | Same as `useRequirementStatus` but suspends until resolved (Suspense boundary required) |
| `useExplain(system, requirementId)` | Reactive English explanation of a requirement's `when` predicate |
| `useInspect(system, options?)` | Full system inspection state — constraints, requirements, resolvers, derivations |
| `useHistory(system)` | Time-travel UI helpers: `goBack`, `goForward`, `canUndo`, `canRedo`, snapshot list |
| `useAuditLedger(system)` | Subscribe to a configured `createAuditLedger` plugin's entries |

### SSR + hydration

`DirectiveHydrator` and `useHydratedSystem` close the SSR loop. See `system-api.md` → "Hydration" for the full pattern.

### Suspense for data fetching

`useQuerySystem` + `useSuspenseQuery` integrate `@directive-run/query`'s subscription/mutation primitives with React's Suspense and Error Boundaries. See the `@directive-run/query` docs.

## CRITICAL: hooks that DO NOT exist

LLMs frequently hallucinate these names because they sound plausible. None of them are exported from `@directive-run/react`.

| Hallucination | Use instead |
|---|---|
| `useEvent(system)` (singular) | `useEvents(system)` (plural) |
| `useSystem(config)` as a top-level import | `useDirective(module)` or `createDirectiveContext().useSystem` |
| `DirectiveProvider` as a top-level import | `createDirectiveContext(system).Provider` |
| `useDirectiveContext()` | `createDirectiveContext(system).useSystem()` |
| `useState`-style writes like `setCount(5)` | Dispatch events: `events.setCount(5)` (or whatever your module defines) |

```tsx
// WRONG — useEvent does not exist
import { useEvent } from "@directive-run/react";
const events = useEvent(system);

// CORRECT — useEvents (plural)
import { useEvents } from "@directive-run/react";
const events = useEvents(system);
```

```tsx
// WRONG — DirectiveProvider is not a top-level export
import { DirectiveProvider, useDirectiveContext } from "@directive-run/react";
<DirectiveProvider system={system}>...</DirectiveProvider>

// CORRECT — Provider comes from createDirectiveContext()
import { createDirectiveContext } from "@directive-run/react";
export const Counter = createDirectiveContext(counterSystem);
<Counter.Provider>...</Counter.Provider>
```

## Common mistakes

### Creating the system inside a component body

```tsx
// WRONG — creates a new system on every render
function Counter() {
  const system = createSystem({ module: counterModule });
  const count = useFact(system, "count");
  return <div>{count}</div>;
}

// CORRECT — create outside the component
const system = createSystem({ module: counterModule });

function Counter() {
  const count = useFact(system, "count");
  return <div>{count}</div>;
}

// ALSO CORRECT — useDirective manages lifecycle
function Counter() {
  const { facts: { count } } = useDirective(counterModule, { facts: ["count"] });
  return <div>{count}</div>;
}
```

### Selecting too much state (excess re-renders)

```tsx
// WRONG — re-renders on ANY fact change
const allFacts = useSelector(system, (s) => s);

// WRONG — re-renders even when other facts change (new object identity every time)
const profile = useSelector(system, (s) => ({ name: s.name, age: s.age }));

// CORRECT — use the targeted hook
const name = useFact(system, "name");

// CORRECT — multi-key reads a stable subset
const { name, age } = useFact(system, ["name", "age"]);

// CORRECT — useSelector with shallowEqual for shaped output
import { shallowEqual } from "@directive-run/react";
const profile = useSelector(system, (s) => ({ name: s.name, age: s.age }), shallowEqual);
```

### Mutating facts directly from an event handler

```tsx
// WRONG — bypasses the event system, no audit trail, no constraint reaction
function Counter() {
  const count = useFact(system, "count");
  return <button onClick={() => { system.facts.count += 1; }}>{count}</button>;
}

// CORRECT — dispatch an event
function Counter() {
  const count = useFact(system, "count");
  const events = useEvents(system);
  return <button onClick={() => events.increment()}>{count}</button>;
}
```

### Casting values from hooks

```tsx
// WRONG — types come from the schema
const profile = useFact(system, "profile") as UserProfile;

// CORRECT — the schema types it for you
const profile = useFact(system, "profile");
```

### Forgetting `useEvents` is stable

```tsx
// UNNECESSARY — useEvents returns a stable reference, no useCallback needed
const events = useEvents(system);
const handleClick = useCallback(() => events.increment(), [events]);

// FINE — events.increment is stable across renders too
const events = useEvents(system);
<button onClick={() => events.increment()}>+</button>
```

## See also

- [`system-api.md`](./system-api.md) — the system instance the hooks here read from + the SSR/hydration story
- [`core-patterns.md`](./core-patterns.md) — the module shape every React example here assumes you've built
- [`anti-patterns.md`](./anti-patterns.md) — the hallucinated React hooks (`useEvent`, `useSystem`, `DirectiveProvider`) that AI assistants reach for
