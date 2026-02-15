<script lang="ts">
  import { writable } from "svelte/store";
  import { useWatch } from "@directive-run/svelte";
  import { system } from "../system";
  import { TestIds } from "../../../../shared/test-ids";

  const prev = writable("none");
  const next = writable("none");
  const watchCount = writable(0);

  useWatch(system, "count", (newVal: unknown, prevVal: unknown) => {
    prev.set(String(prevVal ?? "none"));
    next.set(String(newVal));
    watchCount.update((c) => c + 1);
  });
</script>

<div>
  <span data-testid={TestIds.watchPrev}>{$prev}</span>
  <span data-testid={TestIds.watchNew}>{$next}</span>
  <span data-testid={TestIds.watchCount}>{$watchCount}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => system.events.increment()}>
    inc
  </button>
</div>
