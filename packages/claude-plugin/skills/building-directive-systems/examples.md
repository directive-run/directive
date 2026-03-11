# Examples

> Auto-generated from extracted examples. Do not edit manually.

## multi-module

```typescript
// Example: multi-module
// Source: examples/multi-module/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Multi-Module Example - Main Entry Point
 *
 * Demonstrates the NEW namespaced module access:
 * - `system.facts.auth.token` instead of `system.facts.auth_token`
 * - `system.derive.data.userCount` instead of `system.derive.data_userCount`
 * - `system.events.auth.login({ token })` instead of `dispatch({ type: "auth_login", token })`
 *
 * Cross-module constraints work automatically:
 * - Data fetches when auth succeeds
 * - No asCombined() helper needed
 */

import { el } from "@directive-run/el";
import { getFacts, system } from "./system";

// DOM Elements

// Start the system
system.start();

// Update UI function

// Subscribe to derivation changes using namespaced keys
// Note: The internal keys are still prefixed (auth_status), so we use those for subscribe
system.subscribe(
  [
    "auth_status",
    "auth_displayName",
    "data_status",
    "data_userCount",
    "ui_hasNotifications",
  ],
  () => {
    updateUI();
  },
);

// Also update on fact changes via polling (simple approach for this demo)

// Event handlers using namespaced events accessor


// Initial render
updateUI();

// Log to console for debugging
console.log("Multi-Module Example Started (Namespaced Mode)");
console.log("Try clicking Login to see the cross-module constraint in action:");
console.log("1. Auth module validates token via facts.auth.*");
console.log(
  "2. Data module automatically fetches users when facts.auth.isAuthenticated",
);
console.log("3. UI module effects react to facts.data.* changes");
```

## dynamic-modules

```typescript
// Example: dynamic-modules
// Source: examples/dynamic-modules/src/modules.ts
// Pure module file — no DOM wiring

/**
 * Dynamic Modules — Directive Module Definitions
 *
 * Dashboard module (always loaded) + 3 dynamic modules (Counter, Weather, Dice).
 * Demonstrates runtime module registration, namespaced fact access,
 * constraints, resolvers, and derivations across independent modules.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { mockFetchWeather } from "./mock-weather.js";

// ============================================================================
// Types
// ============================================================================

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, detail });
  if (log.length > 50) {
    log.splice(0, log.length - 50);
  }
  facts.eventLog = log;
}

// ============================================================================
// Dashboard Module (core, always loaded)
// ============================================================================

export const dashboardSchema = {
  facts: {
    loadedModules: t.array<string>(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    loadedCount: t.number(),
  },
  events: {
    moduleLoaded: { name: t.string() },
  },
  requirements: {},
} satisfies ModuleSchema;

export const dashboardModule = createModule("dashboard", {
  schema: dashboardSchema,

  init: (facts) => {
    facts.loadedModules = [];
    facts.eventLog = [];
  },

  derive: {
    loadedCount: (facts) => facts.loadedModules.length,
  },

  events: {
    moduleLoaded: (facts, { name }) => {
      facts.loadedModules = [...facts.loadedModules, name];
      addLogEntry(facts, "loaded", `Loaded "${name}" module`);
    },
  },
});

// ============================================================================
// Counter Module (dynamic)
// ============================================================================

export const counterSchema = {
  facts: {
    count: t.number(),
    step: t.number(),
  },
  derivations: {
    isNearMax: t.boolean(),
  },
  events: {
    increment: {},
    decrement: {},
    setStep: { value: t.number() },
  },
  requirements: {
    COUNTER_RESET: {},
  },
} satisfies ModuleSchema;

export const counterModule = createModule("counter", {
  schema: counterSchema,

  init: (facts) => {
    facts.count = 0;
    facts.step = 1;
  },

  derive: {
    isNearMax: (facts) => facts.count >= 90,
  },

  events: {
    increment: (facts) => {
      facts.count = facts.count + facts.step;
    },
    decrement: (facts) => {
      facts.count = Math.max(0, facts.count - facts.step);
    },
    setStep: (facts, { value }) => {
      facts.step = value;
    },
  },

  constraints: {
    overflow: {
      priority: 100,
      when: (facts) => facts.count >= 100,
      require: () => ({ type: "COUNTER_RESET" }),
    },
  },

  resolvers: {
    counterReset: {
      requirement: "COUNTER_RESET",
      resolve: async (_req, context) => {
        context.facts.count = 0;
      },
    },
  },
});

// ============================================================================
// Weather Module (dynamic)
// ============================================================================

export const weatherSchema = {
  facts: {
    city: t.string(),
    temperature: t.number(),
    condition: t.string(),
    humidity: t.number(),
    isLoading: t.boolean(),
    lastFetchedCity: t.string(),
  },
  derivations: {
    summary: t.string(),
    hasFetched: t.boolean(),
  },
  events: {
    setCity: { value: t.string() },
    refresh: {},
  },
  requirements: {
    FETCH_WEATHER: {
      city: t.string(),
    },
  },
} satisfies ModuleSchema;

export const weatherModule = createModule("weather", {
  schema: weatherSchema,

  init: (facts) => {
    facts.city = "";
    facts.temperature = 0;
    facts.condition = "";
    facts.humidity = 0;
    facts.isLoading = false;
    facts.lastFetchedCity = "";
  },

  derive: {
    summary: (facts) => {
      if (facts.city === "") {
        return "";
      }

      return `${facts.temperature}\u00B0F, ${facts.condition}`;
    },
    hasFetched: (facts) => facts.lastFetchedCity !== "",
  },

  events: {
    setCity: (facts, { value }) => {
      facts.city = value;
    },
    refresh: (facts) => {
      facts.lastFetchedCity = "";
    },
  },

  constraints: {
    needsFetch: {
      priority: 100,
      when: (facts) =>
        facts.city.length >= 2 &&
        facts.city !== facts.lastFetchedCity &&
        !facts.isLoading,
      require: (facts) => ({
        type: "FETCH_WEATHER",
        city: facts.city,
      }),
    },
  },

  resolvers: {
    fetchWeather: {
      requirement: "FETCH_WEATHER",
      key: (req) => `weather-${req.city}`,
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.isLoading = true;

        const data = await mockFetchWeather(req.city, 800);

        // Stale check: only apply if city still matches
        if (context.facts.city === req.city) {
          context.facts.temperature = data.temperature;
          context.facts.condition = data.condition;
          context.facts.humidity = data.humidity;
          context.facts.lastFetchedCity = req.city;
        }

        context.facts.isLoading = false;
      },
    },
  },
});

// ============================================================================
// Dice Module (dynamic)
// ============================================================================

export const diceSchema = {
  facts: {
    die1: t.number(),
    die2: t.number(),
    rollCount: t.number(),
  },
  derivations: {
    total: t.number(),
    isDoubles: t.boolean(),
  },
  events: {
    roll: {},
  },
  requirements: {},
} satisfies ModuleSchema;

export const diceModule = createModule("dice", {
  schema: diceSchema,

  init: (facts) => {
    facts.die1 = 1;
    facts.die2 = 1;
    facts.rollCount = 0;
  },

  derive: {
    total: (facts) => facts.die1 + facts.die2,
    isDoubles: (facts) => facts.die1 === facts.die2,
  },

  events: {
    roll: (facts) => {
      facts.die1 = Math.floor(Math.random() * 6) + 1;
      facts.die2 = Math.floor(Math.random() * 6) + 1;
      facts.rollCount = facts.rollCount + 1;
    },
  },
});

// ============================================================================
// Module Registry
// ============================================================================

export const moduleRegistry: Record<string, { module: any; label: string }> = {
  counter: { module: counterModule, label: "Counter" },
  weather: { module: weatherModule, label: "Weather" },
  dice: { module: diceModule, label: "Dice" },
};
```

## theme-locale

```typescript
// Example: theme-locale
// Source: examples/theme-locale/src/theme-locale.ts
// Pure module file — no DOM wiring

/**
 * Theme & Locale — Directive Modules
 *
 * Two modules:
 * - `preferences` — theme, locale, sidebar, translations, system dark preference
 * - `layout` — responsive breakpoint tracking
 *
 * Demonstrates multi-module composition, auto-tracked derivations,
 * effects for DOM side-effects, and persistence plugin for user prefs.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";

// ============================================================================
// Types
// ============================================================================

export interface Translations {
  greeting: string;
  settings: string;
  theme: string;
  language: string;
  sidebar: string;
}

export type ThemeChoice = "light" | "dark" | "system";
export type Breakpoint = "mobile" | "tablet" | "desktop";

// ============================================================================
// Translation data
// ============================================================================

const TRANSLATIONS: Record<string, Translations> = {
  en: {
    greeting: "Hello",
    settings: "Settings",
    theme: "Theme",
    language: "Language",
    sidebar: "Sidebar",
  },
  es: {
    greeting: "Hola",
    settings: "Configuraci\u00f3n",
    theme: "Tema",
    language: "Idioma",
    sidebar: "Barra lateral",
  },
  fr: {
    greeting: "Bonjour",
    settings: "Param\u00e8tres",
    theme: "Th\u00e8me",
    language: "Langue",
    sidebar: "Barre lat\u00e9rale",
  },
};

function getTranslations(locale: string): Translations {
  return TRANSLATIONS[locale] ?? TRANSLATIONS.en;
}

// ============================================================================
// Preferences Schema
// ============================================================================

export const preferencesSchema = {
  facts: {
    theme: t.string<ThemeChoice>(),
    locale: t.string(),
    sidebarOpen: t.boolean(),
    systemPrefersDark: t.boolean(),
    loadedLocale: t.string(),
    translations: t.object<Translations>(),
  },
  derivations: {
    effectiveTheme: t.string(),
    isRTL: t.boolean(),
  },
  events: {
    setTheme: { value: t.string() },
    setLocale: { value: t.string() },
    toggleSidebar: {},
    setSystemPreference: { value: t.boolean() },
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Layout Schema
// ============================================================================

export const layoutSchema = {
  facts: {
    breakpoint: t.string<Breakpoint>(),
  },
  derivations: {},
  events: {
    setBreakpoint: { value: t.string() },
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Preferences Module
// ============================================================================

export const preferencesModule = createModule("preferences", {
  schema: preferencesSchema,

  init: (facts) => {
    facts.theme = "system";
    facts.locale = "en";
    facts.sidebarOpen = true;
    facts.systemPrefersDark = false;
    facts.loadedLocale = "en";
    facts.translations = getTranslations("en");
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    effectiveTheme: (facts) => {
      if (facts.theme === "system") {
        return facts.systemPrefersDark ? "dark" : "light";
      }

      return facts.theme;
    },

    isRTL: (facts) => {
      const rtlLocales = ["ar", "he", "fa", "ur"];

      return rtlLocales.includes(facts.locale);
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setTheme: (facts, { value }) => {
      facts.theme = value as ThemeChoice;
    },

    setLocale: (facts, { value }) => {
      facts.locale = value;
      facts.loadedLocale = value;
      facts.translations = getTranslations(value);
    },

    toggleSidebar: (facts) => {
      facts.sidebarOpen = !facts.sidebarOpen;
    },

    setSystemPreference: (facts, { value }) => {
      facts.systemPrefersDark = value;
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    applyTheme: {
      run: (facts) => {
        const effective =
          facts.theme === "system"
            ? facts.systemPrefersDark
              ? "dark"
              : "light"
            : facts.theme;
        document.documentElement.setAttribute("data-theme", effective);
      },
    },
  },
});

// ============================================================================
// Layout Module
// ============================================================================

export const layoutModule = createModule("layout", {
  schema: layoutSchema,

  init: (facts) => {
    facts.breakpoint = "desktop";
  },

  events: {
    setBreakpoint: (facts, { value }) => {
      facts.breakpoint = value as Breakpoint;
    },
  },
});
```

## permissions

```typescript
// Example: permissions
// Source: examples/permissions/src/permissions.ts
// Pure module file — no DOM wiring

/**
 * Role-Based Permissions — Directive Modules
 *
 * Three modules demonstrate cross-module constraint resolution:
 * - auth: manages login state (role, userName, token)
 * - permissions: loads permissions based on auth role, derives capability flags
 * - content: manages articles with permission-gated actions
 *
 * The system uses `crossModuleDeps` so constraints in one module
 * can react to derivations/facts from another module.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  type Article,
  deleteArticle as apiDeleteArticle,
  fetchArticles as apiFetchArticles,
  fetchPermissions as apiFetchPermissions,
  publishArticle as apiPublishArticle,
} from "./mock-api.js";

// ============================================================================
// Preset Users
// ============================================================================

const presetUsers: Record<
  string,
  { userName: string; role: string; token: string }
> = {
  alice: { userName: "Alice", role: "admin", token: "tok-alice-admin" },
  bob: { userName: "Bob", role: "editor", token: "tok-bob-editor" },
  carol: { userName: "Carol", role: "viewer", token: "tok-carol-viewer" },
};

// ============================================================================
// Auth Module
// ============================================================================

export const authSchema = {
  facts: {
    role: t.string(),
    userName: t.string(),
    token: t.string(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
  },
  events: {
    login: { userId: t.string() },
    logout: {},
  },
  requirements: {},
} satisfies ModuleSchema;

export const authModule = createModule("auth", {
  schema: authSchema,

  init: (facts) => {
    facts.role = "";
    facts.userName = "";
    facts.token = "";
  },

  derive: {
    isAuthenticated: (facts) => facts.token !== "",
  },

  events: {
    login: (facts, { userId }) => {
      const preset = presetUsers[userId];
      if (!preset) {
        return;
      }

      facts.token = preset.token;
      facts.userName = preset.userName;
      facts.role = preset.role;
    },

    logout: (facts) => {
      facts.token = "";
      facts.userName = "";
      facts.role = "";
    },
  },
});

// ============================================================================
// Permissions Module
// ============================================================================

export const permissionsSchema = {
  facts: {
    permissions: t.array<string>(),
    loaded: t.boolean(),
  },
  derivations: {
    canEdit: t.boolean(),
    canPublish: t.boolean(),
    canDelete: t.boolean(),
    canManageUsers: t.boolean(),
    canViewAnalytics: t.boolean(),
    isAdmin: t.boolean(),
    permissionCount: t.number(),
  },
  events: {
    reset: {},
  },
  requirements: {
    FETCH_PERMISSIONS: { role: t.string() },
  },
} satisfies ModuleSchema;

export const permissionsModule = createModule("permissions", {
  schema: permissionsSchema,

  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.permissions = [];
    facts.loaded = false;
  },

  derive: {
    canEdit: (facts) => facts.self.permissions.includes("content.edit"),
    canPublish: (facts) => facts.self.permissions.includes("content.publish"),
    canDelete: (facts) => facts.self.permissions.includes("content.delete"),
    canManageUsers: (facts) => facts.self.permissions.includes("users.manage"),
    canViewAnalytics: (facts) =>
      facts.self.permissions.includes("analytics.view"),
    isAdmin: (_facts, derived) => derived.canManageUsers,
    permissionCount: (facts) => facts.self.permissions.length,
  },

  events: {
    reset: (facts) => {
      facts.permissions = [];
      facts.loaded = false;
    },
  },

  constraints: {
    loadPermissions: {
      when: (facts) => {
        return facts.auth.token !== "" && !facts.self.loaded;
      },
      require: (facts) => ({
        type: "FETCH_PERMISSIONS",
        role: facts.auth.role,
      }),
    },
  },

  resolvers: {
    fetchPermissions: {
      requirement: "FETCH_PERMISSIONS",
      timeout: 5000,
      resolve: async (req, context) => {
        const perms = await apiFetchPermissions(req.role);
        context.facts.permissions = perms;
        context.facts.loaded = true;
      },
    },
  },
});

// ============================================================================
// Content Module
// ============================================================================

export const contentSchema = {
  facts: {
    articles: t.array<Article>(),
    loaded: t.boolean(),
    publishRequested: t.string(),
    deleteRequested: t.string(),
    actionStatus: t.string(),
  },
  derivations: {},
  events: {
    requestPublish: { articleId: t.string() },
    requestDelete: { articleId: t.string() },
    clearAction: {},
  },
  requirements: {
    LOAD_CONTENT: {},
    PUBLISH_ARTICLE: { articleId: t.string() },
    DELETE_ARTICLE: { articleId: t.string() },
  },
} satisfies ModuleSchema;

export const contentModule = createModule("content", {
  schema: contentSchema,

  crossModuleDeps: { auth: authSchema, permissions: permissionsSchema },

  init: (facts) => {
    facts.articles = [];
    facts.loaded = false;
    facts.publishRequested = "";
    facts.deleteRequested = "";
    facts.actionStatus = "idle";
  },

  constraints: {
    loadContent: {
      when: (facts) => {
        return facts.auth.token !== "" && !facts.self.loaded;
      },
      require: { type: "LOAD_CONTENT" },
    },

    publishArticle: {
      when: (facts) => {
        return (
          facts.self.publishRequested !== "" &&
          facts.permissions.permissions.includes("content.publish")
        );
      },
      require: (facts) => ({
        type: "PUBLISH_ARTICLE",
        articleId: facts.self.publishRequested,
      }),
    },

    deleteArticle: {
      when: (facts) => {
        return (
          facts.self.deleteRequested !== "" &&
          facts.permissions.permissions.includes("content.delete")
        );
      },
      require: (facts) => ({
        type: "DELETE_ARTICLE",
        articleId: facts.self.deleteRequested,
      }),
    },
  },

  resolvers: {
    loadContent: {
      requirement: "LOAD_CONTENT",
      timeout: 5000,
      resolve: async (_req, context) => {
        const articles = await apiFetchArticles();
        context.facts.articles = articles;
        context.facts.loaded = true;
      },
    },

    publishArticle: {
      requirement: "PUBLISH_ARTICLE",
      timeout: 5000,
      resolve: async (req, context) => {
        context.facts.actionStatus = "publishing";
        await apiPublishArticle(req.articleId);

        context.facts.articles = context.facts.articles.map((a) => {
          if (a.id === req.articleId) {
            return { ...a, status: "published" as const };
          }

          return a;
        });
        context.facts.publishRequested = "";
        context.facts.actionStatus = "done";
      },
    },

    deleteArticle: {
      requirement: "DELETE_ARTICLE",
      timeout: 5000,
      resolve: async (req, context) => {
        context.facts.actionStatus = "deleting";
        await apiDeleteArticle(req.articleId);

        context.facts.articles = context.facts.articles.filter(
          (a) => a.id !== req.articleId,
        );
        context.facts.deleteRequested = "";
        context.facts.actionStatus = "done";
      },
    },
  },

  events: {
    requestPublish: (facts, { articleId }) => {
      facts.publishRequested = articleId;
      facts.actionStatus = "idle";
    },

    requestDelete: (facts, { articleId }) => {
      facts.deleteRequested = articleId;
      facts.actionStatus = "idle";
    },

    clearAction: (facts) => {
      facts.publishRequested = "";
      facts.deleteRequested = "";
      facts.actionStatus = "idle";
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: {
    auth: authModule,
    permissions: permissionsModule,
    content: contentModule,
  },
  trace: true,
  plugins: [devtoolsPlugin({ name: "permissions" })],
});
```

## notifications

```typescript
// Example: notifications
// Source: examples/notifications/src/notifications.ts
// Pure module file — no DOM wiring

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
    queue: t.array<Notification>(),
    maxVisible: t.number(),
    now: t.number(),
    idCounter: t.number(),
  },
  derivations: {
    visibleNotifications: t.array<Notification>(),
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
      return facts.queue.slice(0, facts.maxVisible);
    },

    hasNotifications: (facts) => {
      return facts.queue.length > 0;
    },

    oldestExpired: (facts) => {
      const oldest = facts.queue[0];
      if (!oldest) {
        return null;
      }

      if (facts.now > oldest.createdAt + oldest.ttl) {
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
      when: (facts) => {
        const oldest = facts.queue[0];
        if (!oldest) {
          return false;
        }

        return facts.now > oldest.createdAt + oldest.ttl;
      },
      require: (facts) => ({
        type: "DISMISS_NOTIFICATION" as const,
        id: facts.queue[0].id,
      }),
    },

    overflow: {
      priority: 60,
      when: (facts) => {
        return facts.queue.length > facts.maxVisible + 5;
      },
      require: (facts) => ({
        type: "DISMISS_NOTIFICATION" as const,
        id: facts.queue[0].id,
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
        context.facts.queue = context.facts.queue.filter(
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
      const counter = facts.idCounter + 1;
      facts.idCounter = counter;

      const notification: Notification = {
        id: `notif-${counter}`,
        message: payload.message,
        level: payload.level as Notification["level"],
        createdAt: Date.now(),
        ttl: payload.ttl ?? ttlMap[payload.level] ?? 4000,
      };

      facts.queue = [...facts.queue, notification];
    },

    dismissNotification: (facts, { id }: { id: string }) => {
      facts.queue = facts.queue.filter((n) => n.id !== id);
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
    actionLog: t.array<string>(),
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
      facts.actionLog = [...facts.actionLog, message];
    },
  },
});
```

## dashboard-loader

```typescript
// Example: dashboard-loader
// Source: examples/dashboard-loader/src/dashboard-loader.ts
// Pure module file — no DOM wiring

/**
 * Dashboard Loader — Directive Module
 *
 * Demonstrates loading & error states with concurrent resource fetching,
 * configurable delays/failure rates, retry with exponential backoff,
 * and combined status derivations.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type Permissions,
  type Preferences,
  type Profile,
  fetchMockPermissions,
  fetchMockPreferences,
  fetchMockProfile,
} from "./mock-api.js";

// ============================================================================
// Types
// ============================================================================

export type ResourceStatus = "idle" | "loading" | "success" | "error";

export interface ResourceState<T> {
  data: T | null;
  status: ResourceStatus;
  error: string | null;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface EventLogEntry {
  timestamp: number;
  event: string;
  resource: string;
  detail: string;
}

function makeIdleResource<T>(): ResourceState<T> {
  return {
    data: null,
    status: "idle",
    error: null,
    attempts: 0,
    startedAt: null,
    completedAt: null,
  };
}

// ============================================================================
// Schema
// ============================================================================

export const dashboardLoaderSchema = {
  facts: {
    userId: t.string(),
    profile: t.object<ResourceState<Profile>>(),
    preferences: t.object<ResourceState<Preferences>>(),
    permissions: t.object<ResourceState<Permissions>>(),
    profileDelay: t.number(),
    preferencesDelay: t.number(),
    permissionsDelay: t.number(),
    profileFailRate: t.number(),
    preferencesFailRate: t.number(),
    permissionsFailRate: t.number(),
    loadRequested: t.boolean(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    loadedCount: t.number(),
    totalResources: t.number(),
    allLoaded: t.boolean(),
    anyError: t.boolean(),
    anyLoading: t.boolean(),
    combinedStatus: t.string(),
    canStart: t.boolean(),
  },
  events: {
    setUserId: { value: t.string() },
    start: {},
    retryResource: { resource: t.string() },
    reloadAll: {},
    setDelay: { resource: t.string(), value: t.number() },
    setFailRate: { resource: t.string(), value: t.number() },
  },
  requirements: {
    FETCH_PROFILE: { userId: t.string() },
    FETCH_PREFERENCES: { userId: t.string() },
    FETCH_PERMISSIONS: { userId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(
  facts: any,
  event: string,
  resource: string,
  detail: string,
): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, resource, detail });
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const dashboardLoaderModule = createModule("dashboard-loader", {
  schema: dashboardLoaderSchema,

  init: (facts) => {
    facts.userId = "";
    facts.profile = makeIdleResource<Profile>();
    facts.preferences = makeIdleResource<Preferences>();
    facts.permissions = makeIdleResource<Permissions>();
    facts.profileDelay = 1000;
    facts.preferencesDelay = 1500;
    facts.permissionsDelay = 2000;
    facts.profileFailRate = 0;
    facts.preferencesFailRate = 0;
    facts.permissionsFailRate = 0;
    facts.loadRequested = false;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    loadedCount: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.filter((r) => r.status === "success").length;
    },

    totalResources: () => 3,

    allLoaded: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.every((r) => r.status === "success");
    },

    anyError: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.some((r) => r.status === "error");
    },

    anyLoading: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.some((r) => r.status === "loading");
    },

    combinedStatus: (facts, derived) => {
      const loaded = derived.loadedCount;
      const anyErr = derived.anyError;
      const anyLoad = derived.anyLoading;
      const allIdle = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].every((r: any) => r.status === "idle");

      if (allIdle) {
        return "Not started";
      }

      const errCount = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].filter((r: any) => r.status === "error").length;

      if (anyLoad) {
        return `Loading ${loaded} of 3...`;
      }

      if (anyErr && loaded > 0) {
        return `${errCount} failed, ${loaded} loaded`;
      }

      if (anyErr) {
        return `${errCount} failed`;
      }

      return "All loaded";
    },

    canStart: (facts) => {
      const id = facts.userId.trim();
      const allIdle = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].every((r: any) => r.status === "idle");

      return id.length > 0 && allIdle;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setUserId: (facts, { value }) => {
      facts.userId = value;
    },

    start: (facts) => {
      const id = facts.userId.trim();
      if (id.length === 0) {
        return;
      }

      // Reset all resources to idle so constraints re-fire
      facts.profile = makeIdleResource<Profile>();
      facts.preferences = makeIdleResource<Preferences>();
      facts.permissions = makeIdleResource<Permissions>();
      facts.loadRequested = true;
      facts.eventLog = [];
    },

    retryResource: (facts, { resource }) => {
      const res = (facts as any)[resource] as ResourceState<unknown>;
      if (!res || res.status !== "error") {
        return;
      }

      (facts as any)[resource] = {
        ...res,
        status: "idle",
        error: null,
      };
    },

    reloadAll: (facts) => {
      facts.profile = makeIdleResource<Profile>();
      facts.preferences = makeIdleResource<Preferences>();
      facts.permissions = makeIdleResource<Permissions>();
      facts.eventLog = [];
    },

    setDelay: (facts, { resource, value }) => {
      const key = `${resource}Delay` as keyof typeof facts;
      if (key in facts) {
        (facts as any)[key] = value;
      }
    },

    setFailRate: (facts, { resource, value }) => {
      const key = `${resource}FailRate` as keyof typeof facts;
      if (key in facts) {
        (facts as any)[key] = value;
      }
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsProfile: {
      priority: 100,
      when: (facts) => {
        const id = facts.userId.trim();
        const profile = facts.profile;

        return facts.loadRequested && id !== "" && profile.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PROFILE",
        userId: facts.userId.trim(),
      }),
    },

    needsPreferences: {
      priority: 90,
      when: (facts) => {
        const id = facts.userId.trim();
        const prefs = facts.preferences;

        return facts.loadRequested && id !== "" && prefs.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PREFERENCES",
        userId: facts.userId.trim(),
      }),
    },

    needsPermissions: {
      priority: 80,
      when: (facts) => {
        const id = facts.userId.trim();
        const perms = facts.permissions;

        return facts.loadRequested && id !== "" && perms.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PERMISSIONS",
        userId: facts.userId.trim(),
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 10000,
      resolve: async (req, context) => {
        const prev = context.facts.profile;
        context.facts.profile = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "profile",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockProfile(
            req.userId,
            context.facts.profileDelay,
            context.facts.profileFailRate,
          );
          context.facts.profile = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.profile.attempts,
            startedAt: context.facts.profile.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "success", "profile", data.name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.profile = {
            ...context.facts.profile,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "profile", msg);
          throw err;
        }
      },
    },

    fetchPreferences: {
      requirement: "FETCH_PREFERENCES",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        const prev = context.facts.preferences;
        context.facts.preferences = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "preferences",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockPreferences(
            req.userId,
            context.facts.preferencesDelay,
            context.facts.preferencesFailRate,
          );
          context.facts.preferences = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.preferences.attempts,
            startedAt: context.facts.preferences.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(
            context.facts,
            "success",
            "preferences",
            `${data.theme} / ${data.locale}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.preferences = {
            ...context.facts.preferences,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "preferences", msg);
          throw err;
        }
      },
    },

    fetchPermissions: {
      requirement: "FETCH_PERMISSIONS",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 15000,
      resolve: async (req, context) => {
        const prev = context.facts.permissions;
        context.facts.permissions = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "permissions",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockPermissions(
            req.userId,
            context.facts.permissionsDelay,
            context.facts.permissionsFailRate,
          );
          context.facts.permissions = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.permissions.attempts,
            startedAt: context.facts.permissions.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(
            context.facts,
            "success",
            "permissions",
            `${data.role} (${data.features.join(", ")})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.permissions = {
            ...context.facts.permissions,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "permissions", msg);
          throw err;
        }
      },
    },
  },
});
```

## pagination

```typescript
// Example: pagination
// Source: examples/pagination/src/pagination.ts
// Pure module file — no DOM wiring

/**
 * Pagination & Infinite Scroll — Directive Modules
 *
 * Two modules: `filters` owns search/sort/category,
 * `list` owns items and pagination state with crossModuleDeps.
 *
 * Constraints:
 * - loadMore: appends next page when scrollNearBottom
 * - filterChanged: resets and re-fetches when filters change
 *
 * Effects:
 * - observeScroll: IntersectionObserver on sentinel element
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin, loggingPlugin } from "@directive-run/core/plugins";
import { type ListItem, fetchPage } from "./mock-api.js";

// ============================================================================
// Filters Module
// ============================================================================

export const filtersSchema = {
  facts: {
    search: t.string(),
    sortBy: t.string<"newest" | "oldest" | "title">(),
    category: t.string(),
  },
  events: {
    setSearch: { value: t.string() },
    setSortBy: { value: t.string() },
    setCategory: { value: t.string() },
  },
} satisfies ModuleSchema;

export const filtersModule = createModule("filters", {
  schema: filtersSchema,

  init: (facts) => {
    facts.search = "";
    facts.sortBy = "newest";
    facts.category = "all";
  },

  events: {
    setSearch: (facts, { value }) => {
      facts.search = value;
    },
    setSortBy: (facts, { value }) => {
      facts.sortBy = value as "newest" | "oldest" | "title";
    },
    setCategory: (facts, { value }) => {
      facts.category = value;
    },
  },
});

// ============================================================================
// List Module
// ============================================================================

export const listSchema = {
  facts: {
    items: t.array<ListItem>(),
    cursor: t.string(),
    hasMore: t.boolean(),
    isLoadingMore: t.boolean(),
    scrollNearBottom: t.boolean(),
    lastFilterHash: t.string(),
  },
  derivations: {
    totalLoaded: t.number(),
    isEmpty: t.boolean(),
  },
  events: {
    setScrollNearBottom: { value: t.boolean() },
  },
  requirements: {
    LOAD_PAGE: {
      cursor: t.string(),
      search: t.string(),
      sortBy: t.string(),
      category: t.string(),
    },
    RESET_AND_LOAD: {
      search: t.string(),
      sortBy: t.string(),
      category: t.string(),
    },
  },
} satisfies ModuleSchema;

export const listModule = createModule("list", {
  schema: listSchema,

  crossModuleDeps: { filters: filtersSchema },

  init: (facts) => {
    facts.items = [];
    facts.cursor = "";
    facts.hasMore = true;
    facts.isLoadingMore = false;
    facts.scrollNearBottom = false;
    facts.lastFilterHash = "";
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    totalLoaded: (facts) => facts.self.items.length,
    isEmpty: (facts) => facts.self.items.length === 0 && !facts.self.hasMore,
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setScrollNearBottom: (facts, { value }) => {
      facts.scrollNearBottom = value;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    loadMore: {
      when: (facts) => {
        return (
          facts.self.hasMore &&
          !facts.self.isLoadingMore &&
          facts.self.scrollNearBottom
        );
      },
      require: (facts) => ({
        type: "LOAD_PAGE",
        cursor: facts.self.cursor,
        search: facts.filters.search,
        sortBy: facts.filters.sortBy,
        category: facts.filters.category,
      }),
    },

    filterChanged: {
      when: (facts) => {
        const hash = `${facts.filters.search}|${facts.filters.sortBy}|${facts.filters.category}`;

        return hash !== facts.self.lastFilterHash;
      },
      require: (facts) => ({
        type: "RESET_AND_LOAD",
        search: facts.filters.search,
        sortBy: facts.filters.sortBy,
        category: facts.filters.category,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    loadPage: {
      requirement: "LOAD_PAGE",
      resolve: async (req, context) => {
        context.facts.isLoadingMore = true;

        try {
          const data = await fetchPage(req.cursor, 20, {
            search: req.search,
            sortBy: req.sortBy,
            category: req.category,
          });

          context.facts.items = [...context.facts.items, ...data.items];
          context.facts.cursor = data.nextCursor;
          context.facts.hasMore = data.hasMore;
        } finally {
          context.facts.isLoadingMore = false;
        }
      },
    },

    resetAndLoad: {
      requirement: "RESET_AND_LOAD",
      resolve: async (req, context) => {
        const hash = `${req.search}|${req.sortBy}|${req.category}`;

        context.facts.items = [];
        context.facts.cursor = "";
        context.facts.hasMore = true;
        context.facts.isLoadingMore = true;
        context.facts.lastFilterHash = hash;

        try {
          const data = await fetchPage("", 20, {
            search: req.search,
            sortBy: req.sortBy,
            category: req.category,
          });

          context.facts.items = data.items;
          context.facts.cursor = data.nextCursor;
          context.facts.hasMore = data.hasMore;
        } finally {
          context.facts.isLoadingMore = false;
        }
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    observeScroll: {
      run: (facts) => {
        const sentinel = document.getElementById("pg-scroll-sentinel");
        if (!sentinel) {
          return;
        }

        const observer = new IntersectionObserver(
          ([entry]) => {
            facts.self.scrollNearBottom = entry.isIntersecting;
          },
          { rootMargin: "200px" },
        );
        observer.observe(sentinel);

        return () => observer.disconnect();
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: { filters: filtersModule, list: listModule },
  trace: true,
  plugins: [loggingPlugin(), devtoolsPlugin({ name: "pagination" })],
});
```

## url-sync

```typescript
// Example: url-sync
// Source: examples/url-sync/src/url-sync.ts
// Pure module file — no DOM wiring

/**
 * URL Sync — Directive Modules
 *
 * Two modules that synchronize URL query parameters with product filtering:
 * - **url module**: Reads/writes URL params, dispatches filter changes
 * - **products module**: Fetches filtered products via cross-module constraints
 *
 * Demonstrates bidirectional URL sync (popstate ↔ replaceState), cross-module
 * constraints, and resolver-driven data fetching with mock delay.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { type Product, allProducts, filterProducts } from "./mock-products.js";

// ============================================================================
// URL Module — Schema
// ============================================================================

export const urlSchema = {
  facts: {
    search: t.string(),
    category: t.string(),
    sortBy: t.string<"newest" | "price-asc" | "price-desc">(),
    page: t.number(),
    syncingFromUrl: t.boolean(),
  },
  derivations: {},
  events: {
    setSearch: { value: t.string() },
    setCategory: { value: t.string() },
    setSortBy: { value: t.string() },
    setPage: { value: t.number() },
    syncFromUrl: {
      search: t.string(),
      category: t.string(),
      sortBy: t.string(),
      page: t.number(),
    },
    syncComplete: {},
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// URL Module — Helpers
// ============================================================================

function readUrlParams(): {
  search: string;
  category: string;
  sortBy: string;
  page: number;
} {
  const params = new URLSearchParams(window.location.search);

  return {
    search: params.get("q") ?? "",
    category: params.get("cat") ?? "",
    sortBy: params.get("sort") ?? "newest",
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

// ============================================================================
// URL Module
// ============================================================================

export const urlModule = createModule("url", {
  schema: urlSchema,

  init: (facts) => {
    const params = readUrlParams();
    facts.search = params.search;
    facts.category = params.category;
    facts.sortBy = params.sortBy as "newest" | "price-asc" | "price-desc";
    facts.page = params.page;
    facts.syncingFromUrl = false;
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setSearch: (facts, { value }) => {
      facts.search = value;
      facts.page = 1;
    },

    setCategory: (facts, { value }) => {
      facts.category = value;
      facts.page = 1;
    },

    setSortBy: (facts, { value }) => {
      facts.sortBy = value as "newest" | "price-asc" | "price-desc";
      facts.page = 1;
    },

    setPage: (facts, { value }) => {
      facts.page = value;
    },

    syncFromUrl: (facts, { search, category, sortBy, page }) => {
      facts.syncingFromUrl = true;
      facts.search = search;
      facts.category = category;
      facts.sortBy = sortBy as "newest" | "price-asc" | "price-desc";
      facts.page = page;
    },

    syncComplete: (facts) => {
      facts.syncingFromUrl = false;
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    urlToState: {
      run: () => {
        const handler = () => {
          const params = readUrlParams();
          system.events.url.syncFromUrl({
            search: params.search,
            category: params.category,
            sortBy: params.sortBy,
            page: params.page,
          });
          system.events.url.syncComplete();
        };

        window.addEventListener("popstate", handler);

        return () => {
          window.removeEventListener("popstate", handler);
        };
      },
    },

    stateToUrl: {
      deps: ["search", "category", "sortBy", "page"],
      run: (facts) => {
        if (facts.syncingFromUrl) {
          return;
        }

        const params = new URLSearchParams();

        if (facts.search !== "") {
          params.set("q", facts.search);
        }
        if (facts.category !== "" && facts.category !== "all") {
          params.set("cat", facts.category);
        }
        if (facts.sortBy !== "newest") {
          params.set("sort", facts.sortBy);
        }
        if (facts.page > 1) {
          params.set("page", String(facts.page));
        }

        const search = params.toString();
        const newUrl = search
          ? `${window.location.pathname}?${search}`
          : window.location.pathname;

        if (newUrl !== `${window.location.pathname}${window.location.search}`) {
          history.replaceState(null, "", newUrl);
        }
      },
    },
  },
});

// ============================================================================
// Products Module — Schema
// ============================================================================

export const productsSchema = {
  facts: {
    items: t.array<Product>(),
    totalItems: t.number(),
    isLoading: t.boolean(),
    itemsPerPage: t.number(),
  },
  derivations: {
    totalPages: t.number(),
    currentPageDisplay: t.string(),
  },
  events: {
    setItemsPerPage: { value: t.number() },
  },
  requirements: {
    FETCH_PRODUCTS: {
      search: t.string(),
      category: t.string(),
      sortBy: t.string(),
      page: t.number(),
      itemsPerPage: t.number(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Products Module
// ============================================================================

export const productsModule = createModule("products", {
  schema: productsSchema,

  crossModuleDeps: { url: urlSchema },

  init: (facts) => {
    facts.items = [];
    facts.totalItems = 0;
    facts.isLoading = false;
    facts.itemsPerPage = 10;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    totalPages: (facts) => {
      if (facts.self.totalItems === 0) {
        return 0;
      }

      return Math.ceil(facts.self.totalItems / facts.self.itemsPerPage);
    },

    currentPageDisplay: (facts) => {
      const total = facts.self.totalItems;
      if (total === 0) {
        return "No results";
      }

      const page = facts.url.page;
      const perPage = facts.self.itemsPerPage;
      const start = (page - 1) * perPage + 1;
      const end = Math.min(page * perPage, total);

      return `${start}\u2013${end} of ${total}`;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setItemsPerPage: (facts, { value }) => {
      facts.itemsPerPage = value;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    fetchProducts: {
      priority: 100,
      when: () => true,
      require: (facts) => ({
        type: "FETCH_PRODUCTS",
        search: facts.url.search,
        category: facts.url.category,
        sortBy: facts.url.sortBy,
        page: facts.url.page,
        itemsPerPage: facts.self.itemsPerPage,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    fetchProducts: {
      requirement: "FETCH_PRODUCTS",
      key: (req) =>
        `fetch-${req.search}-${req.category}-${req.sortBy}-${req.page}-${req.itemsPerPage}`,
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.isLoading = true;

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 300));

        const result = filterProducts(allProducts, {
          search: req.search,
          category: req.category,
          sortBy: req.sortBy,
          page: req.page,
          itemsPerPage: req.itemsPerPage,
        });

        context.facts.items = result.items;
        context.facts.totalItems = result.totalItems;
        context.facts.isLoading = false;
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: {
    url: urlModule,
    products: productsModule,
  },
  trace: true,
  plugins: [devtoolsPlugin({ name: "url-sync" })],
});
```

## websocket

```typescript
// Example: websocket
// Source: examples/websocket/src/websocket.ts
// Pure module file — no DOM wiring

/**
 * WebSocket Connections — Directive Module
 *
 * Demonstrates resolver-driven connection lifecycle, automatic reconnection
 * via constraints with exponential backoff, live message streaming,
 * reconnect countdown via time-based reactivity, and cleanup functions.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { MockWebSocket, type WsMessage } from "./mock-ws.js";

// ============================================================================
// Types
// ============================================================================

export type WsStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Module-level socket reference
// ============================================================================

let activeSocket: MockWebSocket | null = null;

export function getActiveSocket(): MockWebSocket | null {
  return activeSocket;
}

// ============================================================================
// Schema
// ============================================================================

export const websocketSchema = {
  facts: {
    url: t.string(),
    status: t.string<WsStatus>(),
    connectRequested: t.boolean(),
    messages: t.array<WsMessage>(),
    retryCount: t.number(),
    maxRetries: t.number(),
    messageToSend: t.string(),
    now: t.number(),
    reconnectTargetTime: t.number(),
    messageRate: t.number(),
    connectFailRate: t.number(),
    reconnectFailRate: t.number(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    isConnected: t.boolean(),
    shouldReconnect: t.boolean(),
    reconnectDelay: t.number(),
    reconnectCountdown: t.number(),
    canSend: t.boolean(),
    messageCount: t.number(),
  },
  events: {
    requestConnect: {},
    disconnect: {},
    setMessageToSend: { value: t.string() },
    messageSent: {},
    setUrl: { value: t.string() },
    setMessageRate: { value: t.number() },
    setConnectFailRate: { value: t.number() },
    setReconnectFailRate: { value: t.number() },
    setMaxRetries: { value: t.number() },
    tick: {},
    clearMessages: {},
    forceError: {},
  },
  requirements: {
    CONNECT: {
      url: t.string(),
      messageRate: t.number(),
      connectFailRate: t.number(),
    },
    RECONNECT: {
      delay: t.number(),
      reconnectFailRate: t.number(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, detail });
  // Cap at 100
  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const websocketModule = createModule("websocket", {
  schema: websocketSchema,

  init: (facts) => {
    facts.url = "wss://demo.directive.run/chat";
    facts.status = "disconnected";
    facts.connectRequested = false;
    facts.messages = [];
    facts.retryCount = 0;
    facts.maxRetries = 5;
    facts.messageToSend = "";
    facts.now = Date.now();
    facts.reconnectTargetTime = 0;
    facts.messageRate = 3;
    facts.connectFailRate = 0;
    facts.reconnectFailRate = 0;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    isConnected: (facts) => facts.status === "connected",

    shouldReconnect: (facts) => {
      return (
        facts.status === "error" &&
        facts.retryCount < facts.maxRetries &&
        facts.connectRequested
      );
    },

    reconnectDelay: (facts) => {
      return Math.min(1000 * 2 ** facts.retryCount, 30000);
    },

    reconnectCountdown: (facts) => {
      if (facts.reconnectTargetTime <= 0) {
        return 0;
      }

      return Math.max(
        0,
        Math.ceil((facts.reconnectTargetTime - facts.now) / 1000),
      );
    },

    canSend: (facts) => {
      return facts.status === "connected" && facts.messageToSend.trim() !== "";
    },

    messageCount: (facts) => facts.messages.length,
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    requestConnect: (facts) => {
      facts.connectRequested = true;
      facts.status = "connecting";
      facts.retryCount = 0;
      facts.reconnectTargetTime = 0;
      facts.messages = [];
      facts.eventLog = [];
    },

    disconnect: (facts) => {
      facts.connectRequested = false;
      facts.status = "disconnected";
      facts.reconnectTargetTime = 0;

      // Null out before close() so the onclose handler's stale-socket guard works
      const socket = activeSocket;
      activeSocket = null;
      if (socket) {
        socket.close();
      }
    },

    setMessageToSend: (facts, { value }) => {
      facts.messageToSend = value;
    },

    messageSent: (facts) => {
      facts.messageToSend = "";
    },

    setUrl: (facts, { value }) => {
      facts.url = value;
    },

    setMessageRate: (facts, { value }) => {
      facts.messageRate = value;
    },

    setConnectFailRate: (facts, { value }) => {
      facts.connectFailRate = value;
    },

    setReconnectFailRate: (facts, { value }) => {
      facts.reconnectFailRate = value;
    },

    setMaxRetries: (facts, { value }) => {
      facts.maxRetries = value;
    },

    tick: (facts) => {
      facts.now = Date.now();
    },

    clearMessages: (facts) => {
      facts.messages = [];
    },

    forceError: (facts) => {
      facts.status = "error";

      // Null out before close() so the onclose handler's stale-socket guard works
      const socket = activeSocket;
      activeSocket = null;
      if (socket) {
        socket.close();
      }
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsConnection: {
      priority: 100,
      when: (facts) => {
        return facts.connectRequested && facts.status === "connecting";
      },
      require: (facts) => ({
        type: "CONNECT",
        url: facts.url,
        messageRate: facts.messageRate,
        connectFailRate: facts.connectFailRate,
      }),
    },

    needsReconnect: {
      priority: 90,
      when: (facts) => {
        return (
          facts.status === "error" &&
          facts.retryCount < facts.maxRetries &&
          facts.connectRequested
        );
      },
      require: (facts) => ({
        type: "RECONNECT",
        delay: Math.min(1000 * 2 ** facts.retryCount, 30000),
        reconnectFailRate: facts.reconnectFailRate,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    connect: {
      requirement: "CONNECT",
      timeout: 10000,
      resolve: async (req, context) => {
        addLogEntry(context.facts, "connect", `Connecting to ${req.url}...`);

        // Close any existing socket
        if (activeSocket) {
          activeSocket.close();
          activeSocket = null;
        }

        try {
          const socket = new MockWebSocket(
            req.url,
            req.connectFailRate,
            req.messageRate * 1000,
          );

          // Track this socket so we can detect stale callbacks
          activeSocket = socket;
          const currentSocket = socket;

          socket.onmessage = (msg) => {
            if (activeSocket !== currentSocket) {
              return;
            }

            const messages = [...context.facts.messages];
            messages.push(msg);
            // Cap at 50
            if (messages.length > 50) {
              messages.splice(0, messages.length - 50);
            }
            context.facts.messages = messages;
          };

          socket.onclose = () => {
            if (activeSocket !== currentSocket) {
              return;
            }

            context.facts.status = "disconnected";
            activeSocket = null;
            addLogEntry(context.facts, "close", "Connection closed");
          };

          socket.onerror = (error) => {
            if (activeSocket !== currentSocket) {
              return;
            }

            context.facts.status = "error";
            activeSocket = null;
            addLogEntry(context.facts, "error", error.message);
          };

          // Wait for connection to open
          await new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            const prevError = socket.onerror;
            socket.onerror = (error) => {
              prevError?.(error);
              reject(error);
            };
          });

          context.facts.status = "connected";
          context.facts.retryCount = 0;
          context.facts.reconnectTargetTime = 0;
          addLogEntry(context.facts, "connected", "Connection established");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.status = "error";
          activeSocket = null;
          addLogEntry(context.facts, "connect-error", msg);
          throw err;
        }
      },
    },

    reconnect: {
      requirement: "RECONNECT",
      timeout: 60000,
      resolve: async (req, context) => {
        const retryCount = context.facts.retryCount;
        context.facts.status = "reconnecting";
        context.facts.reconnectTargetTime = Date.now() + req.delay;
        addLogEntry(
          context.facts,
          "reconnect",
          `Waiting ${(req.delay / 1000).toFixed(1)}s (attempt ${retryCount + 1})...`,
        );

        await new Promise((resolve) => setTimeout(resolve, req.delay));

        context.facts.retryCount = retryCount + 1;
        context.facts.reconnectTargetTime = 0;
        context.facts.status = "connecting";
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logStatusChange: {
      deps: ["status"],
      run: (facts, prev) => {
        if (prev && prev.status !== facts.status) {
          addLogEntry(facts, "status", `${prev.status} \u2192 ${facts.status}`);
        }
      },
    },
  },
});
```

## server

```typescript
// Example: server
// Source: examples/server/src/server.ts
// Pure module file — no DOM wiring

/**
 * Directive Server Example
 *
 * An Express API demonstrating Directive's server-side features:
 * - Distributable snapshots with TTL
 * - Signed snapshot verification (HMAC-SHA256)
 * - Cryptographic audit trail
 * - GDPR/CCPA compliance tooling
 *
 * Run: npx tsx --watch src/server.ts
 */

import {
  createAuditTrail,
  createCompliance,
  createInMemoryComplianceStorage,
} from "@directive-run/ai";
import {
  createSystem,
  isSnapshotExpired,
  signSnapshot,
  verifySnapshotSignature,
} from "@directive-run/core";
import express from "express";
import { userProfile } from "./module.js";

const app = express();
app.use(express.json());

// ============================================================================
// Shared Infrastructure
// ============================================================================

const SIGNING_SECRET =
  process.env.SIGNING_SECRET ?? "dev-secret-change-in-production";

// Audit trail – shared across requests, acts as a Directive plugin
const audit = createAuditTrail({
  maxEntries: 10_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  piiMasking: {
    enabled: true,
    types: ["email", "name"],
    redactionStyle: "masked",
  },
});

// Compliance – in-memory storage for this example (use a DB adapter in production)
const compliance = createCompliance({
  storage: createInMemoryComplianceStorage(),
  consentPurposes: ["analytics", "marketing", "personalization"],
});

// In-memory snapshot cache (use Redis in production)
const snapshotCache = new Map<
  string,
  { snapshot: unknown; cachedAt: number }
>();
const CACHE_TTL_MS = 60_000; // 1 minute

// ============================================================================
// Helper: Per-Request System Factory
// ============================================================================

function createUserSystem(userId: string) {
  const system = createSystem({
    module: userProfile,
    plugins: [audit.createPlugin()],
  });

  system.start();
  system.events.loadUser({ userId });

  return system;
}

// ============================================================================
// GET /snapshot/:userId
// Distributable Snapshots with TTL
// ============================================================================

app.get("/snapshot/:userId", async (req, res) => {
  const { userId } = req.params;

  // Check cache first
  const cached = snapshotCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    res.json({ source: "cache", snapshot: cached.snapshot });

    return;
  }

  // Create a per-request system, settle it, then export a distributable snapshot
  const system = createUserSystem(userId);

  try {
    await system.settle(5000);

    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["effectivePlan", "canUseFeature", "isReady"],
      ttlSeconds: 3600,
    });

    // Cache it
    snapshotCache.set(userId, { snapshot, cachedAt: Date.now() });

    res.json({ source: "fresh", snapshot });
  } catch (error) {
    res.status(500).json({ error: "Failed to settle system" });
  } finally {
    system.destroy();
  }
});

// ============================================================================
// POST /snapshot/:userId/verify
// Signed Snapshot Verification
// ============================================================================

app.post("/snapshot/:userId/verify", async (req, res) => {
  const { snapshot } = req.body;

  if (!snapshot) {
    res.status(400).json({ error: "Missing snapshot in request body" });

    return;
  }

  // Sign a fresh snapshot for this user
  const system = createUserSystem(req.params.userId);

  try {
    await system.settle(5000);

    const freshSnapshot = system.getDistributableSnapshot({
      includeDerivations: ["effectivePlan", "canUseFeature", "isReady"],
      ttlSeconds: 3600,
    });

    // Sign the snapshot with HMAC-SHA256
    const signed = await signSnapshot(freshSnapshot, SIGNING_SECRET);

    // Verify the provided snapshot's signature
    if (snapshot.signature) {
      const isValid = await verifySnapshotSignature(snapshot, SIGNING_SECRET);
      const isExpired = isSnapshotExpired(snapshot);

      res.json({
        signatureValid: isValid,
        expired: isExpired,
        signedSnapshot: signed,
      });
    } else {
      // No signature on the incoming snapshot – just return a signed version
      res.json({
        signatureValid: null,
        expired: false,
        signedSnapshot: signed,
      });
    }
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  } finally {
    system.destroy();
  }
});

// ============================================================================
// GET /audit
// Query Audit Entries
// ============================================================================

app.get("/audit", (req, res) => {
  const { eventType, since, actorId, limit } = req.query;

  // biome-ignore lint/suspicious/noExplicitAny: eventType comes from query string
  const entries = audit.getEntries({
    eventTypes: eventType ? [eventType as any] : undefined,
    since: since ? Number(since) : undefined,
    actorId: actorId as string | undefined,
    limit: limit ? Number(limit) : 50,
  });

  res.json({
    count: entries.length,
    entries,
  });
});

// ============================================================================
// GET /audit/verify
// Verify Audit Hash Chain Integrity
// ============================================================================

app.get("/audit/verify", async (_req, res) => {
  const result = await audit.verifyChain();

  res.json({
    chainValid: result.valid,
    entriesVerified: result.entriesVerified,
    brokenAt: result.brokenAt ?? null,
    verifiedAt: new Date(result.verifiedAt).toISOString(),
  });
});

// ============================================================================
// POST /compliance/:subjectId/export
// GDPR Article 20 – Data Export
// ============================================================================

app.post("/compliance/:subjectId/export", async (req, res) => {
  const { subjectId } = req.params;

  // Record consent for analytics before exporting
  await compliance.consent.grant(subjectId, "analytics", {
    source: "api-request",
  });

  const result = await compliance.exportData({
    subjectId,
    format: "json",
    includeAudit: true,
  });

  if (result.success) {
    res.json({
      subjectId,
      exportedAt: new Date(result.exportedAt).toISOString(),
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : null,
      recordCount: result.recordCount,
      checksum: result.checksum,
      data: JSON.parse(result.data),
    });
  } else {
    res.status(500).json({ error: "Export failed" });
  }
});

// ============================================================================
// POST /compliance/:subjectId/delete
// GDPR Article 17 – Right to Erasure
// ============================================================================

app.post("/compliance/:subjectId/delete", async (req, res) => {
  const { subjectId } = req.params;
  const { reason } = req.body;

  const result = await compliance.deleteData({
    subjectId,
    scope: "all",
    reason: reason ?? "GDPR Article 17 request",
  });

  if (result.success) {
    res.json({
      subjectId,
      deletedAt: new Date(result.deletedAt).toISOString(),
      recordsAffected: result.recordsAffected,
      certificate: result.certificate,
    });
  } else {
    res.status(500).json({ error: "Deletion failed" });
  }
});

// ============================================================================
// GET /health
// Health Check
// ============================================================================

app.get("/health", (_req, res) => {
  const auditStats = audit.getStats();

  res.json({
    status: "ok",
    audit: {
      totalEntries: auditStats.totalEntries,
      oldestEntry: auditStats.oldestEntry
        ? new Date(auditStats.oldestEntry).toISOString()
        : null,
      newestEntry: auditStats.newestEntry
        ? new Date(auditStats.newestEntry).toISOString()
        : null,
      chainIntegrity: auditStats.chainIntegrity,
    },
  });
});

// ============================================================================
// Start
// ============================================================================

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
  console.log(`Directive server example running on http://localhost:${PORT}`);
  console.log();
  console.log("Endpoints:");
  console.log(
    "  GET  /snapshot/:userId           Distributable snapshot with TTL",
  );
  console.log("  POST /snapshot/:userId/verify     Sign and verify snapshots");
  console.log("  GET  /audit                      Query audit entries");
  console.log("  GET  /audit/verify               Verify hash chain integrity");
  console.log("  POST /compliance/:subjectId/export  GDPR data export");
  console.log("  POST /compliance/:subjectId/delete  GDPR right to erasure");
  console.log("  GET  /health                     Health check");
  console.log();
  console.log("Try: curl http://localhost:3000/snapshot/user-1");
});
```

## optimistic-updates

```typescript
// Example: optimistic-updates
// Source: examples/optimistic-updates/src/optimistic-updates.ts
// Pure module file — no DOM wiring

/**
 * Optimistic Updates — Directive Module
 *
 * Demonstrates optimistic mutations via events (instant UI), server sync via
 * constraint-resolver pattern, per-operation rollback from a sync queue,
 * resolver key deduplication, toast notifications, and context.snapshot().
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { mockServerSync } from "./mock-server.js";

// ============================================================================
// Types
// ============================================================================

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export type OpType = "toggle" | "delete" | "add";

export interface SyncQueueEntry {
  opId: string;
  itemId: string;
  op: OpType;
  undoItems: TodoItem[];
}

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// ID Generation
// ============================================================================

let nextId = 6; // items are pre-seeded 1-5
let nextOpId = 1;

// ============================================================================
// Schema
// ============================================================================

export const optimisticUpdatesSchema = {
  facts: {
    items: t.array<TodoItem>(),
    syncQueue: t.array<SyncQueueEntry>(),
    syncingOpId: t.string(),
    newItemText: t.string(),
    serverDelay: t.number(),
    failRate: t.number(),
    toastMessage: t.string(),
    toastType: t.string(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    totalCount: t.number(),
    doneCount: t.number(),
    pendingCount: t.number(),
    canAdd: t.boolean(),
    isSyncing: t.boolean(),
  },
  events: {
    toggleItem: { id: t.string() },
    deleteItem: { id: t.string() },
    addItem: {},
    setNewItemText: { value: t.string() },
    setServerDelay: { value: t.number() },
    setFailRate: { value: t.number() },
    dismissToast: {},
  },
  requirements: {
    SYNC_TODO: {
      opId: t.string(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...(facts.eventLog as EventLogEntry[])];
  log.push({ timestamp: Date.now(), event, detail });
  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const optimisticUpdatesModule = createModule("optimistic-updates", {
  schema: optimisticUpdatesSchema,

  init: (facts) => {
    facts.items = [
      { id: "1", text: "Buy groceries", done: false },
      { id: "2", text: "Learn Directive", done: true },
      { id: "3", text: "Walk the dog", done: false },
      { id: "4", text: "Read a book", done: false },
      { id: "5", text: "Fix the bug", done: true },
    ];
    facts.syncQueue = [];
    facts.syncingOpId = "";
    facts.newItemText = "";
    facts.serverDelay = 800;
    facts.failRate = 30;
    facts.toastMessage = "";
    facts.toastType = "";
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    totalCount: (facts) => facts.items.length,

    doneCount: (facts) => facts.items.filter((i) => i.done).length,

    pendingCount: (facts) => facts.syncQueue.length,

    canAdd: (facts) => facts.newItemText.trim() !== "",

    isSyncing: (facts) => facts.syncingOpId !== "",
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    toggleItem: (facts, { id }) => {
      const undoItems = facts.items.map((i) => ({ ...i }));

      facts.items = facts.items.map((i) =>
        i.id === id ? { ...i, done: !i.done } : i,
      );

      const opId = String(nextOpId++);
      const queue = [...facts.syncQueue];
      queue.push({ opId, itemId: id, op: "toggle", undoItems });
      facts.syncQueue = queue;

      addLogEntry(facts, "optimistic", `Toggle item ${id}`);
    },

    deleteItem: (facts, { id }) => {
      const undoItems = facts.items.map((i) => ({ ...i }));

      facts.items = facts.items.filter((i) => i.id !== id);

      const opId = String(nextOpId++);
      const queue = [...facts.syncQueue];
      queue.push({ opId, itemId: id, op: "delete", undoItems });
      facts.syncQueue = queue;

      addLogEntry(facts, "optimistic", `Delete item ${id}`);
    },

    addItem: (facts) => {
      const text = facts.newItemText.trim();
      if (!text) {
        return;
      }

      const undoItems = facts.items.map((i) => ({ ...i }));

      const itemId = String(nextId++);
      facts.items = [...facts.items, { id: itemId, text, done: false }];
      facts.newItemText = "";

      const opId = String(nextOpId++);
      const queue = [...facts.syncQueue];
      queue.push({ opId, itemId, op: "add", undoItems });
      facts.syncQueue = queue;

      addLogEntry(facts, "optimistic", `Add item "${text}"`);
    },

    setNewItemText: (facts, { value }) => {
      facts.newItemText = value;
    },

    setServerDelay: (facts, { value }) => {
      facts.serverDelay = value;
    },

    setFailRate: (facts, { value }) => {
      facts.failRate = value;
    },

    dismissToast: (facts) => {
      facts.toastMessage = "";
      facts.toastType = "";
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsSync: {
      priority: 100,
      when: (facts) => {
        return facts.syncQueue.length > 0 && facts.syncingOpId === "";
      },
      require: (facts) => {
        return {
          type: "SYNC_TODO",
          opId: facts.syncQueue[0].opId,
        };
      },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    syncTodo: {
      requirement: "SYNC_TODO",
      key: (req) => `sync-${req.opId}`,
      timeout: 10000,
      resolve: async (req, context) => {
        const entry = context.facts.syncQueue.find((e) => e.opId === req.opId);
        if (!entry) {
          return;
        }

        context.facts.syncingOpId = req.opId;
        addLogEntry(
          context.facts,
          "syncing",
          `Syncing ${entry.op} for item ${entry.itemId}...`,
        );

        const serverDelay = context.facts.serverDelay;
        const failRate = context.facts.failRate;

        try {
          await mockServerSync(entry.op, entry.itemId, serverDelay, failRate);

          addLogEntry(
            context.facts,
            "success",
            `${entry.op} item ${entry.itemId} synced`,
          );
          context.facts.toastMessage = `${entry.op} synced successfully`;
          context.facts.toastType = "success";
        } catch {
          context.facts.items = entry.undoItems;
          addLogEntry(
            context.facts,
            "rollback",
            `Failed to ${entry.op} item ${entry.itemId} — rolled back`,
          );
          context.facts.toastMessage = `Failed to ${entry.op} — rolled back`;
          context.facts.toastType = "error";
        }

        // Remove entry from queue
        context.facts.syncQueue = context.facts.syncQueue.filter(
          (e) => e.opId !== req.opId,
        );
        context.facts.syncingOpId = "";
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logSyncChange: {
      deps: ["syncingOpId"],
      run: (facts, prev) => {
        if (prev) {
          if (prev.syncingOpId === "" && facts.syncingOpId !== "") {
            addLogEntry(
              facts,
              "status",
              `Sync started: op ${facts.syncingOpId}`,
            );
          } else if (prev.syncingOpId !== "" && facts.syncingOpId === "") {
            addLogEntry(
              facts,
              "status",
              `Sync completed: op ${prev.syncingOpId}`,
            );
          }
        }
      },
    },
  },
});
```

## ab-testing

```typescript
// Example: ab-testing
// Source: examples/ab-testing/src/module.ts
// Pure module file — no DOM wiring

/**
 * A/B Testing Engine — Directive Module
 *
 * Types, schema, helpers, module definition, timeline, and system creation
 * for a constraint-driven A/B testing engine with deterministic hashing.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export interface Variant {
  id: string;
  weight: number;
  label: string;
}

export interface Experiment {
  id: string;
  name: string;
  variants: Variant[];
  active: boolean;
}

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

// ============================================================================
// Deterministic Hash
// ============================================================================

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  return Math.abs(hash);
}

function pickVariant(
  userId: string,
  experimentId: string,
  variants: Variant[],
): string {
  const hash = hashCode(`${userId}:${experimentId}`);
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let roll = hash % totalWeight;

  for (const variant of variants) {
    roll -= variant.weight;
    if (roll < 0) {
      return variant.id;
    }
  }

  return variants[variants.length - 1].id;
}

// ============================================================================
// Timeline
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addLog(type: "event" | "constraint" | "resolver", msg: string) {
  console.log(`[AB] [${type}] ${msg}`);

  // Classify for timeline
  let event = "";
  let detail = msg;
  let tlType = "register";

  if (msg.startsWith("Registered")) {
    event = "registered";
    detail = msg.replace("Registered experiment: ", "");
    tlType = "register";
  } else if (msg.startsWith("Assigned") || msg.includes("→")) {
    event = "assigned";
    detail = msg;
    tlType = "assign";
  } else if (msg.includes("Exposure tracked")) {
    event = "exposure";
    detail = msg.replace("Exposure tracked: ", "");
    tlType = "exposure";
  } else if (msg.includes("Manual assignment")) {
    event = "manual";
    detail = msg.replace("Manual assignment: ", "");
    tlType = "assign";
  } else if (
    msg.includes("Paused") ||
    msg.includes("Resumed") ||
    msg.includes("Reset")
  ) {
    event = msg.toLowerCase().split(" ")[0];
    detail = msg;
    tlType = "control";
  } else {
    event = type;
    detail = msg;
    tlType = "register";
  }

  timeline.unshift({ time: Date.now(), event, detail, type: tlType });
}

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    experiments: t.array<Experiment>(),
    assignments: t.object<Record<string, string>>(),
    exposures: t.object<Record<string, number>>(),
    userId: t.string(),
    paused: t.boolean(),
  },
  derivations: {
    activeExperiments: t.array<Experiment>(),
    assignedCount: t.number(),
    exposedCount: t.number(),
  },
  events: {
    registerExperiment: {
      id: t.string(),
      name: t.string(),
      variants: t.array<Variant>(),
    },
    assignVariant: { experimentId: t.string(), variantId: t.string() },
    recordExposure: { experimentId: t.string() },
    pauseAll: {},
    resumeAll: {},
    reset: {},
  },
  requirements: {
    ASSIGN_VARIANT: { experimentId: t.string() },
    TRACK_EXPOSURE: { experimentId: t.string(), variantId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const abTesting = createModule("ab-testing", {
  schema,

  init: (facts) => {
    facts.experiments = [];
    facts.assignments = {};
    facts.exposures = {};
    facts.userId = `user-${hashCode(String(Date.now())).toString(36)}`;
    facts.paused = false;
  },

  derive: {
    activeExperiments: (facts) =>
      facts.experiments.filter((e: Experiment) => e.active && !facts.paused),
    assignedCount: (facts) => Object.keys(facts.assignments).length,
    exposedCount: (facts) => Object.keys(facts.exposures).length,
  },

  events: {
    registerExperiment: (facts, { id, name, variants }) => {
      const experiments = facts.experiments as Experiment[];
      if (!experiments.find((e: Experiment) => e.id === id)) {
        facts.experiments = [
          ...experiments,
          { id, name, variants, active: true },
        ];
      }
    },
    assignVariant: (facts, { experimentId, variantId }) => {
      facts.assignments = { ...facts.assignments, [experimentId]: variantId };
    },
    recordExposure: (facts, { experimentId }) => {
      facts.exposures = { ...facts.exposures, [experimentId]: Date.now() };
    },
    pauseAll: (facts) => {
      facts.paused = true;
    },
    resumeAll: (facts) => {
      facts.paused = false;
    },
    reset: (facts) => {
      facts.assignments = {};
      facts.exposures = {};
      facts.paused = false;
    },
  },

  constraints: {
    needsAssignment: {
      priority: 100,
      when: (facts) => {
        if (facts.paused) {
          return false;
        }
        const experiments = facts.experiments as Experiment[];
        const assignments = facts.assignments as Record<string, string>;

        return experiments.some(
          (e: Experiment) => e.active && !assignments[e.id],
        );
      },
      require: (facts) => {
        const experiments = facts.experiments as Experiment[];
        const assignments = facts.assignments as Record<string, string>;
        const unassigned = experiments.find(
          (e: Experiment) => e.active && !assignments[e.id],
        );

        return { type: "ASSIGN_VARIANT", experimentId: unassigned!.id };
      },
    },

    needsExposure: {
      priority: 50,
      when: (facts) => {
        if (facts.paused) {
          return false;
        }
        const assignments = facts.assignments as Record<string, string>;
        const exposures = facts.exposures as Record<string, number>;

        return Object.keys(assignments).some((id) => !exposures[id]);
      },
      require: (facts) => {
        const assignments = facts.assignments as Record<string, string>;
        const exposures = facts.exposures as Record<string, number>;
        const experimentId = Object.keys(assignments).find(
          (id) => !exposures[id],
        )!;

        return {
          type: "TRACK_EXPOSURE",
          experimentId,
          variantId: assignments[experimentId],
        };
      },
    },
  },

  resolvers: {
    assignVariant: {
      requirement: "ASSIGN_VARIANT",
      resolve: async (req, context) => {
        const experiments = context.facts.experiments as Experiment[];
        const experiment = experiments.find(
          (e: Experiment) => e.id === req.experimentId,
        );
        if (!experiment) {
          return;
        }

        const variantId = pickVariant(
          context.facts.userId,
          req.experimentId,
          experiment.variants,
        );

        context.facts.assignments = {
          ...context.facts.assignments,
          [req.experimentId]: variantId,
        };
        addLog("resolver", `Assigned ${req.experimentId} → ${variantId}`);
      },
    },

    trackExposure: {
      requirement: "TRACK_EXPOSURE",
      resolve: async (req, context) => {
        const now = Date.now();
        context.facts.exposures = {
          ...context.facts.exposures,
          [req.experimentId]: now,
        };
        addLog(
          "resolver",
          `Exposure tracked: ${req.experimentId} (variant: ${req.variantId}) at ${new Date(now).toLocaleTimeString()}`,
        );
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: abTesting,
  trace: true,
  plugins: [devtoolsPlugin({ name: "ab-testing" })],
});
```

## sudoku

```typescript
// Example: sudoku
// Source: examples/sudoku/src/sudoku.ts
// Pure module file — no DOM wiring

/**
 * Sudoku – Directive Module
 *
 * Constraint-driven Sudoku game. Sudoku IS a constraint satisfaction problem:
 * no duplicates in rows, columns, or 3x3 boxes. The game rules map directly
 * to Directive's constraint→resolver flow.
 *
 * Also demonstrates temporal constraints (countdown timer) and runtime
 * reconfiguration (difficulty modes) – patterns not shown in checkers.
 *
 * Pure Sudoku logic lives in rules.ts; puzzle generation in generator.ts.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { generatePuzzle } from "./generator.js";
import {
  type Conflict,
  type Difficulty,
  type Grid,
  MAX_HINTS,
  TIMER_CRITICAL_THRESHOLD,
  TIMER_DURATIONS,
  TIMER_EFFECT_CRITICAL,
  TIMER_EFFECT_WARNING,
  TIMER_WARNING_THRESHOLD,
  createEmptyNotes,
  findConflicts,
  getCandidates,
  getPeers,
  isBoardComplete,
  toRowCol,
} from "./rules.js";

// ============================================================================
// Schema
// ============================================================================

export const sudokuSchema = {
  facts: {
    grid: t.object<Grid>(),
    solution: t.object<Grid>(),
    givens: t.object<Set<number>>(),
    selectedIndex: t.object<number | null>(),
    difficulty: t.object<Difficulty>(),
    timerRemaining: t.number(),
    timerRunning: t.boolean(),
    gameOver: t.boolean(),
    won: t.boolean(),
    message: t.string(),
    notesMode: t.boolean(),
    notes: t.array<Set<number>>(),
    hintsUsed: t.number(),
    errorsCount: t.number(),
    hintRequested: t.boolean(),
  },
  derivations: {
    conflicts: t.array<Conflict>(),
    conflictIndices: t.object<Set<number>>(),
    hasConflicts: t.boolean(),
    filledCount: t.number(),
    progress: t.number(),
    isComplete: t.boolean(),
    isSolved: t.boolean(),
    selectedPeers: t.array<number>(),
    highlightValue: t.number(),
    sameValueIndices: t.object<Set<number>>(),
    candidates: t.array<number>(),
    timerDisplay: t.string(),
    timerUrgency: t.object<"normal" | "warning" | "critical">(),
  },
  events: {
    newGame: { difficulty: t.object<Difficulty>() },
    selectCell: { index: t.number() },
    inputNumber: { value: t.number() },
    toggleNote: { value: t.number() },
    toggleNotesMode: {},
    requestHint: {},
    tick: {},
  },
  requirements: {
    SHOW_CONFLICT: {
      index: t.number(),
      value: t.number(),
      row: t.number(),
      col: t.number(),
    },
    GAME_WON: {
      timeLeft: t.number(),
      hintsUsed: t.number(),
      errors: t.number(),
    },
    GAME_OVER: {
      reason: t.string(),
    },
    REVEAL_HINT: {
      index: t.number(),
      value: t.number(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const sudokuGame = createModule("sudoku", {
  schema: sudokuSchema,
  history: {
    snapshotEvents: [
      "inputNumber",
      "toggleNote",
      "requestHint",
      "newGame",
    ],
  },

  init: (facts) => {
    const { puzzle, solution } = generatePuzzle("easy");
    const givens = new Set<number>();
    for (let i = 0; i < 81; i++) {
      if (puzzle[i] !== 0) {
        givens.add(i);
      }
    }

    facts.grid = puzzle;
    facts.solution = solution;
    facts.givens = givens;
    facts.selectedIndex = null;
    facts.difficulty = "easy";
    facts.timerRemaining = TIMER_DURATIONS.easy;
    facts.timerRunning = true;
    facts.gameOver = false;
    facts.won = false;
    facts.message =
      "Fill in the grid. No duplicates in rows, columns, or boxes.";
    facts.notesMode = false;
    facts.notes = createEmptyNotes();
    facts.hintsUsed = 0;
    facts.errorsCount = 0;
    facts.hintRequested = false;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    conflicts: (facts) => {
      return findConflicts(facts.grid);
    },

    conflictIndices: (facts, derived) => {
      const indices = new Set<number>();
      const givens = facts.givens;
      for (const c of derived.conflicts) {
        // Only highlight player-placed cells, not givens
        if (!givens.has(c.index)) {
          indices.add(c.index);
        }
      }

      return indices;
    },

    hasConflicts: (_facts, derived) => {
      return derived.conflicts.length > 0;
    },

    filledCount: (facts) => {
      let count = 0;
      const grid = facts.grid;
      for (let i = 0; i < 81; i++) {
        if (grid[i] !== 0) {
          count++;
        }
      }

      return count;
    },

    progress: (_facts, derived) => {
      return Math.round((derived.filledCount / 81) * 100);
    },

    isComplete: (facts) => {
      return isBoardComplete(facts.grid);
    },

    isSolved: (_facts, derived) => {
      return derived.isComplete && !derived.hasConflicts;
    },

    selectedPeers: (facts) => {
      const sel = facts.selectedIndex;
      if (sel === null) {
        return [];
      }

      return getPeers(sel);
    },

    highlightValue: (facts) => {
      const sel = facts.selectedIndex;
      if (sel === null) {
        return 0;
      }

      return facts.grid[sel];
    },

    sameValueIndices: (facts, derived) => {
      const val = derived.highlightValue;
      if (val === 0) {
        return new Set<number>();
      }

      const indices = new Set<number>();
      const grid = facts.grid;
      for (let i = 0; i < 81; i++) {
        if (grid[i] === val) {
          indices.add(i);
        }
      }

      return indices;
    },

    candidates: (facts) => {
      const sel = facts.selectedIndex;
      if (sel === null) {
        return [];
      }

      return getCandidates(facts.grid, sel);
    },

    timerDisplay: (facts) => {
      const remaining = facts.timerRemaining;
      const mins = Math.max(0, Math.floor(remaining / 60));
      const secs = Math.max(0, remaining % 60);

      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    },

    timerUrgency: (facts) => {
      const remaining = facts.timerRemaining;
      if (remaining <= TIMER_CRITICAL_THRESHOLD) {
        return "critical";
      }
      if (remaining <= TIMER_WARNING_THRESHOLD) {
        return "warning";
      }

      return "normal";
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    newGame: (facts, { difficulty }) => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      const givens = new Set<number>();
      for (let i = 0; i < 81; i++) {
        if (puzzle[i] !== 0) {
          givens.add(i);
        }
      }

      facts.grid = puzzle;
      facts.solution = solution;
      facts.givens = givens;
      facts.selectedIndex = null;
      facts.difficulty = difficulty;
      facts.timerRemaining = TIMER_DURATIONS[difficulty];
      facts.timerRunning = true;
      facts.gameOver = false;
      facts.won = false;
      facts.message =
        "Fill in the grid. No duplicates in rows, columns, or boxes.";
      facts.notesMode = false;
      facts.notes = createEmptyNotes();
      facts.hintsUsed = 0;
      facts.errorsCount = 0;
      facts.hintRequested = false;
    },

    selectCell: (facts, { index }) => {
      if (facts.gameOver) {
        return;
      }
      facts.selectedIndex = index;
    },

    inputNumber: (facts, { value }) => {
      if (facts.gameOver) {
        return;
      }

      const sel = facts.selectedIndex;
      if (sel === null) {
        return;
      }

      const givens = facts.givens;
      if (givens.has(sel)) {
        facts.message = "That cell is locked.";

        return;
      }

      if (facts.notesMode && value !== 0) {
        // In notes mode, toggle the pencil mark instead
        const notes = [...facts.notes];
        notes[sel] = new Set(notes[sel]);
        if (notes[sel].has(value)) {
          notes[sel].delete(value);
        } else {
          notes[sel].add(value);
        }
        facts.notes = notes;
        facts.message = "";

        return;
      }

      // Place or clear a number
      const grid = [...facts.grid];
      grid[sel] = value;
      facts.grid = grid;

      // Clear notes for this cell when placing a number
      if (value !== 0) {
        const notes = [...facts.notes];
        notes[sel] = new Set();
        // Also clear this value from peer notes
        for (const peer of getPeers(sel)) {
          if (notes[peer].has(value)) {
            notes[peer] = new Set(notes[peer]);
            notes[peer].delete(value);
          }
        }
        facts.notes = notes;
      }

      facts.message = "";
    },

    toggleNote: (facts, { value }) => {
      if (facts.gameOver) {
        return;
      }

      const sel = facts.selectedIndex;
      if (sel === null) {
        return;
      }

      const givens = facts.givens;
      if (givens.has(sel)) {
        return;
      }

      // Only allow notes on empty cells
      if (facts.grid[sel] !== 0) {
        return;
      }

      const notes = [...facts.notes];
      notes[sel] = new Set(notes[sel]);
      if (notes[sel].has(value)) {
        notes[sel].delete(value);
      } else {
        notes[sel].add(value);
      }
      facts.notes = notes;
    },

    toggleNotesMode: (facts) => {
      facts.notesMode = !facts.notesMode;
    },

    requestHint: (facts) => {
      if (facts.gameOver) {
        return;
      }
      if (facts.hintsUsed >= MAX_HINTS) {
        facts.message = "No hints remaining.";

        return;
      }

      const sel = facts.selectedIndex;
      if (sel === null) {
        facts.message = "Select a cell first.";

        return;
      }

      const givens = facts.givens;
      if (givens.has(sel)) {
        facts.message = "That cell is already filled.";

        return;
      }

      if (facts.grid[sel] !== 0) {
        facts.message = "Clear the cell first, or select an empty cell.";

        return;
      }

      // Signal the hintAvailable constraint to fire
      facts.hintRequested = true;
    },

    tick: (facts) => {
      if (!facts.timerRunning || facts.gameOver) {
        return;
      }
      facts.timerRemaining = Math.max(0, facts.timerRemaining - 1);
    },
  },

  // ============================================================================
  // Constraints – The Showcase
  // ============================================================================

  constraints: {
    // Highest priority: timer expiry ends the game immediately
    timerExpired: {
      priority: 200,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }

        return facts.timerRemaining <= 0;
      },
      require: () => ({
        type: "GAME_OVER",
        reason: "Time's up!",
      }),
    },

    // Detect conflicts on player-placed cells
    detectConflict: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }
        const conflicts = findConflicts(facts.grid);
        const givens = facts.givens;

        return conflicts.some((c) => !givens.has(c.index));
      },
      require: (facts) => {
        const conflicts = findConflicts(facts.grid);
        const givens = facts.givens;
        const playerConflict = conflicts.find((c) => !givens.has(c.index));
        const idx = playerConflict?.index ?? 0;
        const { row, col } = toRowCol(idx);

        return {
          type: "SHOW_CONFLICT",
          index: idx,
          value: playerConflict?.value ?? 0,
          row: row + 1,
          col: col + 1,
        };
      },
    },

    // Puzzle solved: all cells filled with no conflicts
    puzzleSolved: {
      priority: 90,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }

        return (
          isBoardComplete(facts.grid) && findConflicts(facts.grid).length === 0
        );
      },
      require: (facts) => ({
        type: "GAME_WON",
        timeLeft: facts.timerRemaining,
        hintsUsed: facts.hintsUsed,
        errors: facts.errorsCount,
      }),
    },

    // Hint available: player requested a hint on an empty cell
    hintAvailable: {
      priority: 70,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }
        if (!facts.hintRequested) {
          return false;
        }

        const sel = facts.selectedIndex;
        if (sel === null) {
          return false;
        }

        return facts.grid[sel] === 0;
      },
      require: (facts) => {
        const sel = facts.selectedIndex as number;
        const solution = facts.solution;

        return {
          type: "REVEAL_HINT",
          index: sel,
          value: solution[sel],
        };
      },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    showConflict: {
      requirement: "SHOW_CONFLICT",
      resolve: async (req, context) => {
        context.facts.errorsCount = context.facts.errorsCount + 1;
        context.facts.message = `Conflict at row ${req.row}, column ${req.col} – duplicate ${req.value}.`;
      },
    },

    gameWon: {
      requirement: "GAME_WON",
      resolve: async (req, context) => {
        context.facts.timerRunning = false;
        context.facts.gameOver = true;
        context.facts.won = true;

        const mins = Math.floor(
          (TIMER_DURATIONS[context.facts.difficulty] - req.timeLeft) / 60,
        );
        const secs =
          (TIMER_DURATIONS[context.facts.difficulty] - req.timeLeft) % 60;
        context.facts.message = `Solved in ${mins}m ${secs}s! Hints: ${req.hintsUsed}, Errors: ${req.errors}`;
      },
    },

    gameOver: {
      requirement: "GAME_OVER",
      resolve: async (req, context) => {
        context.facts.timerRunning = false;
        context.facts.gameOver = true;
        context.facts.won = false;
        context.facts.message = req.reason;
      },
    },

    revealHint: {
      requirement: "REVEAL_HINT",
      resolve: async (req, context) => {
        const grid = [...context.facts.grid];
        grid[req.index] = req.value;
        context.facts.grid = grid;

        // Clear notes for the hinted cell and remove value from peer notes
        const notes = [...context.facts.notes];
        notes[req.index] = new Set();
        for (const peer of getPeers(req.index)) {
          if (notes[peer].has(req.value)) {
            notes[peer] = new Set(notes[peer]);
            notes[peer].delete(req.value);
          }
        }
        context.facts.notes = notes;

        context.facts.hintRequested = false;
        context.facts.hintsUsed = context.facts.hintsUsed + 1;
        context.facts.message = `Hint revealed! ${MAX_HINTS - context.facts.hintsUsed} remaining.`;
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    timerWarning: {
      deps: ["timerRemaining"],
      run: (facts) => {
        const remaining = facts.timerRemaining;
        if (remaining === TIMER_EFFECT_WARNING) {
          console.log("[Sudoku] 1 minute remaining!");
        }
        if (remaining === TIMER_EFFECT_CRITICAL) {
          console.log("[Sudoku] 30 seconds remaining!");
        }
      },
    },

    gameResult: {
      deps: ["gameOver"],
      run: (facts) => {
        if (facts.gameOver) {
          if (facts.won) {
            console.log(
              `[Sudoku] Puzzle solved! Difficulty: ${facts.difficulty}, Hints: ${facts.hintsUsed}, Errors: ${facts.errorsCount}`,
            );
          } else {
            console.log(`[Sudoku] Game over: ${facts.message}`);
          }
        }
      },
    },
  },
});
```
