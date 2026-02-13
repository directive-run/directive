<script lang="ts">
  import { useSelector } from "directive/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const tripled = useSelector(system, (facts) => facts.count * 3);
</script>

<div>
  <span data-testid={TestIds.selectorResult}>{$tripled}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => system.events.increment()}>
    inc
  </button>
</div>
