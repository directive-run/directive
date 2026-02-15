import { useFact, useExplain } from "@directive-run/react";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseExplainPage() {
  const status = useFact(system, "status");
  // explain() takes a requirement ID — we look for any active one
  const explanation = useExplain(system, "LOAD_DATA:{}");

  return (
    <div>
      <span data-testid={TestIds.explainResult}>{explanation ?? "null"}</span>
      <span data-testid={TestIds.factSingle}>{status}</span>
      <button data-testid={TestIds.btnTriggerLoad} onClick={() => system.events.triggerLoad()}>
        trigger load
      </button>
      <button data-testid={TestIds.btnReset} onClick={() => system.events.reset()}>
        reset
      </button>
    </div>
  );
}
