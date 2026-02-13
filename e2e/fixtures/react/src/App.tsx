import { useState, useEffect } from "react";
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

const routes: Record<string, () => JSX.Element> = {
  "useFact": UseFactPage,
  "useDerived": UseDerivedPage,
  "useSelector": UseSelectorPage,
  "useDispatch": UseDispatchPage,
  "useWatch": UseWatchPage,
  "useInspect": UseInspectPage,
  "useEvents": UseEventsPage,
  "useExplain": UseExplainPage,
  "useConstraintStatus": UseConstraintStatusPage,
  "useOptimisticUpdate": UseOptimisticUpdatePage,
  "useRequirementStatus": UseRequirementStatusPage,
  "useTimeTravel": UseTimeTravelPage,
  "useDirective": UseDirectivePage,
};

export function App() {
  const [route, setRoute] = useState(window.location.hash.slice(2) || "");

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(2));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const Page = routes[route];
  if (!Page) return <div>Select a route: {Object.keys(routes).join(", ")}</div>;
  return <Page />;
}
