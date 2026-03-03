<script lang="ts">
import { useFact } from "@directive-run/svelte";
import { useRequirementStatus } from "@directive-run/svelte";
import { statusPlugin, system } from "../system";

const reqStatus = useRequirementStatus(statusPlugin, "LOAD_DATA");
const status = useFact(system, "status");
</script>

<div>
  <span data-testid={TestIds.reqStatusPending}>{$reqStatus.pending}</span>
  <span data-testid={TestIds.reqStatusLoading}>{String($reqStatus.isLoading)}</span>
  <span data-testid={TestIds.factSingle}>{$status}</span>
  <button data-testid={TestIds.btnTriggerLoad} on:click={() => system.events.triggerLoad()}>
    trigger load
  </button>
  <button data-testid={TestIds.btnReset} on:click={() => system.events.reset()}>
    reset
  </button>
</div>
