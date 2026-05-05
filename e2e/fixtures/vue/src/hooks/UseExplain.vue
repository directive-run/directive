<script setup lang="ts">
import { useExplain, useFact } from "@directive-run/vue";
import { system } from "../system";

const _status = useFact(system, "status");
const _explanation = useExplain(system, "LOAD_DATA:{}");
</script>

<template>
  <div>
    <span :data-testid="TestIds.explainResult">{{ explanation ?? "null" }}</span>
    <span :data-testid="TestIds.factSingle">{{ status }}</span>
    <button :data-testid="TestIds.btnTriggerLoad" @click="system.events.triggerLoad()">
      trigger load
    </button>
    <button :data-testid="TestIds.btnReset" @click="system.events.reset()">
      reset
    </button>
  </div>
</template>
