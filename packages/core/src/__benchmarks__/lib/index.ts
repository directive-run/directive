export type { BenchAdapter } from "./types";
export { directiveAdapter } from "./directive-adapter";
export { zustandAdapter } from "./zustand-adapter";
export { reduxAdapter } from "./redux-adapter";
export { mobxAdapter } from "./mobx-adapter";
export { jotaiAdapter } from "./jotai-adapter";
export { signalsAdapter } from "./signals-adapter";
export { xstateAdapter } from "./xstate-adapter";

import { directiveAdapter } from "./directive-adapter";
import { zustandAdapter } from "./zustand-adapter";
import { reduxAdapter } from "./redux-adapter";
import { mobxAdapter } from "./mobx-adapter";
import { jotaiAdapter } from "./jotai-adapter";
import { signalsAdapter } from "./signals-adapter";
import { xstateAdapter } from "./xstate-adapter";

export const adapters = [
  directiveAdapter,
  zustandAdapter,
  reduxAdapter,
  mobxAdapter,
  jotaiAdapter,
  signalsAdapter,
  xstateAdapter,
];
