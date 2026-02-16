import { useSelector } from "@directive-run/react";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseSelectorPage() {
  const tripled = useSelector(system, (facts) => facts.count * 3);
  const name = useSelector(system, (facts) => facts.name, "fallback");

  return (
    <div>
      <span data-testid={TestIds.selectorResult}>{tripled}</span>
      <span data-testid={TestIds.selectorDefault}>{name}</span>
      <button data-testid={TestIds.btnIncrement} onClick={() => system.events.increment()}>
        inc
      </button>
    </div>
  );
}
