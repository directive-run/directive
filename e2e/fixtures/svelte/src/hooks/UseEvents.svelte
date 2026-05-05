<script lang="ts">
import { useEvents, useFact } from "@directive-run/svelte";
import { system } from "../system";

const _count = useFact(system, "count");
const _events = useEvents(system);
</script>

<div>
  <span data-testid={TestIds.eventsResult}>{$count}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => events.increment()}>
    inc
  </button>
  <button data-testid={TestIds.btnDecrement} on:click={() => events.decrement()}>
    dec
  </button>
</div>
