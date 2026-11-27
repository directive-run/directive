// The all-in fixture (the L13 RFC's B2): one bundle of the seven entries, so
// code shared between them is counted once. Not an app: no app imports every
// entry. A ceiling, to be read beside the engine's other fixtures. Each
// namespace is kept whole, so every export of every entry is in the bundle.
export * as root from "@directive-run/core";
export * as plugins from "@directive-run/core/plugins";
export * as testing from "@directive-run/core/testing";
export * as adapterUtils from "@directive-run/core/adapter-utils";
export * as worker from "@directive-run/core/worker";
export * as migration from "@directive-run/core/migration";
export * as internals from "@directive-run/core/internals";
