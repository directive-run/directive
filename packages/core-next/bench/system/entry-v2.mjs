// v2: core-next, from its BUILT dist (what ships, mangled). Own process, own
// adapter.
import { main } from "./runner.mjs";

await main("v2", () => import("../../dist/index.js"));
