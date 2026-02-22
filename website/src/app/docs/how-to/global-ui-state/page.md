---
title: How to Manage Global UI State (Theme, Locale, Layout)
description: Replace React Context with Directive for theme, locale, sidebar, and other global preferences with persistence and system detection.
---

Theme, locale, sidebar state, and other UI preferences — persisted, reactive, and shared across your entire app. {% .lead %}

---

## The Problem

Every app has global UI state: theme (light/dark/system), locale, sidebar collapsed, display density. React Context works initially, but re-renders the entire tree on any change. Adding persistence (localStorage), system preference detection (`prefers-color-scheme`), and multiple preference categories creates scattered logic across providers, hooks, and effects.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { persistencePlugin } from '@directive-run/core/plugins';

const preferences = createModule('preferences', {
  schema: {
    theme: t.string<'light' | 'dark' | 'system'>(),
    locale: t.string(),
    sidebarOpen: t.boolean(),
    systemPrefersDark: t.boolean(),
  },

  init: (facts) => {
    facts.theme = 'system';
    facts.locale = 'en';
    facts.sidebarOpen = true;
    facts.systemPrefersDark = false;
  },

  derive: {
    effectiveTheme: (facts) => {
      if (facts.theme !== 'system') {
        return facts.theme;
      }

      return facts.systemPrefersDark ? 'dark' : 'light';
    },
    isRTL: (facts) => ['ar', 'he', 'fa'].includes(facts.locale),
  },

  events: {
    setTheme: (facts, { value }: { value: 'light' | 'dark' | 'system' }) => {
      facts.theme = value;
    },
    setLocale: (facts, { value }: { value: string }) => {
      facts.locale = value;
    },
    toggleSidebar: (facts) => {
      facts.sidebarOpen = !facts.sidebarOpen;
    },
    setSystemPreference: (facts, { dark }: { dark: boolean }) => {
      facts.systemPrefersDark = dark;
    },
  },

  effects: {
    applyTheme: {
      run: (facts, prev, { derived }) => {
        document.documentElement.setAttribute('data-theme', derived.effectiveTheme);
      },
    },
    detectSystemTheme: {
      run: (facts, prev, { dispatch }) => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        dispatch({ type: 'SET_SYSTEM_PREFERENCE', dark: mq.matches });

        const handler = (e: MediaQueryListEvent) => {
          dispatch({ type: 'SET_SYSTEM_PREFERENCE', dark: e.matches });
        };
        mq.addEventListener('change', handler);

        return () => mq.removeEventListener('change', handler);
      },
    },
  },
});

const layout = createModule('layout', {
  schema: {
    breakpoint: t.string<'mobile' | 'tablet' | 'desktop'>(),
  },

  init: (facts) => {
    facts.breakpoint = 'desktop';
  },

  events: {
    setBreakpoint: (facts, { value }: { value: 'mobile' | 'tablet' | 'desktop' }) => {
      facts.breakpoint = value;
    },
  },

  effects: {
    detectBreakpoint: {
      run: (facts, prev, { dispatch }) => {
        const check = () => {
          const w = window.innerWidth;
          const bp = w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
          dispatch({ type: 'SET_BREAKPOINT', value: bp });
        };
        check();
        window.addEventListener('resize', check);

        return () => window.removeEventListener('resize', check);
      },
    },
  },
});

const system = createSystem({
  modules: { preferences, layout },
  plugins: [
    persistencePlugin({
      key: 'app-preferences',
      include: ['preferences::theme', 'preferences::locale', 'preferences::sidebarOpen'],
    }),
  ],
});
```

```tsx
import { useDirective, useFact, useDerived } from '@directive-run/react';

function ThemeSwitcher({ system }) {
  const theme = useFact(system, 'preferences::theme');
  const effectiveTheme = useDerived(system, 'preferences::effectiveTheme');

  return (
    <div>
      <span>Current: {effectiveTheme}</span>
      {['light', 'dark', 'system'].map((t) => (
        <button
          key={t}
          aria-pressed={theme === t}
          onClick={() => system.events.setTheme({ value: t })}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Sidebar({ system, children }) {
  const open = useFact(system, 'preferences::sidebarOpen');

  return (
    <aside data-open={open}>
      <button onClick={() => system.events.toggleSidebar()}>
        {open ? 'Collapse' : 'Expand'}
      </button>
      {open && children}
    </aside>
  );
}
```

## Step by Step

1. **Two modules, one system** — `preferences` owns user choices, `layout` owns responsive state. They evolve independently but share a system.

2. **`effectiveTheme` derivation** resolves `"system"` to actual `"light"` or `"dark"` by reading `systemPrefersDark`. Components only care about the resolved value.

3. **`detectSystemTheme` effect** listens to `prefers-color-scheme` changes and dispatches events. The cleanup function removes the listener when the system stops.

4. **`persistencePlugin`** saves theme, locale, and sidebar state to localStorage. On reload, these facts are restored automatically — `systemPrefersDark` is excluded because it's detected at runtime.

5. **`useFact` and `useDerived`** give components surgical reactivity. The `ThemeSwitcher` only re-renders when theme-related facts change, not when the sidebar toggles.

## Common Variations

### Locale with async translation loading

```typescript
constraints: {
  needsTranslations: {
    when: (facts) => facts.locale !== facts.loadedLocale,
    require: (facts) => ({ type: 'LOAD_TRANSLATIONS', locale: facts.locale }),
  },
},
resolvers: {
  loadTranslations: {
    requirement: 'LOAD_TRANSLATIONS',
    resolve: async (req, context) => {
      const translations = await import(`./i18n/${req.locale}.json`);
      context.facts.translations = translations.default;
      context.facts.loadedLocale = req.locale;
    },
  },
},
```

### Multiple preference categories

Split into focused modules: `themeModule`, `localeModule`, `layoutModule`. Each gets its own persistence key and can be code-split independently.

### Accessibility preferences

```typescript
derive: {
  reducedMotion: (facts) => facts.prefersReducedMotion || facts.forceReducedMotion,
  fontSize: (facts) => facts.baseFontSize * facts.fontScale,
},
```

## Related

- [Interactive Example](/docs/examples/theme-locale) — try it in your browser
- [Persistence Plugin](/docs/plugins/persistence) — save and restore state
- [Effects](/docs/effects) — cleanup and subscriptions
- [Multi-Module](/docs/advanced/multi-module) — composing modules
- [Choosing Primitives](/docs/choosing-primitives) — when to use derivations vs effects
