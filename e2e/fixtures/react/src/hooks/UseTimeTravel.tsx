import { useFact } from "@directive-run/react";
import { useTimeTravel } from "@directive-run/react";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseTimeTravelPage() {
  const count = useFact(system, "count");
  const tt = useTimeTravel(system);

  return (
    <div>
      <span data-testid={TestIds.factSingle}>{count}</span>
      <span data-testid={TestIds.timeTravelEnabled}>{String(tt !== null)}</span>
      <span data-testid={TestIds.timeTravelCanUndo}>
        {String(tt?.canUndo ?? false)}
      </span>
      <span data-testid={TestIds.timeTravelCanRedo}>
        {String(tt?.canRedo ?? false)}
      </span>
      <span data-testid={TestIds.timeTravelIndex}>
        {tt?.currentIndex ?? -1}
      </span>
      <span data-testid={TestIds.timeTravelTotal}>
        {tt?.totalSnapshots ?? 0}
      </span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => system.events.increment()}
      >
        inc
      </button>
      <button data-testid={TestIds.btnUndo} onClick={() => tt?.undo()}>
        undo
      </button>
      <button data-testid={TestIds.btnRedo} onClick={() => tt?.redo()}>
        redo
      </button>
    </div>
  );
}
