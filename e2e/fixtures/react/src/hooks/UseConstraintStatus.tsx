import { useFact, useConstraintStatus } from "@directive-run/react";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseConstraintStatusPage() {
  const constraints = useConstraintStatus(system);
  const status = useFact(system, "status");

  const activeCount = constraints.filter((c) => c.active).length;

  return (
    <div>
      <span data-testid={TestIds.constraintList}>{constraints.length}</span>
      <span data-testid={TestIds.constraintActive}>{activeCount}</span>
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
