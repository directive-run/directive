<script lang="ts">
  import { useFact, useConstraintStatus } from "@directive-run/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const constraints = useConstraintStatus(system);
  const status = useFact(system, "status");

  $: constraintsList = /** @type {any[]} */ ($constraints) as any[];
  $: activeCount = constraintsList.filter((c) => c.active).length;
  $: constraintCount = constraintsList.length;
</script>

<div>
  <span data-testid={TestIds.constraintList}>{constraintCount}</span>
  <span data-testid={TestIds.constraintActive}>{activeCount}</span>
  <span data-testid={TestIds.factSingle}>{$status}</span>
  <button data-testid={TestIds.btnTriggerLoad} on:click={() => system.events.triggerLoad()}>
    trigger load
  </button>
  <button data-testid={TestIds.btnReset} on:click={() => system.events.reset()}>
    reset
  </button>
</div>
