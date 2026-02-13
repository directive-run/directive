<script setup lang="ts">
import { ref } from "vue";
import { useWatch } from "directive/vue";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const prev = ref<string>("none");
const next = ref<string>("none");
const watchCount = ref(0);

useWatch(system, "count", (newVal, prevVal) => {
  prev.value = String(prevVal ?? "none");
  next.value = String(newVal);
  watchCount.value++;
});
</script>

<template>
  <div>
    <span :data-testid="TestIds.watchPrev">{{ prev }}</span>
    <span :data-testid="TestIds.watchNew">{{ next }}</span>
    <span :data-testid="TestIds.watchCount">{{ watchCount }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
  </div>
</template>
