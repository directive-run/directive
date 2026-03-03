<script setup lang="ts">
import { useFact } from "@directive-run/vue";
import { system } from "../system";

const count = useFact(system, "count");
const multi = useFact(system, ["count", "name"]);
</script>

<template>
  <div>
    <span :data-testid="TestIds.factSingle">{{ count }}</span>
    <span :data-testid="TestIds.factMulti">{{ multi.count }}</span>
    <span :data-testid="TestIds.factMultiName">{{ multi.name }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
    <button :data-testid="TestIds.btnSetName" @click="system.events.setName({ name: 'world' })">
      set name
    </button>
  </div>
</template>
