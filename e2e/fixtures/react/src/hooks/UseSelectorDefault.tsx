import { useDirectiveRef, useEvents, useSelector } from "@directive-run/react";
import { TestIds } from "../../../../shared/test-ids";
import { testModule } from "../../../../shared/test-module";

export function UseSelectorDefaultPage() {
  // useDirectiveRef defers start() to useEffect — first render has undefined facts
  const system = useDirectiveRef(testModule);

  // Default value surfaces on first render, then init value takes over after start()
  const name = useSelector(system, (state) => state.name, "pre-start-default");
  const count = useSelector(system, (state) => state.count, -1);

  const events = useEvents(system);

  return (
    <div>
      <span data-testid={TestIds.selectorRefDefault}>{name}</span>
      <span data-testid={TestIds.selectorRefLive}>{count}</span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => events.increment()}
      >
        inc
      </button>
    </div>
  );
}
