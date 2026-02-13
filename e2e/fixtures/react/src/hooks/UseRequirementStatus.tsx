import { useFact } from "directive/react";
import { useRequirementStatus } from "directive/react";
import { system, statusPlugin } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseRequirementStatusPage() {
  const reqStatus = useRequirementStatus(statusPlugin, "LOAD_DATA");
  const status = useFact(system, "status");

  return (
    <div>
      <span data-testid={TestIds.reqStatusPending}>{reqStatus.pending}</span>
      <span data-testid={TestIds.reqStatusLoading}>{String(reqStatus.isLoading)}</span>
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
