<script setup lang="ts">
import { useFact, useInspect } from "directive/vue";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const inspect = useInspect(system);
const status = useFact(system, "status");
</script>

<template>
  <div>
    <span :data-testid="TestIds.inspectSettled">{{ String(inspect.isSettled) }}</span>
    <span :data-testid="TestIds.inspectWorking">{{ String(inspect.isWorking) }}</span>
    <span :data-testid="TestIds.factSingle">{{ status }}</span>
    <button :data-testid="TestIds.btnTriggerLoad" @click="system.events.triggerLoad()">
      trigger load
    </button>
    <button :data-testid="TestIds.btnReset" @click="system.events.reset()">
      reset
    </button>
  </div>
</template>
