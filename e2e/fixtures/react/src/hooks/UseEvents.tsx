import { useEvents, useFact } from "@directive-run/react";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseEventsPage() {
  const count = useFact(system, "count");
  const events = useEvents(system);

  return (
    <div>
      <span data-testid={TestIds.eventsResult}>{count}</span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => events.increment()}
      >
        inc
      </button>
      <button
        data-testid={TestIds.btnDecrement}
        onClick={() => events.decrement()}
      >
        dec
      </button>
    </div>
  );
}
