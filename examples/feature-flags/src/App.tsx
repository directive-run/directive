import { useCallback, useEffect, useState } from "react";
import { createSystem } from "@directive-run/core";
import { persistencePlugin } from "@directive-run/core/plugins";
import { featureFlagsModule } from "./module";
import { FlagPanel } from "./FlagPanel";
import { Preview } from "./Preview";

// Create the system with persistence
const system = createSystem({
  module: featureFlagsModule,
  plugins: [
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

  const handleDisableEffect = useCallback((effectId: string) => {
    engine.effects.disable(effectId);
    setEffectsDisabled((prev) => new Set([...prev, effectId]));
  }, []);

  const handleEnableEffect = useCallback((effectId: string) => {
    engine.effects.enable(effectId);
    setEffectsDisabled((prev) => {
      const next = new Set(prev);
      next.delete(effectId);

      return next;
    });
  }, []);

  const handleDisableConstraint = useCallback((constraintId: string) => {
    engine.constraints.disable(constraintId);
    setConstraintsDisabled((prev) => new Set([...prev, constraintId]));
  }, []);

  const handleEnableConstraint = useCallback((constraintId: string) => {
    engine.constraints.enable(constraintId);
    setConstraintsDisabled((prev) => {
      const next = new Set(prev);
      next.delete(constraintId);

      return next;
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Feature Flags on directive.run</h1>
        <p>
          The same 8 flags that gate features on the real doc site. Constraints enforce dependencies automatically.
        </p>
      </header>

      <div className="split-pane">
        <FlagPanel
          system={system}
          onDisableEffect={handleDisableEffect}
          onEnableEffect={handleEnableEffect}
          onDisableConstraint={handleDisableConstraint}
          onEnableConstraint={handleEnableConstraint}
          effectsDisabled={effectsDisabled}
          constraintsDisabled={constraintsDisabled}
        />
        <Preview system={system} />
      </div>
    </div>
  );
}

export default App;
