<script setup lang="ts">
import { useDirective } from "directive/vue";
import { testModule } from "../../../../shared/test-module";
import { TestIds } from "../../../../shared/test-ids";

const { system, facts, derived, events, dispatch } = useDirective(testModule, {
  facts: ["count", "name"],
  derived: ["doubled"],
  debug: { timeTravel: true, maxSnapshots: 50 },
});
</script>

<template>
  <div>
    <span :data-testid="TestIds.directiveFact">{{ facts.count }}</span>
    <span :data-testid="TestIds.directiveDerived">{{ derived.doubled }}</span>
    <span :data-testid="TestIds.directiveSystem">{{ system ? "valid" : "null" }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="events.increment()">
      inc
    </button>
  </div>
</template>
