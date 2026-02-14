---
title: How to Optimize React Re-Renders
description: Pick the right Directive hook and derivation pattern to minimize unnecessary React re-renders.
---

Pick the right hook and derivation pattern to minimize React re-renders. {% .lead %}

---

## The Problem

Directive integrates with React via `useSyncExternalStore`, which means every fact or derivation change triggers a re-render in subscribed components. If your component subscribes to the entire facts object but only uses one field, unrelated fact changes cause unnecessary re-renders. In lists with hundreds of items, this becomes visible jank.

## The Solution

```tsx
import { useDirective, useSelector, useFact, useDerived } from 'directive/react';

// ❌ BAD: Re-renders on ANY fact change
function BadProfile({ system }) {
  const { facts } = useDirective(system);

  return <span>{facts.user.name}</span>;
}

// ✅ GOOD: Re-renders only when user.name changes
function GoodProfile({ system }) {
  const name = useSelector(system, (facts) => facts.user.name);

  return <span>{name}</span>;
}

// ✅ GOOD: Re-renders only when the `user` fact changes
function UserCard({ system }) {
  const user = useFact(system, 'user');

  return (
    <div>
      <span>{user.name}</span>
      <span>{user.role}</span>
    </div>
  );
}

// ✅ GOOD: Re-renders only when the derived value changes
function CartBadge({ system }) {
  const itemCount = useDerived(system, 'itemCount');

  return <Badge count={itemCount} />;
}
```

### Hook Selection Guide

```tsx
// Use useSelector for computed/transformed values
const fullName = useSelector(system, (facts) => `${facts.first} ${facts.last}`);

// Use useFact for a single fact by key
const items = useFact(system, 'items');

// Use useDerived for module-defined derivations
const isExpired = useDerived(system, 'isExpired');

// Use useDirective only when you need multiple facts + derived together
const { facts, derived } = useDirective(system);
```

## Step by Step

1. **`useSelector` is the default choice** – it accepts a selector function and only re-renders when the return value changes (via `Object.is`). Use it for any computed or plucked value.

2. **`useFact` is shorthand for a single fact** – `useFact(system, 'user')` is equivalent to `useSelector(system, (f) => f.user)` but more readable when you just need one field.

3. **`useDerived` subscribes to derivations** – derivations are cached and only recompute when their tracked dependencies change. Subscribing to a derivation is always cheaper than computing the same value in a selector.

4. **`useDirective` subscribes to everything** – use it only in top-level containers that genuinely need multiple facts and derivations, not in leaf components.

## Common Variations

### Custom equality for objects

```tsx
import { shallowEqual } from 'directive/react';

// Without custom equality: re-renders when any item in the array changes identity
const items = useSelector(system, (facts) => facts.items);

// With shallowEqual: only re-renders when the array contents actually differ
const items = useSelector(
  system,
  (facts) => facts.items,
  shallowEqual,
);
```

### Derivation composition instead of inline selectors

```typescript
// Instead of complex selectors in components...
const expensiveValue = useSelector(system, (facts) => {
  return facts.items.filter(i => i.active).map(i => i.price).reduce((a, b) => a + b, 0);
});

// ...define a derivation in the module (cached, shared across components)
derive: {
  activeTotal: (facts) =>
    facts.items.filter(i => i.active).reduce((sum, i) => sum + i.price, 0),
},

// Then subscribe to it
const activeTotal = useDerived(system, 'activeTotal');
```

### Memoizing list items

```tsx
const TodoItem = memo(function TodoItem({ item, system }) {
  // Each item component only subscribes to what it needs
  const toggleStatus = useRequirementStatus(system, 'TOGGLE_TODO');

  return (
    <li style={{ opacity: toggleStatus.isPendingFor(item.id) ? 0.6 : 1 }}>
      {item.text}
    </li>
  );
});

function TodoList({ system }) {
  const items = useFact(system, 'items');

  return (
    <ul>
      {items.map((item) => (
        <TodoItem key={item.id} item={item} system={system} />
      ))}
    </ul>
  );
}
```

## Related

- [React Hooks](/docs/api/react) – full hook API reference
- [Derivations](/docs/derivations) – auto-tracking and composition
- [Facts](/docs/facts) – proxy-based access patterns
- [Loading & Error States](/docs/how-to/loading-states) – `useRequirementStatus` patterns
