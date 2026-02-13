<script setup lang="ts">
import { useDerived } from "directive/vue";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const doubled = useDerived(system, "doubled");
const isPositive = useDerived(system, "isPositive");
const multi = useDerived(system, ["doubled", "isPositive"]);
</script>

<template>
  <div>
    <span :data-testid="TestIds.derivedSingle">{{ doubled }}</span>
    <span :data-testid="TestIds.derivedBool">{{ String(isPositive) }}</span>
    <span :data-testid="TestIds.derivedMulti">{{ JSON.stringify(multi) }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
  </div>
</template>
