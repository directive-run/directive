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

      return rtlLocales.includes(facts.locale as string);
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setTheme: (facts, { value }) => {
      facts.theme = value;
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
        document.documentElement.setAttribute(
          "data-theme",
          effective as string,
        );
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
      facts.breakpoint = value;
    },
  },
});
