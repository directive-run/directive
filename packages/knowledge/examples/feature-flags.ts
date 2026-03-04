// Example: feature-flags
// Source: examples/feature-flags/src/module.ts
// Pure module file — no DOM wiring

/**
 * Feature Flags Directive Module (Example)
 *
 * Mirrors the real feature flag system running on directive.run.
 * 8 flags with two interaction patterns:
 *
 * 1. Maintenance mode &ndash; disables chat, search, playground, and vote API
 * 2. Onboarding toast &rarr; depends on brand switcher (constraint auto-enables)
 */
import { createModule, t } from "@directive-run/core";

export const featureFlagsModule = createModule("feature-flags", {
  schema: {
    facts: {
      // Individual feature toggles
      chatEnabled: t.boolean(),
      searchEnabled: t.boolean(),
      playgroundEnabled: t.boolean(),
      brandSwitcherEnabled: t.boolean(),
      themeSelectorEnabled: t.boolean(),
      onboardingToastEnabled: t.boolean(),
      versionSelectorEnabled: t.boolean(),
      voteApiEnabled: t.boolean(),

      // Context
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
      configure: {
        chatEnabled: t.boolean(),
        searchEnabled: t.boolean(),
        playgroundEnabled: t.boolean(),
        brandSwitcherEnabled: t.boolean(),
        themeSelectorEnabled: t.boolean(),
        onboardingToastEnabled: t.boolean(),
        versionSelectorEnabled: t.boolean(),
        voteApiEnabled: t.boolean(),
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
    facts.voteApiEnabled = true;

    facts.maintenanceMode = false;
  },

  derive: {
    canUseChat: (facts) => facts.chatEnabled && !facts.maintenanceMode,
    canUseSearch: (facts) => facts.searchEnabled && !facts.maintenanceMode,
    canUsePlayground: (facts) =>
      facts.playgroundEnabled && !facts.maintenanceMode,
    canUseBrandSwitcher: (facts) => facts.brandSwitcherEnabled,
    canUseThemeSelector: (facts) => facts.themeSelectorEnabled,
    canShowOnboardingToast: (facts) =>
      facts.onboardingToastEnabled && facts.brandSwitcherEnabled,
    canUseVersionSelector: (facts) => facts.versionSelectorEnabled,
    canUseVoteApi: (facts) => facts.voteApiEnabled && !facts.maintenanceMode,
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

  events: {
    configure: (facts, payload) => {
      facts.chatEnabled = payload.chatEnabled;
      facts.searchEnabled = payload.searchEnabled;
      facts.playgroundEnabled = payload.playgroundEnabled;
      facts.brandSwitcherEnabled = payload.brandSwitcherEnabled;
      facts.themeSelectorEnabled = payload.themeSelectorEnabled;
      facts.onboardingToastEnabled = payload.onboardingToastEnabled;
      facts.versionSelectorEnabled = payload.versionSelectorEnabled;
      facts.voteApiEnabled = payload.voteApiEnabled;
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
      facts.voteApiEnabled = true;
      facts.maintenanceMode = false;
    },
  },

  constraints: {
    onboardingRequiresBrandSwitcher: {
      when: (facts) =>
        facts.onboardingToastEnabled && !facts.brandSwitcherEnabled,
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
          "[feature-flags] Maintenance mode is active. Chat, search, playground, and vote API are disabled.",
        );
      },
    },
  },

  effects: {
    logChanges: {
      deps: [
        "chatEnabled",
        "searchEnabled",
        "playgroundEnabled",
        "brandSwitcherEnabled",
        "themeSelectorEnabled",
        "onboardingToastEnabled",
        "versionSelectorEnabled",
        "voteApiEnabled",
        "maintenanceMode",
      ],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        const flags = [
          "chatEnabled",
          "searchEnabled",
          "playgroundEnabled",
          "brandSwitcherEnabled",
          "themeSelectorEnabled",
          "onboardingToastEnabled",
          "versionSelectorEnabled",
          "voteApiEnabled",
          "maintenanceMode",
        ] as const;

        for (const flag of flags) {
          if (facts[flag] !== prev[flag]) {
            console.log(
              `[feature-flags] ${flag}: ${prev[flag]} → ${facts[flag]}`,
            );
          }
        }
      },
    },
  },
});
