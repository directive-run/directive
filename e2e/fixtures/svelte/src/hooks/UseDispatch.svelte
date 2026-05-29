<script lang="ts">
import { useDispatch, useFact } from "@directive-run/svelte";
import { system } from "../system";

const _count = useFact(system, "count");
const _dispatch = useDispatch(system);
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
