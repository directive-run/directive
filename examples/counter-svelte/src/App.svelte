<script lang="ts">
  import { useFact, useDerived, useEvents } from "@directive-run/svelte";
  import { system } from "./module";

  system.start();

  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);
</script>

<div style="font-family: system-ui; max-width: 400px; margin: 40px auto; text-align: center">
  <h1>Counter (Svelte)</h1>
  <p style="font-size: 3rem; font-weight: bold; margin: 20px 0">{$count}</p>
  <p style="color: #666; margin-bottom: 20px">Doubled: {$doubled}</p>
  <div style="display: flex; gap: 8px; justify-content: center">
    <button on:click={() => events.decrement()}>-</button>
    <button on:click={() => events.reset()}>Reset</button>
    <button on:click={() => events.increment()}>+</button>
  </div>
  <p style="margin-top: 16px; color: #999; font-size: 0.85rem">
    Try clicking - below zero — the constraint auto-clamps to 0.
  </p>
</div>
