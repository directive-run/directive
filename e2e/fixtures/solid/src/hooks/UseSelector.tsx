import { useSelector } from "directive/solid";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseSelectorPage() {
  const tripled = useSelector(system, (facts) => facts.count * 3);

  return (
    <div>
      <span data-testid={TestIds.selectorResult}>{tripled()}</span>
      <button data-testid={TestIds.btnIncrement} onClick={() => system.events.increment()}>
        inc
      </button>
    </div>
  );
}
