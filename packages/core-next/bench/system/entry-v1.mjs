// v1: the workspace 1.35 engine (packages/core), from its BUILT dist. Own
// process, own adapter. BENCH_V1_BUILD=production picks the production build
// (dev code compiled out) instead of the default one.
import { main } from "./runner.mjs";

await main("v1", () =>
  process.env.BENCH_V1_BUILD === "production"
    ? import("../../../core/dist/production/index.js")
    : import("../../../core/dist/index.js"),
);
