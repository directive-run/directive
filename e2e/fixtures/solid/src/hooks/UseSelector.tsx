import { useSelector } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseSelectorPage() {
  const tripled = useSelector(system, (state) => state.count * 3);

  return (
    <div>
      <span data-testid={TestIds.selectorResult}>{tripled()}</span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => system.events.increment()}
      >
        inc
      </button>
    </div>
  );
}
