<script setup lang="ts">
import { useFact } from "directive/vue";
import { useRequirementStatus } from "directive/vue";
import { system, statusPlugin } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const reqStatus = useRequirementStatus(statusPlugin, "LOAD_DATA");
const status = useFact(system, "status");
</script>

<template>
  <div>
    <span :data-testid="TestIds.reqStatusPending">{{ reqStatus.pending }}</span>
    <span :data-testid="TestIds.reqStatusLoading">{{ String(reqStatus.isLoading) }}</span>
    <span :data-testid="TestIds.factSingle">{{ status }}</span>
    <button :data-testid="TestIds.btnTriggerLoad" @click="system.events.triggerLoad()">
      trigger load
    </button>
    <button :data-testid="TestIds.btnReset" @click="system.events.reset()">
      reset
    </button>
  </div>
</template>
