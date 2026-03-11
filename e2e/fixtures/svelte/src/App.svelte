<script lang="ts">
import { onMount } from "svelte";

let route = window.location.hash.slice(2) || "";

function onHash() {
  route = window.location.hash.slice(2);
}

onMount(() => {
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
});
</script>

{#if route === "useFact"}
  <UseFactPage />
{:else if route === "useDerived"}
  <UseDerivedPage />
{:else if route === "useSelector"}
  <UseSelectorPage />
{:else if route === "useDispatch"}
  <UseDispatchPage />
{:else if route === "useWatch"}
  <UseWatchPage />
{:else if route === "useInspect"}
  <UseInspectPage />
{:else if route === "useEvents"}
  <UseEventsPage />
{:else if route === "useExplain"}
  <UseExplainPage />
{:else if route === "useConstraintStatus"}
  <UseConstraintStatusPage />
{:else if route === "useOptimisticUpdate"}
  <UseOptimisticUpdatePage />
{:else if route === "useRequirementStatus"}
  <UseRequirementStatusPage />
{:else if route === "useHistory"}
  <UseHistoryPage />
{:else if route === "useDirective"}
  <UseDirectivePage />
{:else}
  <div>Select a route: useFact, useDerived, useSelector, useDispatch, useWatch, useInspect, useEvents, useExplain, useConstraintStatus, useOptimisticUpdate, useRequirementStatus, useHistory, useDirective</div>
{/if}
