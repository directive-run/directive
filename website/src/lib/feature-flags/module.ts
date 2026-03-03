// @ts-nocheck
/**
 * Feature Flags Directive Module
 *
 * Dogfooding Directive to gate interactive features on the doc site.
 * Facts are boolean flags, derivations compute composite "can use" values,
 * and constraints enforce cross-flag dependencies.
 */
import { createModule, t } from "@directive-run/core";

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const featureFlags = createModule("feature-flags", {
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
      shareButtonEnabled: t.boolean(),

      // Context facts
      environment: t.string(),
      maintenanceMode: t.boolean(),
      apiKeysConfigured: t.boolean(),
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

    facts.environment = "production";
    facts.maintenanceMode = false;
    facts.apiKeysConfigured = false;
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
    canUseShareButton: (facts) => facts.shareButtonEnabled,
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
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "[feature-flags] Maintenance mode is active. Chat, search, and playground are disabled.",
          );
        }
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
        "shareButtonEnabled",
        "maintenanceMode",
      ],
      run: (facts, prev) => {
        if (process.env.NODE_ENV !== "development") {
          return;
        }

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
          "shareButtonEnabled",
          "maintenanceMode",
        ] as const;

        for (const flag of flags) {
          if (facts[flag] !== prev[flag]) {
            console.log(
              `[feature-flags] ${flag}: ${prev[flag]} -> ${facts[flag]}`,
            );
          }
        }
      },
    },
  },
});
