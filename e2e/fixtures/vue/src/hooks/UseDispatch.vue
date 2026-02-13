<script setup lang="ts">
import { useFact, useDispatch } from "directive/vue";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

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
