import { useDerived } from "directive/react";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseDerivedPage() {
  const doubled = useDerived(system, "doubled");
  const isPositive = useDerived(system, "isPositive");
  const multi = useDerived(system, ["doubled", "isPositive"]);

  return (
    <div>
      <span data-testid={TestIds.derivedSingle}>{doubled}</span>
      <span data-testid={TestIds.derivedBool}>{String(isPositive)}</span>
      <span data-testid={TestIds.derivedMulti}>{JSON.stringify(multi)}</span>
      <button data-testid={TestIds.btnIncrement} onClick={() => system.events.increment()}>
        inc
      </button>
    </div>
  );
}
