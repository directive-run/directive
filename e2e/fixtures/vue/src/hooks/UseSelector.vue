<script setup lang="ts">
import { useSelector } from "@directive-run/vue";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const tripled = useSelector(system, (facts) => facts.count * 3);
</script>

<template>
  <div>
    <span :data-testid="TestIds.selectorResult">{{ tripled }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
  </div>
</template>
