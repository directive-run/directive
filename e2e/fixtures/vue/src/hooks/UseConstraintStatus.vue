<script setup lang="ts">
import { useConstraintStatus, useFact } from "@directive-run/vue";
import { computed } from "vue";
import { system } from "../system";

const constraints = useConstraintStatus(system);
const status = useFact(system, "status");

const activeCount = computed(
  () => constraints.value.filter((c) => c.active).length,
);
</script>

<template>
  <div>
    <span :data-testid="TestIds.constraintList">{{ constraints.length }}</span>
    <span :data-testid="TestIds.constraintActive">{{ activeCount }}</span>
    <span :data-testid="TestIds.factSingle">{{ status }}</span>
    <button :data-testid="TestIds.btnTriggerLoad" @click="system.events.triggerLoad()">
      trigger load
    </button>
    <button :data-testid="TestIds.btnReset" @click="system.events.reset()">
      reset
    </button>
  </div>
</template>
