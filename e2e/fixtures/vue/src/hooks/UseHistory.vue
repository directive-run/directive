<script setup lang="ts">
import { useFact } from "@directive-run/vue";
import { useHistory } from "@directive-run/vue";
import { system } from "../system";

const count = useFact(system, "count");
const history = useHistory(system);
</script>

<template>
  <div>
    <span :data-testid="TestIds.factSingle">{{ count }}</span>
    <span :data-testid="TestIds.historyEnabled">{{ String(history !== null) }}</span>
    <span :data-testid="TestIds.historyCanUndo">{{ String(history?.canUndo ?? false) }}</span>
    <span :data-testid="TestIds.historyCanRedo">{{ String(history?.canRedo ?? false) }}</span>
    <span :data-testid="TestIds.historyIndex">{{ history?.currentIndex ?? -1 }}</span>
    <span :data-testid="TestIds.historyTotal">{{ history?.totalSnapshots ?? 0 }}</span>
    <button :data-testid="TestIds.btnIncrement" @click="system.events.increment()">
      inc
    </button>
    <button :data-testid="TestIds.btnUndo" @click="history?.undo()">
      undo
    </button>
    <button :data-testid="TestIds.btnRedo" @click="history?.redo()">
      redo
    </button>
  </div>
</template>
