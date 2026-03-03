<script lang="ts">
import { useFact, useOptimisticUpdate } from "@directive-run/svelte";
import { statusPlugin, system } from "../system";

const count = useFact(system, "count");
const { mutate, isPending, error, rollback } = useOptimisticUpdate(
  system,
  statusPlugin,
  "LOAD_DATA",
);

function handleMutate() {
  mutate(() => {
    system.facts.count = system.facts.count + 10;
    system.facts.status = "loading";
  });
}
</script>

<div>
  <span data-testid={TestIds.optimisticValue}>{$count}</span>
  <span data-testid={TestIds.optimisticPending}>{String($isPending)}</span>
  <span data-testid={TestIds.optimisticError}>{$error?.message ?? "null"}</span>
  <button data-testid={TestIds.btnMutate} on:click={handleMutate}>
    mutate
  </button>
  <button data-testid={TestIds.btnRollback} on:click={rollback}>
    rollback
  </button>
  <button data-testid={TestIds.btnReset} on:click={() => system.events.reset()}>
    reset
  </button>
</div>
