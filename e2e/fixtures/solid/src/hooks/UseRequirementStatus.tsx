import { useFact } from "@directive-run/solid";
import { useRequirementStatus } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { statusPlugin, system } from "../system";

export function UseRequirementStatusPage() {
  const reqStatus = useRequirementStatus(statusPlugin, "LOAD_DATA");
  const status = useFact(system, "status");

  return (
    <div>
      <span data-testid={TestIds.reqStatusPending}>{reqStatus().pending}</span>
      <span data-testid={TestIds.reqStatusLoading}>
        {String(reqStatus().isLoading)}
      </span>
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
