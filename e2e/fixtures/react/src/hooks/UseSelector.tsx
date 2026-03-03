import { useSelector } from "@directive-run/react";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseSelectorPage() {
  const tripled = useSelector(system, (state) => state.count * 3);
  const name = useSelector(system, (state) => state.name, "fallback");

  return (
    <div>
      <span data-testid={TestIds.selectorResult}>{tripled}</span>
      <span data-testid={TestIds.selectorDefault}>{name}</span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => system.events.increment()}
      >
        inc
      </button>
    </div>
  );
}
