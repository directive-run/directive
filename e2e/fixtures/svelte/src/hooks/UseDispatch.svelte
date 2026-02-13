<script lang="ts">
  import { useFact, useDispatch } from "directive/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const count = useFact(system, "count");
  const dispatch = useDispatch(system);
</script>

<div>
  <span data-testid={TestIds.dispatchResult}>{$count}</span>
  <button
    data-testid={TestIds.btnDispatchIncrement}
    on:click={() => dispatch({ type: "increment" })}
  >
    dispatch inc
  </button>
</div>
