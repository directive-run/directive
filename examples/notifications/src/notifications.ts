/**
 * Notifications & Toasts — Directive Modules
 *
 * Two modules:
 * - notifications: queue management, auto-dismiss via constraints, overflow protection
 * - app: action log that triggers cross-module notifications via effects
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";

// ============================================================================
// Types
// ============================================================================

export interface Notification {
  id: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
  createdAt: number;
  ttl: number;
}

// ============================================================================
// Notifications Module
// ============================================================================

export const notificationsSchema = {
  facts: {
    queue: t.object<Notification[]>(),
    maxVisible: t.number(),
    now: t.number(),
    idCounter: t.number(),
  },
  derivations: {
    visibleNotifications: t.object<Notification[]>(),
    hasNotifications: t.boolean(),
    oldestExpired: t.object<Notification | null>(),
  },
  events: {
    addNotification: {
      message: t.string(),
      level: t.string(),
      ttl: t.number().optional(),
    },
    dismissNotification: { id: t.string() },
    tick: {},
    setMaxVisible: { value: t.number() },
  },
  requirements: {
    DISMISS_NOTIFICATION: { id: t.string() },
  },
} satisfies ModuleSchema;

export const notificationsModule = createModule("notifications", {
  schema: notificationsSchema,

  init: (facts) => {
    facts.queue = [];
    facts.maxVisible = 5;
    facts.now = Date.now();
    facts.idCounter = 0;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    visibleNotifications: (facts) => {
      return (facts.queue as Notification[]).slice(
        0,
        facts.maxVisible as number,
      );
    },

    hasNotifications: (facts) => {
      return (facts.queue as Notification[]).length > 0;
    },

    oldestExpired: (facts) => {
      const queue = facts.queue as Notification[];
      const oldest = queue[0];
      if (!oldest) {
        return null;
      }

      if ((facts.now as number) > oldest.createdAt + oldest.ttl) {
        return oldest;
      }

      return null;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    autoDismiss: {
      priority: 50,
      when: (_facts, derive) => derive.oldestExpired !== null,
      require: (_facts, derive) => ({
        type: "DISMISS_NOTIFICATION" as const,
        id: (derive.oldestExpired as Notification).id,
      }),
    },

    overflow: {
      priority: 60,
      when: (facts) => {
        const queue = facts.queue as Notification[];

        return queue.length > (facts.maxVisible as number) + 5;
      },
      require: (facts) => ({
        type: "DISMISS_NOTIFICATION" as const,
        id: (facts.queue as Notification[])[0].id,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    dismiss: {
      requirement: "DISMISS_NOTIFICATION",
      resolve: async (req, context) => {
        context.facts.queue = (context.facts.queue as Notification[]).filter(
          (n) => n.id !== req.id,
        );
      },
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    addNotification: (
      facts,
      payload: { message: string; level: string; ttl?: number },
    ) => {
      const ttlMap: Record<string, number> = {
        info: 4000,
        success: 3000,
        warning: 6000,
        error: 10000,
      };
      const counter = (facts.idCounter as number) + 1;
      facts.idCounter = counter;

      const notification: Notification = {
        id: `notif-${counter}`,
        message: payload.message,
        level: payload.level as Notification["level"],
        createdAt: Date.now(),
        ttl: payload.ttl ?? ttlMap[payload.level] ?? 4000,
      };

      facts.queue = [...(facts.queue as Notification[]), notification];
    },

    dismissNotification: (facts, { id }: { id: string }) => {
      facts.queue = (facts.queue as Notification[]).filter((n) => n.id !== id);
    },

    tick: (facts) => {
      facts.now = Date.now();
    },

    setMaxVisible: (facts, { value }: { value: number }) => {
      facts.maxVisible = value;
    },
  },
});

// ============================================================================
// App Module
// ============================================================================

export const appSchema = {
  facts: {
    actionLog: t.object<string[]>(),
  },
  events: {
    simulateAction: { message: t.string(), level: t.string() },
  },
} satisfies ModuleSchema;

export const appModule = createModule("app", {
  schema: appSchema,

  init: (facts) => {
    facts.actionLog = [];
  },

  events: {
    simulateAction: (facts, { message }: { message: string }) => {
      facts.actionLog = [...(facts.actionLog as string[]), message];
    },
  },
});
