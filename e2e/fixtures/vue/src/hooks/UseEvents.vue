<script setup lang="ts">
import { useEvents, useFact } from "@directive-run/vue";
import { system } from "../system";

const count = useFact(system, "count");
const events = useEvents(system);
</script>

<template>
  <div>
    <span :data-testid="TestIds.eventsResult">{{ count }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="events.increment()">
      inc
    </button>
    <button :data-testid="TestIds.btnDecrement" @click="events.decrement()">
      dec
    </button>
  </div>
</template>
