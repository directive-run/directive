<script lang="ts">
import { useSelector } from "@directive-run/svelte";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

// System is already started, so the init value wins over any pre-start default.
const name = useSelector(system, (state) => state.name ?? "pre-start-default");
const count = useSelector(system, (state) => state.count ?? -1);
</script>

<div>
  <span data-testid={TestIds.selectorRefDefault}>{$name}</span>
  <span data-testid={TestIds.selectorRefLive}>{$count}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => system.events.increment()}>
    inc
  </button>
</div>
