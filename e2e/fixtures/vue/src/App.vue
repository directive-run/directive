<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import UseFact from "./hooks/UseFact.vue";
import UseDerived from "./hooks/UseDerived.vue";
import UseSelector from "./hooks/UseSelector.vue";
import UseDispatch from "./hooks/UseDispatch.vue";
import UseWatch from "./hooks/UseWatch.vue";
import UseInspect from "./hooks/UseInspect.vue";
import UseEvents from "./hooks/UseEvents.vue";
import UseExplain from "./hooks/UseExplain.vue";
import UseConstraintStatus from "./hooks/UseConstraintStatus.vue";
import UseOptimisticUpdate from "./hooks/UseOptimisticUpdate.vue";
import UseRequirementStatus from "./hooks/UseRequirementStatus.vue";
import UseTimeTravel from "./hooks/UseTimeTravel.vue";
import UseDirective from "./hooks/UseDirective.vue";

const routes: Record<string, any> = {
  useFact: UseFact,
  useDerived: UseDerived,
  useSelector: UseSelector,
  useDispatch: UseDispatch,
  useWatch: UseWatch,
  useInspect: UseInspect,
  useEvents: UseEvents,
  useExplain: UseExplain,
  useConstraintStatus: UseConstraintStatus,
  useOptimisticUpdate: UseOptimisticUpdate,
  useRequirementStatus: UseRequirementStatus,
  useTimeTravel: UseTimeTravel,
  useDirective: UseDirective,
};

const route = ref(window.location.hash.slice(2) || "");

function onHash() {
  route.value = window.location.hash.slice(2);
}

onMounted(() => {
  window.addEventListener("hashchange", onHash);
});

onUnmounted(() => {
  window.removeEventListener("hashchange", onHash);
});
</script>

<template>
  <component v-if="routes[route]" :is="routes[route]" />
  <div v-else>Select a route: {{ Object.keys(routes).join(", ") }}</div>
</template>
