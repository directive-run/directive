---
title: Feature Flags Example
description: The same 8-flag system running on directive.run — constraints enforce dependencies, derivations gate features, effects log changes.
---

The real feature flag system powering directive.run. Eight flags, one dependency constraint, maintenance mode, and change logging. {% .lead %}

---

## Overview

This example mirrors the actual module running on the doc site:

- **8 feature toggles** &ndash; chat, search, playground, vote API, brand switcher, theme selector, version selector, onboarding toast
- **Maintenance mode** &ndash; one flag disables four interactive features via derivations
- **Dependency constraint** &ndash; onboarding toast requires brand switcher (auto-enabled by the runtime)
- **Change logging** &ndash; effect logs every flag toggle to the console

---

## The Module

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
      voteApiEnabled: t.boolean(),
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
      canUseVoteApi: t.boolean(),
      enabledCount: t.number(),
      allFeaturesEnabled: t.boolean(),
    },
    events: {
      toggleFlag: { flag: t.string(), enabled: t.boolean() },
      setMaintenanceMode: { enabled: t.boolean() },
      resetAll: {},
    },
    requirements: {
      ENABLE_BRAND_SWITCHER: {},
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
    facts.voteApiEnabled = true;
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
    canUseVoteApi: (facts) =>
      facts.voteApiEnabled && !facts.maintenanceMode,
    enabledCount: (facts) => {
      let count = 0;
      if (facts.chatEnabled) count++;
      if (facts.searchEnabled) count++;
      if (facts.playgroundEnabled) count++;
      if (facts.brandSwitcherEnabled) count++;
      if (facts.themeSelectorEnabled) count++;
      if (facts.onboardingToastEnabled) count++;
      if (facts.versionSelectorEnabled) count++;
      if (facts.voteApiEnabled) count++;

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
      facts.voteApiEnabled,
  },

  constraints: {
    onboardingRequiresBrandSwitcher: {
      when: (facts) => facts.onboardingToastEnabled && !facts.brandSwitcherEnabled,
      require: { type: "ENABLE_BRAND_SWITCHER" },
    },
  },

  resolvers: {
    enableBrandSwitcher: {
      requirement: "ENABLE_BRAND_SWITCHER",
      resolve: async (request, context) => {
        context.facts.brandSwitcherEnabled = true;
      },
    },
  },
});
```

---

## Constraint-Driven Dependencies

The constraint `onboardingRequiresBrandSwitcher` is the heart of this example:

```typescript
constraints: {
  onboardingRequiresBrandSwitcher: {
    when: (facts) => facts.onboardingToastEnabled && !facts.brandSwitcherEnabled,
    require: { type: "ENABLE_BRAND_SWITCHER" },
  },
},
```

When a user enables `onboardingToastEnabled` without `brandSwitcherEnabled`, the constraint fires. The `ENABLE_BRAND_SWITCHER` resolver automatically sets `brandSwitcherEnabled = true`. No manual coordination needed &ndash; the runtime enforces the dependency.

---

## Maintenance Mode

Four derivations are gated by `maintenanceMode`:

```typescript
canUseChat: (facts) => facts.chatEnabled && !facts.maintenanceMode,
canUseSearch: (facts) => facts.searchEnabled && !facts.maintenanceMode,
canUsePlayground: (facts) => facts.playgroundEnabled && !facts.maintenanceMode,
canUseVoteApi: (facts) => facts.voteApiEnabled && !facts.maintenanceMode,
```

One `setMaintenanceMode` dispatch flips all four to `false`. The three UI flags (brand switcher, theme selector, version selector) are not gated &ndash; they should still work when interactive features are down.

---

## React Hooks

Thin wrappers around `useDerived` for each composite flag:

```typescript
import { useDerived } from "@directive-run/react";
import { getFeatureFlagSystem } from "./config";

export function useCanUseChat() {
  return useDerived(getFeatureFlagSystem(), "canUseChat");
}

export function useCanShowOnboardingToast() {
  return useDerived(getFeatureFlagSystem(), "canShowOnboardingToast");
}
```

Components read derivations, not raw facts. Toggling `maintenanceMode` re-renders only the four gated components.

---

## Runtime Controls

Disable a constraint or effect at runtime without touching the flag values:

```typescript
// Disable the auto-enable constraint for debugging
system.constraints.disable("onboardingRequiresBrandSwitcher");

// Disable change logging during tests
system.effects.disable("logChanges");
```

---

## Run It

```bash
cd examples/feature-flags
pnpm install
pnpm dev
```

Toggle flags in the left panel and watch the preview update in real time. Enable onboarding toast, turn off brand switcher, and watch the constraint auto-enable it. Toggle maintenance mode and see four features disable at once.

---

## Related

- [Feature Flags Without a Feature Flag Service](/blog/feature-flags-without-a-service) &ndash; full blog post with production configuration and comparison table
- [Constraints](/docs/constraints) &ndash; how `when` / `require` works
- [Derivations](/docs/derivations) &ndash; computed flags that replace conditionals
- [Effects](/docs/effects) &ndash; side effects like change logging
- [Persistence Plugin](/docs/plugins/persistence) &ndash; localStorage integration
