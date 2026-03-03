import { useFact, useOptimisticUpdate } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { statusPlugin, system } from "../system";

export function UseOptimisticUpdatePage() {
  const count = useFact(system, "count");
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(
    system,
    statusPlugin,
    "LOAD_DATA",
  );

  return (
    <div>
      <span data-testid={TestIds.optimisticValue}>{count()}</span>
      <span data-testid={TestIds.optimisticPending}>{String(isPending())}</span>
      <span data-testid={TestIds.optimisticError}>
        {error()?.message ?? "null"}
      </span>
      <button
        data-testid={TestIds.btnMutate}
        onClick={() =>
          mutate(() => {
            system.facts.count = system.facts.count + 10;
            system.facts.status = "loading";
          })
        }
      >
        mutate
      </button>
      <button data-testid={TestIds.btnRollback} onClick={rollback}>
        rollback
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
