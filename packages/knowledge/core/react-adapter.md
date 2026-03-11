# React Adapter

The React adapter connects Directive systems to React components. Import from `@directive-run/react`.

## Decision Tree: "How do I use Directive in React?"

```
What are you building?
├── Read system state in a component → useSelector(system, selector)
├── Dispatch events from a component → useEvent(system)
├── Create a system scoped to a component → useSystem(config)
├── Share a system across components → DirectiveProvider + useDirectiveContext()
└── Global system shared by entire app → Create outside React, use useSelector
```

## Setup: System Outside React (Recommended)

Create the system outside of React. Components subscribe to it.

```typescript
// system.ts – created once, imported anywhere
import { createSystem } from "@directive-run/core";
import { counterModule } from "./counter-module";

export const system = createSystem({ module: counterModule });
```

```typescript
// Counter.tsx
import { useSelector, useEvent } from "@directive-run/react";
import { system } from "./system";

function Counter() {
  // Subscribe to derived state – re-renders only when value changes
  const count = useSelector(system, (s) => s.facts.count);
  const doubled = useSelector(system, (s) => s.derive.doubled);

  // Get event dispatcher
  const events = useEvent(system);

  return (
    <div>
      <p>Count: {count}</p>
      <p>Doubled: {doubled}</p>
      <button onClick={() => events.increment()}>+1</button>
      <button onClick={() => events.reset()}>Reset</button>
    </div>
  );
}
```

## useSelector

Subscribes to system state. Re-renders the component only when the selected value changes (shallow comparison).

```typescript
import { useSelector } from "@directive-run/react";

function UserProfile() {
  // Select a single fact
  const name = useSelector(system, (s) => s.facts.userName);

  // Select a derivation
  const isAdmin = useSelector(system, (s) => s.derive.isAdmin);

  // Select a computed value from multiple facts
  const summary = useSelector(system, (s) => ({
    name: s.facts.userName,
    role: s.facts.role,
    isAdmin: s.derive.isAdmin,
  }));

  return <div>{summary.name} ({summary.role})</div>;
}
```

### Multi-Module System

```typescript
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
});

function Header() {
  const token = useSelector(system, (s) => s.facts.auth.token);
  const itemCount = useSelector(system, (s) => s.derive.cart.itemCount);

  return <header>Items: {itemCount}</header>;
}
```

## useEvent

Returns the system's event dispatcher. Stable reference (does not cause re-renders).

```typescript
import { useEvent } from "@directive-run/react";

function LoginForm() {
  const events = useEvent(system);

  const handleSubmit = (email: string, password: string) => {
    events.login({ email, password });
  };

  return <form onSubmit={() => handleSubmit("a@b.com", "pass")}>...</form>;
}

// Multi-module
function CartActions() {
  const events = useEvent(system);

  return (
    <button onClick={() => events.cart.addItem({ productId: "p1" })}>
      Add to Cart
    </button>
  );
}
```

## useSystem

Creates and manages a system's lifecycle within a React component. The system is created on mount and destroyed on unmount.

```typescript
import { useSystem, useSelector, useEvent } from "@directive-run/react";

function GameBoard() {
  // System created on mount, destroyed on unmount
  const gameSystem = useSystem({
    module: gameModule,
    history: true,
  });

  const score = useSelector(gameSystem, (s) => s.facts.score);
  const events = useEvent(gameSystem);

  return (
    <div>
      <p>Score: {score}</p>
      <button onClick={() => events.move({ direction: "up" })}>Up</button>
    </div>
  );
}
```

Use `useSystem` when the system's lifecycle matches a component's lifecycle (e.g., a game board, a wizard, a modal form). For app-wide state, create the system outside React.

## DirectiveProvider and useDirectiveContext

Share a system through React context.

```typescript
import { DirectiveProvider, useDirectiveContext, useSelector, useEvent } from "@directive-run/react";

// Provide the system at the top of your tree
function App() {
  return (
    <DirectiveProvider system={system}>
      <Dashboard />
    </DirectiveProvider>
  );
}

// Consume the system anywhere below
function Dashboard() {
  const system = useDirectiveContext();
  const stats = useSelector(system, (s) => s.derive.dashboardStats);

  return <div>{stats.totalUsers} users</div>;
}
```

## CRITICAL: Hooks That DO NOT Exist

```typescript
// WRONG – useDirective() does not exist. This is a common hallucination.
const { facts, derive, events } = useDirective(system);

// CORRECT – use useSelector for state, useEvent for actions
const count = useSelector(system, (s) => s.facts.count);
const events = useEvent(system);
```

## Common Mistakes

### Creating the system inside a component without useSystem

```typescript
// WRONG – creates a new system on every render
function Counter() {
  const system = createSystem({ module: counterModule }); // New system each render!
  const count = useSelector(system, (s) => s.facts.count);

  return <div>{count}</div>;
}

// CORRECT – create outside the component
const system = createSystem({ module: counterModule });

function Counter() {
  const count = useSelector(system, (s) => s.facts.count);

  return <div>{count}</div>;
}

// ALSO CORRECT – useSystem manages lifecycle
function Counter() {
  const system = useSystem({ module: counterModule });
  const count = useSelector(system, (s) => s.facts.count);

  return <div>{count}</div>;
}
```

### Selecting too much state (causes unnecessary re-renders)

```typescript
// WRONG – re-renders on ANY fact change
const allFacts = useSelector(system, (s) => s.facts);

// CORRECT – select only what you need
const name = useSelector(system, (s) => s.facts.userName);
const count = useSelector(system, (s) => s.facts.count);
```

### Mutating facts directly in event handlers

```typescript
// WRONG – bypass the event system
function Counter() {
  const count = useSelector(system, (s) => s.facts.count);

  return (
    <button onClick={() => { system.facts.count += 1; }}>
      {count}
    </button>
  );
}

// CORRECT – use events for intent-driven mutations
function Counter() {
  const count = useSelector(system, (s) => s.facts.count);
  const events = useEvent(system);

  return (
    <button onClick={() => events.increment()}>
      {count}
    </button>
  );
}
```

### Casting values from useSelector

```typescript
// WRONG – unnecessary type casting
const profile = useSelector(system, (s) => s.facts.profile as UserProfile);

// CORRECT – types are inferred from the module schema
const profile = useSelector(system, (s) => s.facts.profile);
```
