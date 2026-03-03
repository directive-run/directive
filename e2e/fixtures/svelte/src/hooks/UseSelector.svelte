<script lang="ts">
import { useSelector } from "@directive-run/svelte";
import { system } from "../system";

const tripled = useSelector(system, (state) => state.count * 3);
</script>

<div>
  <span data-testid={TestIds.selectorResult}>{$tripled}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => system.events.increment()}>
    inc
  </button>
</div>
