---
title: How to Handle Optimistic Updates
description: Apply optimistic mutations with automatic rollback on server failure using Directive.
---

Instant UI updates with automatic rollback when the server rejects the change. {% .lead %}

---

## The Problem

Users expect instant feedback when they toggle a setting, like a post, or reorder a list. Without optimistic updates, the UI waits for the server round-trip, making the app feel sluggish. But naively updating local state before the server responds creates a harder problem: what happens when the server fails? You need to snapshot the previous state, apply the optimistic change, and roll back cleanly on failure – all without race conditions from concurrent operations.

## The Solution

```typescript
import { createModule, t } from '@directive-run/core';

const todos = createModule('todos', {
  schema: {
    facts: {
      items: t.array<{ id: string; text: string; done: boolean }>(),
      toggleId: t.string(),
      deleteId: t.string(),
    },
  },

  init: (facts) => {
    facts.items = [];
    facts.toggleId = '';
    facts.deleteId = '';
  },

  events: {
    toggleTodo: (facts, { id }: { id: string }) => {
      facts.toggleId = id;
    },
    deleteTodo: (facts, { id }: { id: string }) => {
      facts.deleteId = id;
    },
  },

  constraints: {
    needsToggle: {
      when: (facts) => facts.toggleId !== '',
      require: (facts) => ({ type: 'TOGGLE_TODO', id: facts.toggleId }),
    },
    needsDelete: {
      when: (facts) => facts.deleteId !== '',
      require: (facts) => ({ type: 'DELETE_TODO', id: facts.deleteId }),
    },
  },

  resolvers: {
    toggleTodo: {
      requirement: 'TOGGLE_TODO',
      key: (req) => `toggle-${req.id}`,
      resolve: async (req, context) => {
        // 1. Snapshot current state for rollback
        const snapshot = context.snapshot();
        const item = context.facts.items.find((i) => i.id === req.id);
        if (!item) {
          return;
        }

        // 2. Apply optimistic update immediately
        context.facts.items = context.facts.items.map((i) =>
          i.id === req.id ? { ...i, done: !i.done } : i,
        );
        context.facts.toggleId = '';

        try {
          // 3. Sync with server
          const res = await fetch(`/api/todos/${req.id}/toggle`, {
            method: 'PATCH',
          });
          if (!res.ok) {
            throw new Error('Server rejected update');
          }
        } catch (error) {
          // 4. Rollback on failure using snapshot.get()
          context.facts.items = snapshot.get('items')!;
          throw error; // Re-throw so status reflects the failure
        }
      },
    },
    deleteTodo: {
      requirement: 'DELETE_TODO',
      key: (req) => `delete-${req.id}`,
      resolve: async (req, context) => {
        const snapshot = context.snapshot();
        // Optimistically remove
        context.facts.items = context.facts.items.filter((i) => i.id !== req.id);
        context.facts.deleteId = '';

        try {
          const res = await fetch(`/api/todos/${req.id}`, {
            method: 'DELETE',
          });
          if (!res.ok) {
            throw new Error('Failed to delete');
          }
        } catch (error) {
          context.facts.items = snapshot.get('items')!;
          throw error;
        }
      },
    },
  },
});
```

```tsx
import { useSelector } from '@directive-run/react';

function TodoList({ system }) {
  const items = useSelector(system, (facts) => facts.items);

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <input
            type="checkbox"
            checked={item.done}
            onChange={() =>
              system.events.todos.toggleTodo({ id: item.id })
            }
          />
          {item.text}
        </li>
      ))}
    </ul>
  );
}
```

## Step by Step

1. **`context.snapshot()`** captures the current facts state before any mutation. This is a deep copy, so it's safe regardless of subsequent changes.

2. **Optimistic mutation** happens synchronously inside the resolver, before the `await`. The UI sees the change immediately because fact updates trigger re-renders.

3. **Server sync** runs in the background. If it succeeds, the optimistic state becomes the real state – nothing more to do.

4. **`snapshot.get(key)`** retrieves the pre-mutation value for a specific fact. Assign it back to roll back the change. The UI automatically reverts.

5. **`key` deduplicates** concurrent operations – toggling the same todo twice doesn't create two in-flight requests. The second dispatch waits for or replaces the first.

## Common Variations

### Optimistic with server-provided data

```typescript
resolve: async (req, context) => {
  const snapshot = context.snapshot();

  // Optimistic: use local data
  context.facts.items = [...context.facts.items, { id: 'temp', text: req.text, done: false }];

  try {
    const res = await fetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ text: req.text }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create todo: ${res.status}`);
    }

    const created = await res.json();
    // Replace optimistic entry with server data (real ID, timestamps, etc.)
    context.facts.items = context.facts.items.map((i) =>
      i.id === 'temp' ? created : i,
    );
  } catch (error) {
    context.facts.items = snapshot.get('items')!;
    throw error;
  }
},
```

### Toast notification on rollback

```typescript
resolve: async (req, context) => {
  const snapshot = context.snapshot();
  context.facts.items = context.facts.items.filter((i) => i.id !== req.id);

  try {
    const res = await fetch(`/api/todos/${encodeURIComponent(req.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error(`Failed to delete: ${res.status}`);
    }
  } catch (error) {
    context.facts.items = snapshot.get('items')!;
    context.facts.toastMessage = 'Failed to delete – change reverted';
    throw error;
  }
},
```

## Related

- [Resolvers](/docs/resolvers) – `key`, retry policies, and `context.snapshot()`
- [Loading & Error States](/docs/guides/loading-states) – tracking pending operations
- [Batch Mutations](/docs/guides/batch-mutations) – atomic multi-field updates
- [React Hooks](/docs/api/react) – `useOptimisticUpdate` reference
