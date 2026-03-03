/**
 * UI Module
 *
 * Handles UI state: notifications, toasts, loading indicators.
 *
 * This module demonstrates:
 * - Effects that react to state changes across modules using `crossModuleDeps`
 * - Derivations with cross-module access for computed views
 * - Own facts accessed via `facts.self.*`
 * - Cross-module facts via `facts.auth.*`, `facts.data.*`
 * - No constraints or resolvers - purely reactive UI state
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import type { Notification } from "../types";
import { authSchema } from "./auth";
import { dataSchema } from "./data";

// Clean schema - no namespace prefix needed!
export const uiSchema = {
  facts: {
    notifications: t.array<Notification>(),
    lastNotificationId: t.number(),
  },
  derivations: {
    hasNotifications: t.boolean(),
    latestNotification: t.object<Notification | null>(),
    // Cross-module derivation: computes from auth + data modules
    canShowDashboard: t.boolean(),
    statusSummary: t.string(),
  },
  events: {
    addNotification: {
      type: t.string<"success" | "error" | "info">(),
      message: t.string(),
    },
    dismissNotification: { id: t.string() },
    clearNotifications: {},
  },
  requirements: {},
} satisfies ModuleSchema;

export const uiModule = createModule("ui", {
  schema: uiSchema,

  // Declare cross-module dependencies for type-safe access
  // facts.self.* for own module, facts.auth.* and facts.data.* for cross-module
  crossModuleDeps: { auth: authSchema, data: dataSchema },

  init: (facts) => {
    facts.notifications = [];
    facts.lastNotificationId = 0;
  },

  // Derivations with cross-module access
  // - Own module: facts.self.*
  // - Cross-module: facts.auth.*, facts.data.*
  derive: {
    hasNotifications: (facts) => facts.self.notifications.length > 0,
    latestNotification: (facts) => {
      const notifications = facts.self.notifications;
      return notifications.length > 0
        ? notifications[notifications.length - 1]!
        : null;
    },
    // Cross-module derivation: can user see the dashboard?
    canShowDashboard: (facts) => {
      return facts.auth.isAuthenticated === true && facts.data.users.length > 0;
    },
    // Cross-module derivation: summarize system status
    statusSummary: (facts) => {
      const authStatus = facts.auth.isAuthenticated ? "logged in" : "guest";
      const userCount = facts.data.users.length;
      const notifCount = facts.self.notifications.length;
      return `${authStatus} | ${userCount} users | ${notifCount} notifications`;
    },
  },

  events: {
    addNotification: (facts, { type, message }) => {
      const id = `notif-${++facts.lastNotificationId}`;
      facts.notifications = [
        ...facts.notifications,
        { id, type, message, timestamp: Date.now() },
      ];
    },
    dismissNotification: (facts, { id }) => {
      facts.notifications = facts.notifications.filter((n) => n.id !== id);
    },
    clearNotifications: (facts) => {
      facts.notifications = [];
    },
  },

  // Effects to react to state changes in other modules
  // - Own module: facts.self.notifications
  // - Cross-module: facts.auth.*, facts.data.*
  effects: {
    // Show notification when login status changes
    onAuthStatusChange: {
      run: (facts, prev) => {
        // Type-safe cross-module access!
        const currentAuth = facts.auth.isAuthenticated;
        const prevAuth = prev?.auth.isAuthenticated;

        if (prevAuth !== undefined && currentAuth !== prevAuth) {
          if (currentAuth) {
            const userName = facts.auth.user?.name ?? "User";
            console.log(`[UI Effect] User logged in: ${userName}`);
          } else {
            console.log("[UI Effect] User logged out");
          }
        }
      },
    },

    // Show notification when data is loaded
    onDataLoaded: {
      run: (facts, prev) => {
        const currentStatus = facts.data.lastFetched;
        const prevStatus = prev?.data.lastFetched;

        if (currentStatus && !prevStatus) {
          const count = facts.data.users.length;
          console.log(`[UI Effect] Data loaded: ${count} users`);
        }
      },
    },

    // Show notification on error
    onDataError: {
      run: (facts, prev) => {
        const currentError = facts.data.error;
        const prevError = prev?.data.error;

        if (currentError && currentError !== prevError) {
          console.log(`[UI Effect] Error: ${currentError}`);
        }
      },
    },
  },
});
