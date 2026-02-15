import { createSignal } from "solid-js";
import { useWatch } from "@directive-run/solid";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseWatchPage() {
  const [prev, setPrev] = createSignal("none");
  const [next, setNext] = createSignal("none");
  const [watchCount, setWatchCount] = createSignal(0);

  useWatch(system, "count", (newVal, prevVal) => {
    setPrev(String(prevVal ?? "none"));
    setNext(String(newVal));
    setWatchCount((c) => c + 1);
  });

  return (
    <div>
      <span data-testid={TestIds.watchPrev}>{prev()}</span>
      <span data-testid={TestIds.watchNew}>{next()}</span>
      <span data-testid={TestIds.watchCount}>{watchCount()}</span>
      <button data-testid={TestIds.btnIncrement} onClick={() => system.events.increment()}>
        inc
      </button>
    </div>
  );
}
