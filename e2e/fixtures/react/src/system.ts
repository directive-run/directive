import {
  createRequirementStatusPlugin,
  createSystem,
} from "@directive-run/core";
import { testModule } from "../../../shared/test-module";

const statusPlugin = createRequirementStatusPlugin();

export const system = createSystem({
  module: testModule,
  plugins: [statusPlugin.plugin],
  debug: { timeTravel: true, maxSnapshots: 50 },
});

export { statusPlugin };

system.start();
