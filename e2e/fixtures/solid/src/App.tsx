import { type Component, createSignal, onCleanup, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import { UseConstraintStatusPage } from "./hooks/UseConstraintStatus";
import { UseDerivedPage } from "./hooks/UseDerived";
import { UseDirectivePage } from "./hooks/UseDirective";
import { UseDispatchPage } from "./hooks/UseDispatch";
import { UseEventsPage } from "./hooks/UseEvents";
import { UseExplainPage } from "./hooks/UseExplain";
import { UseFactPage } from "./hooks/UseFact";
import { UseInspectPage } from "./hooks/UseInspect";
import { UseOptimisticUpdatePage } from "./hooks/UseOptimisticUpdate";
import { UseRequirementStatusPage } from "./hooks/UseRequirementStatus";
import { UseSelectorPage } from "./hooks/UseSelector";
import { UseHistoryPage } from "./hooks/UseHistory";
import { UseWatchPage } from "./hooks/UseWatch";

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
  useHistory: UseHistoryPage,
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
