import { useFact, useInspect } from "@directive-run/react";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseInspectPage() {
  const { isSettled, isWorking } = useInspect(system);
  const status = useFact(system, "status");

  return (
    <div>
      <span data-testid={TestIds.inspectSettled}>{String(isSettled)}</span>
      <span data-testid={TestIds.inspectWorking}>{String(isWorking)}</span>
      <span data-testid={TestIds.factSingle}>{status}</span>
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
