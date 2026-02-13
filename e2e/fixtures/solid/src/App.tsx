import { createSignal, onMount, onCleanup, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { UseFactPage } from "./hooks/UseFact";
import { UseDerivedPage } from "./hooks/UseDerived";
import { UseSelectorPage } from "./hooks/UseSelector";
import { UseDispatchPage } from "./hooks/UseDispatch";
import { UseWatchPage } from "./hooks/UseWatch";
import { UseInspectPage } from "./hooks/UseInspect";
import { UseEventsPage } from "./hooks/UseEvents";
import { UseExplainPage } from "./hooks/UseExplain";
import { UseConstraintStatusPage } from "./hooks/UseConstraintStatus";
import { UseOptimisticUpdatePage } from "./hooks/UseOptimisticUpdate";
import { UseRequirementStatusPage } from "./hooks/UseRequirementStatus";
import { UseTimeTravelPage } from "./hooks/UseTimeTravel";
import { UseDirectivePage } from "./hooks/UseDirective";

const routes: Record<string, Component> = {
  useFact: UseFactPage,
  useDerived: UseDerivedPage,
  useSelector: UseSelectorPage,
  useDispatch: UseDispatchPage,
  useWatch: UseWatchPage,
  useInspect: UseInspectPage,
  useEvents: UseEventsPage,
  useExplain: UseExplainPage,
  useConstraintStatus: UseConstraintStatusPage,
  useOptimisticUpdate: UseOptimisticUpdatePage,
  useRequirementStatus: UseRequirementStatusPage,
  useTimeTravel: UseTimeTravelPage,
  useDirective: UseDirectivePage,
};

const App: Component = () => {
  const [route, setRoute] = createSignal(window.location.hash.slice(2) || "");

  onMount(() => {
    const onHash = () => setRoute(window.location.hash.slice(2));
    window.addEventListener("hashchange", onHash);
    onCleanup(() => window.removeEventListener("hashchange", onHash));
  });

  const Page = () => routes[route()];

  return (
    <>
      {Page() ? (
        <Dynamic component={Page()} />
      ) : (
        <div>Select a route: {Object.keys(routes).join(", ")}</div>
      )}
    </>
  );
};

export default App;
