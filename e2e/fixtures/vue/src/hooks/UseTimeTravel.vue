<script setup lang="ts">
import { useFact } from "@directive-run/vue";
import { useTimeTravel } from "@directive-run/vue";
import { system } from "../system";

const count = useFact(system, "count");
const tt = useTimeTravel(system);
</script>

<template>
  <div>
    <span :data-testid="TestIds.factSingle">{{ count }}</span>
    <span :data-testid="TestIds.timeTravelEnabled">{{ String(tt !== null) }}</span>
    <span :data-testid="TestIds.timeTravelCanUndo">{{ String(tt?.canUndo ?? false) }}</span>
    <span :data-testid="TestIds.timeTravelCanRedo">{{ String(tt?.canRedo ?? false) }}</span>
    <span :data-testid="TestIds.timeTravelIndex">{{ tt?.currentIndex ?? -1 }}</span>
    <span :data-testid="TestIds.timeTravelTotal">{{ tt?.totalSnapshots ?? 0 }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
    <button :data-testid="TestIds.btnUndo" @click="tt?.undo()">
      undo
    </button>
    <button :data-testid="TestIds.btnRedo" @click="tt?.redo()">
      redo
    </button>
  </div>
</template>
