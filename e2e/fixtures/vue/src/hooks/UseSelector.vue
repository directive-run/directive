<script setup lang="ts">
import { useSelector } from "@directive-run/vue";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

const tripled = useSelector(system, (state) => state.count * 3);
const name = useSelector(system, (state) => state.name ?? "fallback");
</script>

<template>
  <div>
    <span :data-testid="TestIds.selectorResult">{{ tripled }}</span>
    <span :data-testid="TestIds.selectorDefault">{{ name }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
  </div>
</template>
