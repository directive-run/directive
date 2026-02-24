import { useFact, useDerived } from "@directive-run/react";
import type { SingleModuleSystem } from "@directive-run/core";
import type { featureFlagsModule } from "./module";

type System = SingleModuleSystem<typeof featureFlagsModule.schema>;

interface InspectorProps {
  system: System;
}

function BoolIndicator({ value }: { value: boolean }) {
  return (
    <>
      <span className={`ff-deriv-indicator ${value}`} />
      {" "}{String(value)}
    </>
  );
}

export function Inspector({ system }: InspectorProps) {
  const chatEnabled = useFact(system, "chatEnabled") ?? true;
  const searchEnabled = useFact(system, "searchEnabled") ?? true;
  const playgroundEnabled = useFact(system, "playgroundEnabled") ?? true;
  const brandSwitcherEnabled = useFact(system, "brandSwitcherEnabled") ?? true;
  const themeSelectorEnabled = useFact(system, "themeSelectorEnabled") ?? true;
  const onboardingToastEnabled = useFact(system, "onboardingToastEnabled") ?? true;
  const versionSelectorEnabled = useFact(system, "versionSelectorEnabled") ?? true;
  const voteApiEnabled = useFact(system, "voteApiEnabled") ?? true;
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

  return (
    <div className="ff-panel">
      <div className="ff-panel-header">Live State Inspector</div>
      <div className="ff-panel-body">
        <div className="ff-inspector-section">
          <div className="ff-inspector-title">Facts</div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">chatEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={chatEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">searchEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={searchEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">playgroundEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={playgroundEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">brandSwitcherEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={brandSwitcherEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">themeSelectorEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={themeSelectorEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">onboardingToastEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={onboardingToastEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">versionSelectorEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={versionSelectorEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">voteApiEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={voteApiEnabled} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">maintenanceMode</span>
            <span className="ff-inspector-value"><BoolIndicator value={maintenanceMode} /></span>
          </div>
        </div>

        <div className="ff-inspector-section">
          <div className="ff-inspector-title">Derivations</div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUseChat</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUseChat} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUseSearch</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUseSearch} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUsePlayground</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUsePlayground} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUseBrandSwitcher</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUseBrandSwitcher} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUseThemeSelector</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUseThemeSelector} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canShowOnboardingToast</span>
            <span className="ff-inspector-value"><BoolIndicator value={canShowOnboardingToast} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUseVersionSelector</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUseVersionSelector} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">canUseVoteApi</span>
            <span className="ff-inspector-value"><BoolIndicator value={canUseVoteApi} /></span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">enabledCount</span>
            <span className="ff-inspector-value">{enabledCount}/8</span>
          </div>
          <div className="ff-inspector-row">
            <span className="ff-inspector-key">allFeaturesEnabled</span>
            <span className="ff-inspector-value"><BoolIndicator value={allFeaturesEnabled} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
