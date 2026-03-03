import { useDispatch, useFact } from "@directive-run/react";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseDispatchPage() {
  const count = useFact(system, "count");
  const dispatch = useDispatch(system);

  return (
    <div>
      <span data-testid={TestIds.dispatchResult}>{count}</span>
      <button
        data-testid={TestIds.btnDispatchIncrement}
        onClick={() => dispatch({ type: "increment" })}
      >
        dispatch inc
      </button>
    </div>
  );
}
