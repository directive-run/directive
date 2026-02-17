---
title: Feature Flags Without a Feature Flag Service
description: Boolean flags don't scale. Build a reactive, inspectable feature flag system using constraints, derivations, and effects.
layout: blog
date: 2026-02-04
dateModified: 2026-02-04
slug: feature-flags-without-a-service
author: directive-labs
categories: [Architecture, Tutorial]
---

You start with one feature flag. `chatEnabled = true`. Easy. Then you add `searchEnabled`, `playgroundEnabled`, and `shareButtonEnabled` &ndash; some gated by a `maintenanceMode` toggle because the infrastructure team needs a kill switch. Then `onboardingToastEnabled`, except the toast uses the brand switcher component, so it can't show unless `brandSwitcherEnabled` is also true. Then `themeSelectorEnabled` and `versionSelectorEnabled` because the design team wants to gate those independently.

Eight flags. Here's what the layout component looks like:

```typescript
function renderLayout(flags: FeatureFlags) {
  const chatVisible = flags.chatEnabled && !flags.maintenanceMode;
  const searchVisible = flags.searchEnabled && !flags.maintenanceMode;
  const playgroundVisible = flags.playgroundEnabled && !flags.maintenanceMode;
  const shareVisible = flags.shareButtonEnabled;

  // Onboarding toast needs brand switcher — but who enforces that?
  if (flags.onboardingToastEnabled && !flags.brandSwitcherEnabled) {
    console.warn("onboardingToast enabled without brandSwitcher — toast won't render");
  }

  const showToast = flags.onboardingToastEnabled && flags.brandSwitcherEnabled;

  // Four flags check maintenanceMode, three don't, one has a cross-dependency.
  // This logic is scattered across every component that reads a flag.
}
```

Nobody wants to touch this. The flags interact, the interactions aren't documented, and enabling one flag without its dependencies puts the UI in an undefined state. LaunchDarkly can toggle booleans remotely, but it can't enforce that `onboardingToastEnabled` requires `brandSwitcherEnabled`. Plain booleans in a config file are even worse &ndash; no reactivity, no validation, no dependency tracking.

The problem isn't the flag service. It's that booleans don't encode relationships.

This is how we actually gate features on [directive.run](https://directive.run). The same module, the same 8 flags, the same constraint.

---

## The pattern: flags as a constraint system

Feature flags have three properties that map directly to Directive's primitives:

- **Flags** are facts &ndash; observable boolean state
- **Flag dependencies** are constraints &ndash; "if A is true, B must also be true"
- **Computed flag combinations** are derivations &ndash; derived values that replace scattered conditionals
- **Side effects** are effects &ndash; logging, analytics, UI reactions

Declare the relationships once. The runtime enforces them automatically. No more `console.warn` comments hoping someone reads the log.

---

## The full module

Here's the complete feature flag system running on directive.run &ndash; 8 flags, a dependency constraint, maintenance gating, and change logging:

```typescript
import { createModule, t } from "@directive-run/core";

const featureFlags = createModule("feature-flags", {
  schema: {
    facts: {
      chatEnabled: t.boolean(),
      searchEnabled: t.boolean(),
      playgroundEnabled: t.boolean(),
      brandSwitcherEnabled: t.boolean(),
      themeSelectorEnabled: t.boolean(),
      onboardingToastEnabled: t.boolean(),
      versionSelectorEnabled: t.boolean(),
      shareButtonEnabled: t.boolean(),
      maintenanceMode: t.boolean(),
    },
    derivations: {
      canUseChat: t.boolean(),
      canUseSearch: t.boolean(),
      canUsePlayground: t.boolean(),
      canUseBrandSwitcher: t.boolean(),
      canUseThemeSelector: t.boolean(),
      canShowOnboardingToast: t.boolean(),
      canUseVersionSelector: t.boolean(),
      canUseShareButton: t.boolean(),
      enabledCount: t.number(),
      allFeaturesEnabled: t.boolean(),
    },
    events: {
      configure: {
        chatEnabled: t.boolean(),
        searchEnabled: t.boolean(),
        playgroundEnabled: t.boolean(),
        brandSwitcherEnabled: t.boolean(),
        themeSelectorEnabled: t.boolean(),
        onboardingToastEnabled: t.boolean(),
        versionSelectorEnabled: t.boolean(),
        shareButtonEnabled: t.boolean(),
      },
      setMaintenanceMode: { enabled: t.boolean() },
      toggleFlag: { flag: t.string(), enabled: t.boolean() },
      resetAll: {},
    },
    requirements: {
      ENABLE_BRAND_SWITCHER: {},
      LOG_MAINTENANCE_WARNING: {},
    },
  },

  init: (facts) => {
    facts.chatEnabled = true;
    facts.searchEnabled = true;
    facts.playgroundEnabled = true;
    facts.brandSwitcherEnabled = true;
    facts.themeSelectorEnabled = true;
    facts.onboardingToastEnabled = true;
    facts.versionSelectorEnabled = true;
    facts.shareButtonEnabled = true;
    facts.maintenanceMode = false;
  },

  derive: {
    canUseChat: (facts) =>
      facts.chatEnabled && !facts.maintenanceMode,
    canUseSearch: (facts) =>
      facts.searchEnabled && !facts.maintenanceMode,
    canUsePlayground: (facts) =>
      facts.playgroundEnabled && !facts.maintenanceMode,
    canUseBrandSwitcher: (facts) =>
      facts.brandSwitcherEnabled,
    canUseThemeSelector: (facts) =>
      facts.themeSelectorEnabled,
    canShowOnboardingToast: (facts) =>
      facts.onboardingToastEnabled && facts.brandSwitcherEnabled,
    canUseVersionSelector: (facts) =>
      facts.versionSelectorEnabled,
    canUseShareButton: (facts) =>
      facts.shareButtonEnabled && !facts.maintenanceMode,
    enabledCount: (facts) => {
      let count = 0;
      if (facts.chatEnabled) count++;
      if (facts.searchEnabled) count++;
      if (facts.playgroundEnabled) count++;
      if (facts.brandSwitcherEnabled) count++;
      if (facts.themeSelectorEnabled) count++;
      if (facts.onboardingToastEnabled) count++;
      if (facts.versionSelectorEnabled) count++;
      if (facts.shareButtonEnabled) count++;

      return count;
    },
    allFeaturesEnabled: (facts) =>
      facts.chatEnabled &&
      facts.searchEnabled &&
      facts.playgroundEnabled &&
      facts.brandSwitcherEnabled &&
      facts.themeSelectorEnabled &&
      facts.onboardingToastEnabled &&
      facts.versionSelectorEnabled &&
      facts.shareButtonEnabled,
  },

  events: {
    configure: (facts, payload) => {
      facts.chatEnabled = payload.chatEnabled;
      facts.searchEnabled = payload.searchEnabled;
      facts.playgroundEnabled = payload.playgroundEnabled;
      facts.brandSwitcherEnabled = payload.brandSwitcherEnabled;
      facts.themeSelectorEnabled = payload.themeSelectorEnabled;
      facts.onboardingToastEnabled = payload.onboardingToastEnabled;
      facts.versionSelectorEnabled = payload.versionSelectorEnabled;
      facts.shareButtonEnabled = payload.shareButtonEnabled;
    },
    setMaintenanceMode: (facts, { enabled }) => {
      facts.maintenanceMode = enabled;
    },
    toggleFlag: (facts, { flag, enabled }) => {
      const key = flag as keyof typeof facts;
      if (key in facts && typeof facts[key] === "boolean") {
        (facts as Record<string, boolean>)[key] = enabled;
      }
    },
    resetAll: (facts) => {
      facts.chatEnabled = true;
      facts.searchEnabled = true;
      facts.playgroundEnabled = true;
      facts.brandSwitcherEnabled = true;
      facts.themeSelectorEnabled = true;
      facts.onboardingToastEnabled = true;
      facts.versionSelectorEnabled = true;
      facts.shareButtonEnabled = true;
      facts.maintenanceMode = false;
    },
  },

  constraints: {
    onboardingRequiresBrandSwitcher: {
      when: (facts) => facts.onboardingToastEnabled && !facts.brandSwitcherEnabled,
      require: { type: "ENABLE_BRAND_SWITCHER" },
    },
    maintenanceWarning: {
      when: (facts) => facts.maintenanceMode,
      require: { type: "LOG_MAINTENANCE_WARNING" },
    },
  },

  resolvers: {
    enableBrandSwitcher: {
      requirement: "ENABLE_BRAND_SWITCHER",
      resolve: async (req, context) => {
        context.facts.brandSwitcherEnabled = true;
      },
    },
    logMaintenanceWarning: {
      requirement: "LOG_MAINTENANCE_WARNING",
      resolve: async (req, context) => {
        console.warn(
          "[feature-flags] Maintenance mode active. Chat, search, playground, and share button disabled.",
        );
      },
    },
  },

  effects: {
    logChanges: {
      deps: [
        "chatEnabled", "searchEnabled", "playgroundEnabled",
        "brandSwitcherEnabled", "themeSelectorEnabled",
        "onboardingToastEnabled", "versionSelectorEnabled",
        "shareButtonEnabled", "maintenanceMode",
      ],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        const flags = [
          "chatEnabled", "searchEnabled", "playgroundEnabled",
          "brandSwitcherEnabled", "themeSelectorEnabled",
          "onboardingToastEnabled", "versionSelectorEnabled",
          "shareButtonEnabled", "maintenanceMode",
        ] as const;

        for (const flag of flags) {
          if (facts[flag] !== prev[flag]) {
            console.log(`[feature-flags] ${flag}: ${prev[flag]} → ${facts[flag]}`);
          }
        }
      },
    },
  },
});
```

That's the whole system. Eight flags, one dependency constraint, maintenance gating, change logging &ndash; all in one inspectable module. Let's walk through what it actually does.

---

## Runtime behavior: automatic dependency resolution

Here's the key moment. The onboarding toast depends on the brand switcher component. A developer enables `onboardingToastEnabled` without realizing the dependency:

```typescript
system.dispatch({ type: "toggleFlag", flag: "onboardingToastEnabled", enabled: true });
```

The `onboardingToastEnabled` fact becomes `true`. The constraint `onboardingRequiresBrandSwitcher` evaluates: is `onboardingToastEnabled` true and `brandSwitcherEnabled` false? Yes. It fires a requirement of type `ENABLE_BRAND_SWITCHER`. The resolver picks it up and sets `brandSwitcherEnabled = true`.

One action by the user. Two facts changed. Zero invalid states.

This is the "aha moment" that separates Directive from both LaunchDarkly and plain booleans. LaunchDarkly can toggle `onboardingToastEnabled` remotely, but it can't enforce that `brandSwitcherEnabled` must also be enabled &ndash; you'd need a webhook, a serverless function, and a race condition prayer. Plain booleans require the developer to remember the dependency. Directive *encodes* it.

---

## Maintenance mode: one flag, four derivations

The `maintenanceMode` fact controls four interactive features at once. Look at the derivations:

```typescript
derive: {
  canUseChat: (facts) =>
    facts.chatEnabled && !facts.maintenanceMode,
  canUseSearch: (facts) =>
    facts.searchEnabled && !facts.maintenanceMode,
  canUsePlayground: (facts) =>
    facts.playgroundEnabled && !facts.maintenanceMode,
  canUseShareButton: (facts) =>
    facts.shareButtonEnabled && !facts.maintenanceMode,
},
```

One `setMaintenanceMode` dispatch flips all four derivations to `false`. No scattered `if (maintenanceMode)` checks in every component. The derivations absorb the conditional logic &ndash; components just read the computed value.

The three UI flags (`canUseBrandSwitcher`, `canUseThemeSelector`, `canUseVersionSelector`) are *not* gated by maintenance. Theme switching and version selection should still work even when interactive features are down. That business rule is encoded once in the derivation, not rediscovered in every component.

---

## Computed flags replace scattered conditionals

Components don't check raw flags. They read derivations:

```typescript
const canChat = system.read("canUseChat");
// true if chatEnabled && !maintenanceMode
```

The branching logic lives in one place, it's auto-tracked (no manual dependency arrays), and it recomputes only when its input facts change. Your layout component goes from a conditional tree to:

```typescript
function Layout() {
  const canChat = useCanUseChat();
  const canSearch = useCanUseSearch();
  const showToast = useCanShowOnboardingToast();

  return (
    <div>
      {canChat && <ChatWidget />}
      {canSearch && <SearchBar />}
      {showToast && <OnboardingToast />}
    </div>
  );
}
```

No `&& !maintenanceMode` in the JSX. No `&& brandSwitcherEnabled` guard for the toast. The derivations handle it.

---

## React hooks

The hooks file is thin wrappers around `useDerived`:

```typescript
import { useDerived } from "@directive-run/react";
import { getFeatureFlagSystem } from "./config";

export function useCanUseChat() {
  return useDerived(getFeatureFlagSystem(), "canUseChat");
}

export function useCanUseSearch() {
  return useDerived(getFeatureFlagSystem(), "canUseSearch");
}

export function useCanShowOnboardingToast() {
  return useDerived(getFeatureFlagSystem(), "canShowOnboardingToast");
}
```

Each hook subscribes to a single derivation. Toggling `chatEnabled` doesn't re-render the search component. Toggling `maintenanceMode` re-renders only the four maintenance-gated components.

---

## Production configuration

The system singleton reads flag defaults from constants and maintenance mode from an environment variable:

```typescript
import { createSystem } from "@directive-run/core";
import { featureFlags } from "./module";

let instance = null;

export function getFeatureFlagSystem() {
  if (instance) {
    return instance;
  }

  instance = createSystem({ module: featureFlags });
  instance.start();

  // All flags default to enabled
  instance.events.configure({
    chatEnabled: true,
    searchEnabled: true,
    playgroundEnabled: true,
    brandSwitcherEnabled: true,
    themeSelectorEnabled: true,
    onboardingToastEnabled: true,
    versionSelectorEnabled: true,
    shareButtonEnabled: true,
  });

  // Maintenance mode from Vercel env var
  const maintenanceMode =
    process.env?.NEXT_PUBLIC_FF_MAINTENANCE === "true";
  instance.events.setMaintenanceMode({ enabled: maintenanceMode });

  return instance;
}
```

Flip `NEXT_PUBLIC_FF_MAINTENANCE` to `true` in the Vercel dashboard and chat, search, playground, and share button disable instantly on the next page load. No code change, no deploy, no flag service.

---

## Runtime toggles: surgical control

Directive lets you disable individual constraints and effects at runtime without removing them from the module:

```typescript
// Temporarily disable the auto-enable behavior
system.constraints.disable("onboardingRequiresBrandSwitcher");

// Now onboardingToast can be enabled without brand switcher for debugging
system.dispatch({ type: "toggleFlag", flag: "onboardingToastEnabled", enabled: true });

// Re-enable when done
system.constraints.enable("onboardingRequiresBrandSwitcher");

// Disable change logging during tests
system.effects.disable("logChanges");
```

This is useful for debugging ("why does enabling onboarding also enable the brand switcher?"), for testing (disable side effects during unit tests), and for gradual rollouts (disable a constraint for a specific cohort while keeping it active for everyone else).

---

## Side effects: change logging

The effects system handles the consequences of flag changes &ndash; things that happen *because* a flag changed, but aren't part of the flag logic itself.

```typescript
effects: {
  logChanges: {
    deps: [
      "chatEnabled", "searchEnabled", "playgroundEnabled",
      "brandSwitcherEnabled", "themeSelectorEnabled",
      "onboardingToastEnabled", "versionSelectorEnabled",
      "shareButtonEnabled", "maintenanceMode",
    ],
    run: (facts, prev) => {
      if (!prev) {
        return;
      }

      const flags = [
        "chatEnabled", "searchEnabled", "playgroundEnabled",
        "brandSwitcherEnabled", "themeSelectorEnabled",
        "onboardingToastEnabled", "versionSelectorEnabled",
        "shareButtonEnabled", "maintenanceMode",
      ] as const;

      for (const flag of flags) {
        if (facts[flag] !== prev[flag]) {
          console.log(`[feature-flags] ${flag}: ${prev[flag]} → ${facts[flag]}`);
        }
      }
    },
  },
},
```

`logChanges` runs on any tracked flag change and diffs against the previous state. It's fire-and-forget &ndash; it doesn't produce requirements, it doesn't modify other facts, it just reacts.

---

## Comparison

| Capability | Plain booleans | LaunchDarkly | Directive |
|---|---|---|---|
| Remote toggling | No | Yes | Via events / env vars |
| Flag dependencies | Manual | Prerequisite flags | Constraints + auto-resolve |
| Maintenance gating | Scattered checks | Segments (limited) | Derivations |
| Computed combinations | If-else chains | Segments (limited) | Derivations |
| Side effects on change | Manual listeners | Webhooks | Effects system |
| Inspect active rules | No | Dashboard | `system.inspect()` |
| Disable rules at runtime | Delete code | Kill switch | `system.constraints.disable()` |
| Offline support | Config file | SDK cache | Persistence plugin |
| Cost | Free | $10+/seat/month | Free (open source) |

LaunchDarkly wins when you need remote flag management across many services with percentage-based rollouts and built-in experimentation. Directive wins when your flags interact &ndash; when enabling one flag should automatically enable another, when maintenance mode should gate a subset of features, and when you want the entire system inspectable and testable locally.

---

## When NOT to use this

**Single isolated flags.** If `showBanner` doesn't depend on anything and nothing depends on it, a boolean is the right tool.

**Server-only flags.** Flags that gate backend behavior (database migrations, API versions) belong in environment variables or a remote config service, not a client-side runtime.

**No flag interactions.** If your flags are all independent toggles &ndash; none depends on another, none computes a combination &ndash; the constraint system adds structure you don't need. A `Record<string, boolean>` and a context provider will serve you fine.

The threshold: when you have **three or more flags that interact** &ndash; dependencies, computed combinations, or maintenance gating that crosses flag boundaries &ndash; that's when modeling them as a constraint system pays for itself.

---

## Get started

```bash
npm install @directive-run/core @directive-run/react
```

- **[Constraints](/docs/constraints)** &ndash; declaring flag dependencies with `when` and `require`
- **[Derivations](/docs/derivations)** &ndash; computed values that replace conditional chains
- **[Effects](/docs/effects)** &ndash; reacting to flag changes with side effects
- **[React Adapter](/docs/adapters/react)** &ndash; `useFact` and `useDerived` hooks
- **[Feature Flags Example](/docs/examples/feature-flags)** &ndash; interactive demo with the same 8 flags

Your feature flags aren't just booleans. They're a system with dependencies, computed states, and side effects. Model them that way and the scattered conditionals disappear.
