import { useFact } from "directive/react";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseFactPage() {
  const count = useFact(system, "count");
  const multi = useFact(system, ["count", "name"]);

  return (
    <div>
      <span data-testid={TestIds.factSingle}>{count}</span>
      <span data-testid={TestIds.factMulti}>{multi.count}</span>
      <span data-testid={TestIds.factMultiName}>{multi.name}</span>
      <button data-testid={TestIds.btnIncrement} onClick={() => system.events.increment()}>
        inc
      </button>
      <button data-testid={TestIds.btnSetName} onClick={() => system.events.setName({ name: "world" })}>
        set name
      </button>
    </div>
  );
}
