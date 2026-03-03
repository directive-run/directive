// @ts-nocheck
/**
 * Notification Definitions & System Singleton
 *
 * Add or remove notifications by editing NOTIFICATION_DEFS.
 * Each entry is a static definition – only dismissal state is reactive.
 */
import { STORAGE_KEYS, safeGetItem } from "@/lib/storage-keys";
import { createSystem } from "@directive-run/core";
import { notifications } from "./module";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationDef {
  id: string;
  type: "warning" | "info" | "success" | "error";
  icon: "megaphone" | "info" | "check-circle" | "warning";
  message: string;
  linkText?: string;
  linkHref?: string;
  dismissable: boolean;
}

// ---------------------------------------------------------------------------
// Definitions (single source of truth)
// ---------------------------------------------------------------------------

export const NOTIFICATION_DEFS: NotificationDef[] = [
  {
    id: "beta-notice",
    type: "warning",
    icon: "megaphone",
    message:
      "Directive is in public beta \u2013 the API may change before v1.0.",
    linkText: "View the docs",
    linkHref: "/docs/quick-start",
    dismissable: true,
  },
  {
    id: "pre-release",
    type: "info",
    icon: "info",
    message:
      "You\u2019re early. Like, mass-adoption-hasn\u2019t-happened-yet early. Welcome to the good timeline.",
    linkText: "Star us on GitHub",
    linkHref: "https://github.com/directive-run/directive",
    dismissable: true,
  },
];

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ReturnType<
  typeof createSystem<(typeof notifications)["schema"]>
> | null = null;

export function getNotificationSystem() {
  if (instance) {
    return instance;
  }

  instance = createSystem({ module: notifications });
  instance.start();

  // Hydrate dismissed IDs from localStorage
  const raw = safeGetItem(STORAGE_KEYS.DISMISSED_NOTIFICATIONS);
  if (raw) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) {
        instance.events.hydrateDismissed({ ids });
      }
    } catch {
      // Corrupted data – start fresh
    }
  }

  return instance;
}
