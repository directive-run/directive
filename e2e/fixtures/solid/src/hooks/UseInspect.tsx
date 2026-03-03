import { useFact, useInspect } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseInspectPage() {
  const inspect = useInspect(system);
  const status = useFact(system, "status");

  return (
    <div>
      <span data-testid={TestIds.inspectSettled}>
        {String(inspect().isSettled)}
      </span>
      <span data-testid={TestIds.inspectWorking}>
        {String(inspect().isWorking)}
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
