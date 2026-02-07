---
title: React Hooks Reference
description: React hooks and components for Directive integration.
---

React adapter API reference. {% .lead %}

---

## DirectiveProvider

Context provider for Directive systems.

```typescript
function DirectiveProvider(props: {
  system: System;
  children: ReactNode;
}): JSX.Element
```

### Usage

```typescript
<DirectiveProvider system={system}>
  <App />
</DirectiveProvider>
```

---

## useSystem

Access the Directive system.

```typescript
function useSystem<T>(): System<T>
```

### Usage

```typescript
function Component() {
  const system = useSystem();

  const handleClick = () => {
    system.facts.count++;
  };
}
```

---

## useFact

Subscribe to a single fact.

```typescript
function useFact<K extends keyof Facts>(key: K): Facts[K]
```

### Usage

```typescript
function Counter() {
  const count = useFact('count');
  return <p>{count}</p>;
}
```

---

## useFacts

Subscribe to multiple facts.

```typescript
function useFacts<K extends keyof Facts>(keys: K[]): Pick<Facts, K>
```

### Usage

```typescript
function UserInfo() {
  const { name, email } = useFacts(['name', 'email']);
  return <p>{name} ({email})</p>;
}
```

---

## useDerived

Subscribe to a derivation.

```typescript
function useDerived<K extends keyof Derivations>(
  key: K
): Derivations[K]
```

### Usage

```typescript
function CartTotal() {
  const total = useDerived('cartTotal');
  return <p>Total: ${total}</p>;
}
```

---

## useEvent

Subscribe to events.

```typescript
function useEvent<K extends keyof Events>(
  event: K,
  handler: (payload: Events[K]) => void
): void
```

### Usage

```typescript
function Notifications() {
  useEvent('ORDER_PLACED', (payload) => {
    toast.success(`Order ${payload.orderId} placed!`);
  });
  return null;
}
```

---

## createTypedHooks

Create typed hooks for a module.

```typescript
function createTypedHooks<T extends Module>(): {
  useFact: TypedUseFact<T>;
  useFacts: TypedUseFacts<T>;
  useDerived: TypedUseDerived<T>;
  useSystem: TypedUseSystem<T>;
}
```

### Usage

```typescript
const { useFact, useDerived } = createTypedHooks<typeof myModule>();

function Component() {
  const count = useFact('count'); // Fully typed
}
```

---

## useSnapshot

Get a snapshot of current state.

```typescript
function useSnapshot(): Facts
```

---

## useTimeTravel

Access time-travel debugging.

```typescript
function useTimeTravel(): {
  history: Snapshot[];
  position: number;
  back: () => void;
  forward: () => void;
  goto: (index: number) => void;
}
```

---

## Next Steps

- See Core API for system functions
- See Types for type definitions
- See React Adapter for setup
