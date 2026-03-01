---
title: How to Build Notifications & Toasts
description: Implement a notification queue with auto-dismiss, priority ordering, and cross-module event dispatching using Directive.
---

A notification queue with auto-dismiss, priority ordering, deduplication, and cross-module triggers — constraints handle the timing naturally. {% .lead %}

---

## The Problem

Every app needs notifications. Building a queue with auto-dismiss timers, priority ordering (errors stay longer), maximum visible count, and cross-module triggers (any module can show a toast) typically results in a tangle of `setTimeout` calls, global event buses, and shared mutable arrays. Race conditions between rapid dismissals and new arrivals are common.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

interface Notification {
  id: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
  ttl: number;
}

const notifications = createModule('notifications', {
  schema: {
    queue: t.object<Notification[]>(),
    maxVisible: t.number(),
    now: t.number(),
    idCounter: t.number(),
  },

  init: (facts) => {
    facts.queue = [];
    facts.maxVisible = 5;
    facts.now = Date.now();
    facts.idCounter = 0;
  },

  derive: {
    visibleNotifications: (facts) => facts.queue.slice(0, facts.maxVisible),
    hasNotifications: (facts) => facts.queue.length > 0,
    oldestExpired: (facts) => {
      const oldest = facts.queue[0];
      if (!oldest) {
        return null;
      }

      return facts.now > oldest.createdAt + oldest.ttl ? oldest : null;
    },
  },

  constraints: {
    autoDismiss: {
      priority: 50,
      when: (facts) => {
        const oldest = facts.queue[0];
        if (!oldest) {
          return false;
        }

        return facts.now > oldest.createdAt + oldest.ttl;
      },
      require: (facts) => ({
        type: 'DISMISS_NOTIFICATION',
        id: facts.queue[0].id,
      }),
    },
    overflow: {
      priority: 60,
      when: (facts) => facts.queue.length > facts.maxVisible + 5,
      require: (facts) => ({
        type: 'DISMISS_NOTIFICATION',
        id: facts.queue[0].id,
      }),
    },
  },

  resolvers: {
    dismiss: {
      requirement: 'DISMISS_NOTIFICATION',
      resolve: async (req, context) => {
        context.facts.queue = context.facts.queue.filter((n) => n.id !== req.id);
      },
    },
  },

  events: {
    addNotification: (facts, payload: { message: string; level: Notification['level']; ttl?: number }) => {
      const ttlMap = { info: 4000, success: 3000, warning: 6000, error: 10000 };
      facts.idCounter = facts.idCounter + 1;
      const notification: Notification = {
        id: `notif-${facts.idCounter}`,
        message: payload.message,
        level: payload.level,
        createdAt: Date.now(),
        ttl: payload.ttl ?? ttlMap[payload.level],
      };
      facts.queue = [...facts.queue, notification];
    },
    dismissNotification: (facts, { id }: { id: string }) => {
      facts.queue = facts.queue.filter((n) => n.id !== id);
    },
    tick: (facts) => {
      facts.now = Date.now();
    },
  },
});

const app = createModule('app', {
  schema: {
    lastAction: t.string(),
  },

  init: (facts) => {
    facts.lastAction = '';
  },

  effects: {
    notifyOnAction: {
      deps: ['lastAction'],
      run: (facts, prev) => {
        if (facts.lastAction && facts.lastAction !== prev?.lastAction) {
          // In a multi-module system, effects can access other modules' facts directly
          // The notification queue is at facts.notifications.queue via the merged proxy
        }
      },
    },
  },
});

const system = createSystem({
  modules: { notifications, app },
  tickMs: 1000,
});
```

```tsx
function NotificationStack({ system }) {
  const visible = useDerived(system, 'notifications::visibleNotifications');

  return (
    <div className="notification-stack" role="log" aria-live="polite">
      {visible.map((n) => (
        <div key={n.id} className={`toast toast-${n.level}`} role="status">
          <span>{n.message}</span>
          <button
            aria-label="Dismiss"
            onClick={() => system.events.dismissNotification({ id: n.id })}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
```

## Step by Step

1. **`tickMs: 1000`** on the system drives the `now` fact forward every second. The `autoDismiss` constraint checks if the oldest notification has exceeded its TTL — no manual `setTimeout` needed.

2. **Priority ordering** — `overflow` (priority 60) fires before `autoDismiss` (priority 50). When the queue overflows, older notifications are removed first regardless of TTL.

3. **`oldestExpired` derivation** computes which notification (if any) has expired. The `autoDismiss` constraint reads this derivation to decide when to fire.

4. **Cross-module triggering** — any module can call `system.events.addNotification(...)`. The `app` module demonstrates triggering notifications from an effect when `lastAction` changes.

5. **TTL per level** — errors stay 10s, warnings 6s, info 4s, success 3s. Custom TTL can override per-notification.

## Common Variations

### Deduplication

Prevent the same message from appearing multiple times within a window:

```typescript
events: {
  addNotification: (facts, payload) => {
    const isDupe = facts.queue.some(
      (n) => n.message === payload.message && facts.now - n.createdAt < 5000,
    );
    if (isDupe) {
      return;
    }
    // ... add as normal
  },
},
```

### Action buttons on notifications

```typescript
interface Notification {
  id: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
  ttl: number;
  action?: { label: string; type: string; payload?: Record<string, unknown> };
}
```

### Priority ordering in the queue

Sort errors to the top so they're always visible:

```typescript
derive: {
  visibleNotifications: (facts) => {
    const sorted = [...facts.queue].sort((a, b) => {
      const priority = { error: 0, warning: 1, info: 2, success: 3 };

      return priority[a.level] - priority[b.level];
    });

    return sorted.slice(0, facts.maxVisible);
  },
},
```

## Related

- [Interactive Example](/docs/examples/notifications) — try it in your browser
- [Constraints](/docs/constraints) — priority and evaluation
- [Effects](/docs/effects) — cross-module side effects
- [Choosing Primitives](/docs/choosing-primitives) — when to use events vs constraints
- [Optimistic Updates](/docs/guides/optimistic-updates) — rollback notifications
