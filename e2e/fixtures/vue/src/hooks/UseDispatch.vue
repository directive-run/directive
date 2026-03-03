<script setup lang="ts">
import { useDispatch, useFact } from "@directive-run/vue";
import { system } from "../system";

const count = useFact(system, "count");
const dispatch = useDispatch(system);
</script>

<template>
  <div>
    <span :data-testid="TestIds.dispatchResult">{{ count }}</span>
    <button
      :data-testid="TestIds.btnDispatchIncrement"
      @click="dispatch({ type: 'increment' })"
    >
      dispatch inc
    </button>
  </div>
</template>
