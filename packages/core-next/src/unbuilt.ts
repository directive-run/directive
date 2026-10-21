/**
 * Stands in for a `@directive-run/core` entry point core-next has not built
 * yet (plugins, testing, migration, adapter-utils, worker). The conformance
 * suite points those specifiers here on v2, so a test file that imports one
 * still loads; its tests sit above the current layer and are skipped. Each
 * entry gets its own file when its layer lands.
 */
export const UNBUILT = true;
