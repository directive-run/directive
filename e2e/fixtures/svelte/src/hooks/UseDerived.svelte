<script lang="ts">
import { useDerived } from "@directive-run/svelte";
import { system } from "../system";

const doubled = useDerived(system, "doubled");
const isPositive = useDerived(system, "isPositive");
const multi = useDerived(system, ["doubled", "isPositive"]);
</script>

<div>
  <span data-testid={TestIds.derivedSingle}>{$doubled}</span>
  <span data-testid={TestIds.derivedBool}>{String($isPositive)}</span>
  <span data-testid={TestIds.derivedMulti}>{JSON.stringify($multi)}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => system.events.increment()}>
    inc
  </button>
</div>
