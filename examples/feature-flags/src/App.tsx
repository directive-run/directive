import { useCallback, useEffect, useState } from "react";
import { createSystem } from "@directive-run/core";
import {persistencePlugin, devtoolsPlugin } from "@directive-run/core/plugins";
import { featureFlagsModule } from "./module";
import { FlagPanel } from "./FlagPanel";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { Timeline, type TimelineEntry } from "./Timeline";

// Create the system with persistence
const system = createSystem({
  module: featureFlagsModule,
  plugins: [
    devtoolsPlugin({ name: "feature-flags" }),
    persistencePlugin({ storage: localStorage, key: "directive-feature-flags-example" }),
  ],
});
system.start();

// Cast to access internal effects/constraints APIs for demo purposes
const engine = system as unknown as {
  effects: { disable(id: string): void; enable(id: string): void };
  constraints: { disable(id: string): void; enable(id: string): void };
};

export function App() {
  useEffect(() => {
    document.body.setAttribute("data-feature-flags-ready", "true");
  }, []);

  const [effectsDisabled, setEffectsDisabled] = useState<Set<string>>(new Set());
  const [constraintsDisabled, setConstraintsDisabled] = useState<Set<string>>(new Set());
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);

  const addTimelineEntry = useCallback((event: string, detail: string, type: string) => {
    setTimelineEntries((prev) => [{ time: Date.now(), event, detail, type }, ...prev]);
  }, []);

  const handleDisableEffect = useCallback((effectId: string) => {
    engine.effects.disable(effectId);
    setEffectsDisabled((prev) => new Set([...prev, effectId]));
    addTimelineEntry("effect off", effectId, "system");
  }, [addTimelineEntry]);

  const handleEnableEffect = useCallback((effectId: string) => {
    engine.effects.enable(effectId);
    setEffectsDisabled((prev) => {
      const next = new Set(prev);
      next.delete(effectId);

      return next;
    });
    addTimelineEntry("effect on", effectId, "system");
  }, [addTimelineEntry]);

  const handleDisableConstraint = useCallback((constraintId: string) => {
    engine.constraints.disable(constraintId);
    setConstraintsDisabled((prev) => new Set([...prev, constraintId]));
    addTimelineEntry("constraint off", constraintId, "system");
  }, [addTimelineEntry]);

  const handleEnableConstraint = useCallback((constraintId: string) => {
    engine.constraints.enable(constraintId);
    setConstraintsDisabled((prev) => {
      const next = new Set(prev);
      next.delete(constraintId);

      return next;
    });
    addTimelineEntry("constraint on", constraintId, "system");
  }, [addTimelineEntry]);

  return (
    <div className="ff-container">
      <div className="ff-main">
        {/* Left: Flag Toggles */}
        <FlagPanel
          system={system}
          onDisableEffect={handleDisableEffect}
          onEnableEffect={handleEnableEffect}
          onDisableConstraint={handleDisableConstraint}
          onEnableConstraint={handleEnableConstraint}
          effectsDisabled={effectsDisabled}
          constraintsDisabled={constraintsDisabled}
          onTimelineEvent={addTimelineEntry}
        />

        {/* Center: Live State Inspector */}
        <Inspector system={system} />

        {/* Right: Preview + Timeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Preview system={system} />
          <div className="ff-panel">
            <div className="ff-panel-body" style={{ flex: 1 }}>
              <Timeline entries={timelineEntries} />
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="ff-how-it-works">
        <h3>How It Works (Directive Flow)</h3>
        <ul>
          <li><strong>Facts</strong> &ndash; chatEnabled, searchEnabled, playgroundEnabled, brandSwitcherEnabled, themeSelectorEnabled, onboardingToastEnabled, versionSelectorEnabled, voteApiEnabled, maintenanceMode</li>
          <li><strong>Derivations</strong> &ndash; canUseChat...canUseVoteApi (8 boolean), enabledCount, allFeaturesEnabled (all auto-tracked)</li>
          <li><strong>Constraints</strong> &ndash; onboardingRequiresBrandSwitcher (auto-enables Brand Switcher), maintenanceWarning</li>
          <li><strong>Resolvers</strong> &ndash; enableBrandSwitcher, logMaintenanceWarning</li>
          <li><strong>Effects</strong> &ndash; logChanges (logs every flag toggle to console)</li>
        </ul>
        <p className="directive-note">The <code>onboardingRequiresBrandSwitcher</code> constraint automatically re-enables Brand Switcher whenever Onboarding Toast is toggled on. Maintenance mode gates chat, search, playground, and vote API via derivations.</p>
      </div>
    </div>
  );
}

export default App;
