// @ts-nocheck
/**
 * Notification Banner Directive Module
 *
 * Manages dismissal state for top-of-page notification banners.
 * Notification definitions live in config.ts – only dismissal tracking
 * is reactive state.
 */
import { createModule, t } from '@directive-run/core'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { NOTIFICATION_DEFS, type NotificationDef } from './config'

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const notifications = createModule('notifications', {
  schema: {
    facts: {
      dismissedIds: t.array(t.string()),
    },
    derivations: {
      visibleNotifications: t.array<NotificationDef>(),
      hasVisible: t.boolean(),
    },
    events: {
      dismiss: { id: t.string() },
      hydrateDismissed: { ids: t.array(t.string()) },
    },
  },

  init: (facts) => {
    facts.dismissedIds = []
  },

  derive: {
    visibleNotifications: (facts) =>
      NOTIFICATION_DEFS.filter((n) => !facts.dismissedIds.includes(n.id)),
    hasVisible: (facts) =>
      NOTIFICATION_DEFS.some((n) => !facts.dismissedIds.includes(n.id)),
  },

  events: {
    dismiss: (facts, { id }) => {
      if (!facts.dismissedIds.includes(id)) {
        facts.dismissedIds = [...facts.dismissedIds, id]
      }
    },
    hydrateDismissed: (facts, { ids }) => {
      facts.dismissedIds = ids
    },
  },

  effects: {
    persistDismissed: {
      deps: ['dismissedIds'],
      run: (facts, prev) => {
        if (!prev) {
          return
        }

        try {
          localStorage.setItem(
            STORAGE_KEYS.DISMISSED_NOTIFICATIONS,
            JSON.stringify(facts.dismissedIds),
          )
        } catch {
          // localStorage unavailable
        }
      },
    },
  },
})
