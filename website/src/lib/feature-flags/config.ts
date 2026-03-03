// @ts-nocheck
/**
 * Feature Flags System Singleton
 *
 * Creates and configures the Directive system for feature flags.
 * Flags default to enabled; only maintenanceMode reads from an env var.
 */
import { createSystem } from "@directive-run/core";
import { featureFlags } from "./module";

// ---------------------------------------------------------------------------
// Defaults (change here, redeploy)
// ---------------------------------------------------------------------------

const FLAG_DEFAULTS = {
  chatEnabled: true,
  searchEnabled: true,
  playgroundEnabled: true,
  brandSwitcherEnabled: false,
  themeSelectorEnabled: true,
  onboardingToastEnabled: true,
  versionSelectorEnabled: true,
  shareButtonEnabled: true,
} as const;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ReturnType<
  typeof createSystem<(typeof featureFlags)["schema"]>
> | null = null;

export function getFeatureFlagSystem() {
  if (instance) {
    return instance;
  }

  instance = createSystem({ module: featureFlags });
  instance.start();

  // Apply defaults
  instance.events.configure({ ...FLAG_DEFAULTS });

  // Context: maintenance mode from env var (runtime toggle via Vercel dashboard)
  const maintenanceMode =
    typeof process !== "undefined" &&
    process.env?.NEXT_PUBLIC_FF_MAINTENANCE === "true";
  instance.events.setMaintenanceMode({ enabled: maintenanceMode });

  // Context: environment
  const environment =
    typeof process !== "undefined"
      ? (process.env?.VERCEL_ENV ?? process.env?.NODE_ENV ?? "production")
      : "production";
  instance.facts.environment = environment;

  // Brand switcher is dev-only
  if (environment === "development") {
    instance.facts.brandSwitcherEnabled = true;
  }

  // Context: API keys configured (server-side only)
  const apiKeysConfigured =
    typeof process !== "undefined" && !!process.env?.ANTHROPIC_API_KEY;
  instance.facts.apiKeysConfigured = apiKeysConfigured;

  return instance;
}
