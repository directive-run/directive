<script lang="ts">
  import { useFact, useInspect } from "directive/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const inspect = useInspect(system);
  const status = useFact(system, "status");
</script>

<div>
  <span data-testid={TestIds.inspectSettled}>{String($inspect.isSettled)}</span>
  <span data-testid={TestIds.inspectWorking}>{String($inspect.isWorking)}</span>
  <span data-testid={TestIds.factSingle}>{$status}</span>
  <button data-testid={TestIds.btnTriggerLoad} on:click={() => system.events.triggerLoad()}>
    trigger load
  </button>
  <button data-testid={TestIds.btnReset} on:click={() => system.events.reset()}>
    reset
  </button>
</div>
