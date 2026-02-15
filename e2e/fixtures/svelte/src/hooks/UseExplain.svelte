<script lang="ts">
  import { useFact, useExplain } from "@directive-run/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const status = useFact(system, "status");
  const explanation = useExplain(system, "LOAD_DATA:{}");
</script>

<div>
  <span data-testid={TestIds.explainResult}>{$explanation ?? "null"}</span>
  <span data-testid={TestIds.factSingle}>{$status}</span>
  <button data-testid={TestIds.btnTriggerLoad} on:click={() => system.events.triggerLoad()}>
    trigger load
  </button>
  <button data-testid={TestIds.btnReset} on:click={() => system.events.reset()}>
    reset
  </button>
</div>
