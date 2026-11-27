// Mutation testing of the 1.35 engine (packages/core/src/core) against the
// conformance suite. See MUTATION.md.
//
// inPlace: the engine lives outside this package (../core/src), so Stryker's
// sandbox copy would not contain it. Stryker writes mutants into the real
// files and restores them afterwards; run it on a clean checkout.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  // pnpm's strict layout hides the runner from core's plugin glob: name it.
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: {
    configFile: "packages/conformance/vitest.stryker.config.ts",
    related: false,
  },
  inPlace: true,
  mutate: [
    "packages/core/src/core/*.ts",
    "!packages/core/src/core/types.ts",
    "!packages/core/src/core/__tests__/**",
    // L13 (the L13 RFC's B3): the subpaths' own files, for a `gate: L13` run
    // (`mutate:file` overrides this list, as for every shard). Their tests
    // sit at L13, so a run below L13 reports them untested, not weak.
    "packages/core/src/utils/testing.ts",
    "packages/core/src/utils/migration.ts",
    "packages/core/src/adapter-utils.ts",
    "packages/core/src/core/types/adapter-utils.ts",
    "packages/core/src/adapters/worker.ts",
  ],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "packages/conformance/.stryker-cache/incremental.json",
  reporters: ["clear-text", "json", "html"],
  jsonReporter: {
    fileName: "packages/conformance/reports/mutation/mutation.json",
  },
  htmlReporter: {
    fileName: "packages/conformance/reports/mutation/mutation.html",
  },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: "packages/conformance/.stryker-tmp",
  concurrency: "75%",
  timeoutMS: 10000,
  ignoreStatic: true,
  disableTypeChecks: true,
};
