<script setup lang="ts">
import { useFact, useOptimisticUpdate } from "@directive-run/vue";
import { system, statusPlugin } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const count = useFact(system, "count");
const { mutate, isPending, error, rollback } = useOptimisticUpdate(
  system,
  statusPlugin,
  "LOAD_DATA",
);

function handleMutate() {
  mutate(() => {
    system.facts.count = system.facts.count + 10;
    system.facts.status = "loading";
  });
}
</script>

<template>
  <div>
    <span :data-testid="TestIds.optimisticValue">{{ count }}</span>
    <span :data-testid="TestIds.optimisticPending">{{ String(isPending) }}</span>
    <span :data-testid="TestIds.optimisticError">{{ error?.message ?? "null" }}</span>
    <button :data-testid="TestIds.btnMutate" @click="handleMutate">
      mutate
    </button>
    <button :data-testid="TestIds.btnRollback" @click="rollback">
      rollback
    </button>
    <button :data-testid="TestIds.btnReset" @click="system.events.reset()">
      reset
    </button>
  </div>
</template>
