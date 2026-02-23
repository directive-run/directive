import { useCallback } from "react";
import { useFact, useEvents } from "@directive-run/react";
import type { SingleModuleSystem } from "@directive-run/core";
import type { featureFlagsModule } from "./module";

type System = SingleModuleSystem<typeof featureFlagsModule.schema>;

interface FlagRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
  testId?: string;
}

function FlagRow({ label, description, checked, onChange, testId }: FlagRowProps) {
  return (
    <div className="flag-row" data-testid={testId}>
      <div>
        <div className="flag-label">{label}</div>
        <div className="flag-desc">{description}</div>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-track" />
        <span className="toggle-thumb" />
      </label>
    </div>
  );
}

interface FlagPanelProps {
  system: System;
  onDisableEffect: (effectId: string) => void;
  onEnableEffect: (effectId: string) => void;
  onDisableConstraint: (constraintId: string) => void;
  onEnableConstraint: (constraintId: string) => void;
  effectsDisabled: Set<string>;
  constraintsDisabled: Set<string>;
}

export function FlagPanel({
  system,
  onDisableEffect,
  onEnableEffect,
  onDisableConstraint,
  onEnableConstraint,
  effectsDisabled,
  constraintsDisabled,
}: FlagPanelProps) {
  const chatEnabled = useFact(system, "chatEnabled") ?? true;
  const searchEnabled = useFact(system, "searchEnabled") ?? true;
  const playgroundEnabled = useFact(system, "playgroundEnabled") ?? true;
  const brandSwitcherEnabled = useFact(system, "brandSwitcherEnabled") ?? true;
  const themeSelectorEnabled = useFact(system, "themeSelectorEnabled") ?? true;
  const onboardingToastEnabled = useFact(system, "onboardingToastEnabled") ?? true;
  const versionSelectorEnabled = useFact(system, "versionSelectorEnabled") ?? true;
  const voteApiEnabled = useFact(system, "voteApiEnabled") ?? true;
  const maintenanceMode = useFact(system, "maintenanceMode") ?? false;
  const events = useEvents(system);

  const toggle = useCallback(
    (flag: string, enabled: boolean) => {
      events.toggleFlag({ flag, enabled });
    },
    [events],
  );

  const handleReset = useCallback(() => {
    events.resetAll();
  }, [events]);

  const logChangesDisabled = effectsDisabled.has("logChanges");
  const constraintDisabled = constraintsDisabled.has("onboardingRequiresBrandSwitcher");

  return (
    <div className="flag-panel">
      <h2>
        Feature Flags
        <button className="btn btn-danger" onClick={handleReset}>
          Reset All
        </button>
      </h2>

      <div className="flag-group">
        <h3>Interactive (maintenance-gated)</h3>
        <FlagRow
          label="Chat"
          description="AI chat assistant"
          checked={chatEnabled}
          onChange={(v) => toggle("chatEnabled", v)}
          testId="ff-flag-chat"
        />
        <FlagRow
          label="Search"
          description="Documentation search"
          checked={searchEnabled}
          onChange={(v) => toggle("searchEnabled", v)}
          testId="ff-flag-search"
        />
        <FlagRow
          label="Playground"
          description="Interactive code playground"
          checked={playgroundEnabled}
          onChange={(v) => toggle("playgroundEnabled", v)}
          testId="ff-flag-playground"
        />
        <FlagRow
          label="Vote API"
          description="Page helpfulness voting"
          checked={voteApiEnabled}
          onChange={(v) => toggle("voteApiEnabled", v)}
          testId="ff-flag-vote-api"
        />
      </div>

      <div className="flag-group">
        <h3>UI</h3>
        <FlagRow
          label="Brand Switcher"
          description="Switch between brand themes"
          checked={brandSwitcherEnabled}
          onChange={(v) => toggle("brandSwitcherEnabled", v)}
          testId="ff-flag-brand-switcher"
        />
        <FlagRow
          label="Theme Selector"
          description="Light / dark theme toggle"
          checked={themeSelectorEnabled}
          onChange={(v) => toggle("themeSelectorEnabled", v)}
          testId="ff-flag-theme-selector"
        />
        <FlagRow
          label="Version Selector"
          description="API version picker"
          checked={versionSelectorEnabled}
          onChange={(v) => toggle("versionSelectorEnabled", v)}
          testId="ff-flag-version-selector"
        />
      </div>

      <div className="flag-group">
        <h3>Dependent (constraint: requires Brand Switcher)</h3>
        <FlagRow
          label="Onboarding Toast"
          description="Welcome toast (requires Brand Switcher)"
          checked={onboardingToastEnabled}
          onChange={(v) => toggle("onboardingToastEnabled", v)}
          testId="ff-flag-onboarding-toast"
        />
      </div>

      <div className="flag-group">
        <h3>System</h3>
        <FlagRow
          label="Maintenance Mode"
          description="Disables chat, search, playground, vote API"
          checked={maintenanceMode}
          onChange={(v) => events.setMaintenanceMode({ enabled: v })}
          testId="ff-maintenance"
        />
        <div className="flag-row">
          <div>
            <div className="flag-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              onboardingRequiresBrandSwitcher
            </div>
          </div>
          <button
            className="btn"
            onClick={() =>
              constraintDisabled
                ? onEnableConstraint("onboardingRequiresBrandSwitcher")
                : onDisableConstraint("onboardingRequiresBrandSwitcher")
            }
          >
            {constraintDisabled ? "Enable" : "Disable"}
          </button>
        </div>
        <div className="flag-row">
          <div>
            <div className="flag-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              logChanges effect
            </div>
          </div>
          <button
            className="btn"
            onClick={() =>
              logChangesDisabled
                ? onEnableEffect("logChanges")
                : onDisableEffect("logChanges")
            }
          >
            {logChangesDisabled ? "Enable" : "Disable"}
          </button>
        </div>
      </div>
    </div>
  );
}
