<script setup lang="ts">
import { computed } from "vue";
import { useFact, useConstraintStatus } from "directive/vue";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const constraints = useConstraintStatus(system);
const status = useFact(system, "status");

const activeCount = computed(() => constraints.value.filter((c) => c.active).length);
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
