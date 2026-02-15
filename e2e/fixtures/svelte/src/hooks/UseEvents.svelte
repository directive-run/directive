<script lang="ts">
  import { useFact, useEvents } from "@directive-run/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const count = useFact(system, "count");
  const events = useEvents(system);
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
