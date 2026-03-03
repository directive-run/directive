import type { createSystem } from "@directive-run/core";
import { useDerived, useFact } from "@directive-run/react";
import type { featureFlagsModule } from "./module";

type System = ReturnType<typeof createSystem<typeof featureFlagsModule.schema>>;

interface PreviewCardProps {
  title: string;
  enabled: boolean;
  detail: string;
}

function PreviewCard({ title, enabled, detail }: PreviewCardProps) {
  return (
    <div className={`ff-preview-card ${enabled ? "enabled" : "disabled"}`}>
      <h4>
        <span className={`ff-status-dot ${enabled ? "on" : "off"}`} />
        {title}
      </h4>
      <p>{detail}</p>
    </div>
  );
}

interface PreviewProps {
  system: System;
}

export function Preview({ system }: PreviewProps) {
  const maintenanceMode = useFact(system, "maintenanceMode") ?? false;

  const canUseChat = useDerived(system, "canUseChat");
  const canUseSearch = useDerived(system, "canUseSearch");
  const canUsePlayground = useDerived(system, "canUsePlayground");
  const canUseBrandSwitcher = useDerived(system, "canUseBrandSwitcher");
  const canUseThemeSelector = useDerived(system, "canUseThemeSelector");
  const canShowOnboardingToast = useDerived(system, "canShowOnboardingToast");
  const canUseVersionSelector = useDerived(system, "canUseVersionSelector");
  const canUseVoteApi = useDerived(system, "canUseVoteApi");
  const enabledCount = useDerived(system, "enabledCount");
  const allFeaturesEnabled = useDerived(system, "allFeaturesEnabled");

  const chatEnabled = useFact(system, "chatEnabled") ?? true;
  const searchEnabled = useFact(system, "searchEnabled") ?? true;
  const playgroundEnabled = useFact(system, "playgroundEnabled") ?? true;
  const voteApiEnabled = useFact(system, "voteApiEnabled") ?? true;
  const onboardingToastEnabled =
    useFact(system, "onboardingToastEnabled") ?? true;
  const brandSwitcherEnabled = useFact(system, "brandSwitcherEnabled") ?? true;

  function maintenanceDetail(flagEnabled: boolean, label: string) {
    if (!flagEnabled) {
      return "Disabled";
    }
    if (maintenanceMode) {
      return "Disabled (maintenance)";
    }

    return `${label} active`;
  }

  return (
    <div className="ff-panel" data-testid="ff-preview">
      <div className="ff-panel-header">Live Preview</div>
      <div className="ff-panel-body">
        <div className="ff-stats-bar">
          <span data-testid="ff-enabled-count">
            Enabled: <strong>{enabledCount}/8</strong>
          </span>
          <span>
            Maintenance: <strong>{maintenanceMode ? "on" : "off"}</strong>
          </span>
          <span>
            All: <strong>{allFeaturesEnabled ? "yes" : "no"}</strong>
          </span>
        </div>

        <div className="ff-preview-grid">
          <PreviewCard
            title="Chat"
            enabled={canUseChat}
            detail={maintenanceDetail(chatEnabled, "AI chat")}
          />
          <PreviewCard
            title="Search"
            enabled={canUseSearch}
            detail={maintenanceDetail(searchEnabled, "Doc search")}
          />
          <PreviewCard
            title="Playground"
            enabled={canUsePlayground}
            detail={maintenanceDetail(playgroundEnabled, "Code playground")}
          />
          <PreviewCard
            title="Vote API"
            enabled={canUseVoteApi}
            detail={maintenanceDetail(voteApiEnabled, "Page voting")}
          />
          <PreviewCard
            title="Brand Switcher"
            enabled={canUseBrandSwitcher}
            detail={canUseBrandSwitcher ? "Brand themes active" : "Disabled"}
          />
          <PreviewCard
            title="Theme Selector"
            enabled={canUseThemeSelector}
            detail={canUseThemeSelector ? "Theme toggle active" : "Disabled"}
          />
          <PreviewCard
            title="Version Selector"
            enabled={canUseVersionSelector}
            detail={
              canUseVersionSelector ? "Version picker active" : "Disabled"
            }
          />
          <PreviewCard
            title="Onboarding Toast"
            enabled={canShowOnboardingToast}
            detail={
              canShowOnboardingToast
                ? "Welcome toast active"
                : !onboardingToastEnabled
                  ? "Disabled"
                  : !brandSwitcherEnabled
                    ? "Waiting for Brand Switcher..."
                    : "Disabled"
            }
          />
        </div>
      </div>
    </div>
  );
}
