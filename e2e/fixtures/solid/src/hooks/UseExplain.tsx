import { useExplain, useFact } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseExplainPage() {
  const status = useFact(system, "status");
  const explanation = useExplain(system, "LOAD_DATA:{}");

  return (
    <div>
      <span data-testid={TestIds.explainResult}>{explanation() ?? "null"}</span>
      <span data-testid={TestIds.factSingle}>{status()}</span>
      <button
        data-testid={TestIds.btnTriggerLoad}
        onClick={() => system.events.triggerLoad()}
      >
        trigger load
      </button>
      <button
        data-testid={TestIds.btnReset}
        onClick={() => system.events.reset()}
      >
        reset
      </button>
    </div>
  );
}
