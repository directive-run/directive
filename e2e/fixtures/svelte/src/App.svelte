<script lang="ts">
  import { onMount } from "svelte";
  import UseFactPage from "./hooks/UseFact.svelte";
  import UseDerivedPage from "./hooks/UseDerived.svelte";
  import UseSelectorPage from "./hooks/UseSelector.svelte";
  import UseDispatchPage from "./hooks/UseDispatch.svelte";
  import UseWatchPage from "./hooks/UseWatch.svelte";
  import UseInspectPage from "./hooks/UseInspect.svelte";
  import UseEventsPage from "./hooks/UseEvents.svelte";
  import UseExplainPage from "./hooks/UseExplain.svelte";
  import UseConstraintStatusPage from "./hooks/UseConstraintStatus.svelte";
  import UseOptimisticUpdatePage from "./hooks/UseOptimisticUpdate.svelte";
  import UseRequirementStatusPage from "./hooks/UseRequirementStatus.svelte";
  import UseTimeTravelPage from "./hooks/UseTimeTravel.svelte";
  import UseDirectivePage from "./hooks/UseDirective.svelte";

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
{:else if route === "useTimeTravel"}
  <UseTimeTravelPage />
{:else if route === "useDirective"}
  <UseDirectivePage />
{:else}
  <div>Select a route: useFact, useDerived, useSelector, useDispatch, useWatch, useInspect, useEvents, useExplain, useConstraintStatus, useOptimisticUpdate, useRequirementStatus, useTimeTravel, useDirective</div>
{/if}
