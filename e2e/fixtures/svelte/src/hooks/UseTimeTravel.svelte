<script lang="ts">
  import { useFact, useTimeTravel } from "@directive-run/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const count = useFact(system, "count");
  const tt = useTimeTravel(system);
</script>

<div>
  <span data-testid={TestIds.factSingle}>{$count}</span>
  <span data-testid={TestIds.timeTravelEnabled}>{String($tt !== null)}</span>
  <span data-testid={TestIds.timeTravelCanUndo}>{String($tt?.canUndo ?? false)}</span>
  <span data-testid={TestIds.timeTravelCanRedo}>{String($tt?.canRedo ?? false)}</span>
  <span data-testid={TestIds.timeTravelIndex}>{$tt?.currentIndex ?? -1}</span>
  <span data-testid={TestIds.timeTravelTotal}>{$tt?.totalSnapshots ?? 0}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => system.events.increment()}>
    inc
  </button>
  <button data-testid={TestIds.btnUndo} on:click={() => $tt?.undo()}>
    undo
  </button>
  <button data-testid={TestIds.btnRedo} on:click={() => $tt?.redo()}>
    redo
  </button>
</div>
