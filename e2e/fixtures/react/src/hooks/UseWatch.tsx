import { useState } from "react";
import { useWatch } from "@directive-run/react";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

export function UseWatchPage() {
  const [prev, setPrev] = useState<string>("none");
  const [next, setNext] = useState<string>("none");
  const [watchCount, setWatchCount] = useState(0);

  useWatch(system, "count", (newVal, prevVal) => {
    setPrev(String(prevVal ?? "none"));
    setNext(String(newVal));
    setWatchCount((c) => c + 1);
  });

  return (
    <div>
      <span data-testid={TestIds.watchPrev}>{prev}</span>
      <span data-testid={TestIds.watchNew}>{next}</span>
      <span data-testid={TestIds.watchCount}>{watchCount}</span>
      <button data-testid={TestIds.btnIncrement} onClick={() => system.events.increment()}>
        inc
      </button>
    </div>
  );
}
