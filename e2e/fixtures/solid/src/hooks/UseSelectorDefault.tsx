import { useSelector } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseSelectorDefaultPage() {
  // System is already started, so the init value wins over any pre-start default.
  const name = useSelector(
    system,
    (state) => state.name ?? "pre-start-default",
  );
  const count = useSelector(system, (state) => state.count ?? -1);

  return (
    <div>
      <span data-testid={TestIds.selectorRefDefault}>{name()}</span>
      <span data-testid={TestIds.selectorRefLive}>{count()}</span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => system.events.increment()}
      >
        inc
      </button>
    </div>
  );
}
