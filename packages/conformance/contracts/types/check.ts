/**
 * Type contracts, checked against BUILT declarations: `directive-v1` is the
 * published 1.35.0 and `@directive-run/core` the workspace's `dist/`. Never
 * compiled by the package tsconfig; `contracts/types.test.ts` compiles it
 * with a generated tsconfig that maps both specifiers to their `.d.ts`.
 * Every line is a compile-time assertion: it builds or the contract broke.
 */

import {
  type ObservationEvent,
  type Plugin,
  type SystemInspection,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import {
  type ObservationEvent as ObservationEventV1,
  type Plugin as PluginV1,
  type SystemInspection as SystemInspectionV1,
  createModule as createModuleV1,
  createSystem as createSystemV1,
  t as tV1,
} from "directive-v1";
import type { SystemLike as SystemLikeV1 } from "directive-v1/adapter-utils";
import type { OBSERVATION_KINDS_1_35, PLUGIN_HOOKS_1_35 } from "./frozen.js";

/** Strict equality: optionality, readonly and `any` all count. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;

// (a) A system built by either engine satisfies 1.35.0's SystemLike, which
// every published adapter was compiled against.
const single = createSystem({
  module: createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (facts) => {
      facts.n = 0;
    },
  }),
});
const singleV1 = createSystemV1({
  module: createModuleV1("m", {
    schema: { facts: { n: tV1.number() } },
    init: (facts) => {
      facts.n = 0;
    },
  }),
});
export const systemLike: SystemLikeV1[] = [single, singleV1];
// A namespaced system is not SystemLike in 1.35 either (no `facts.$store`);
// it is held to the same inspect() shape below.
const namespaced = createSystem({
  modules: {
    a: createModule("a", { schema: { facts: { n: t.number() } } }),
  },
});

// (b) The Plugin hooks are exactly the frozen 46, on both engines.
type Hooks<P> = Exclude<keyof P, "name">;
type FrozenHook = (typeof PLUGIN_HOOKS_1_35)[number];
export type HooksV1 = Assert<Equal<Hooks<PluginV1>, FrozenHook>>;
export type HooksLocal = Assert<Equal<Hooks<Plugin>, FrozenHook>>;
// …and every hook keeps 1.35's signature: exactly, for every hook whose
// arguments are payloads; for the four lifecycle hooks, which receive the
// whole System, a plugin typed for either engine is a plugin for the other.
// (The two built System types are mutually assignable but not identical;
// the exported System declaration itself is unchanged — see api-surface.)
type SystemHook = "onInit" | "onStart" | "onStop" | "onDestroy";
type PayloadHook = Exclude<FrozenHook, SystemHook>;
export type HookSignatures = Assert<
  Equal<{ [K in PayloadHook]: Plugin[K] }, { [K in PayloadHook]: PluginV1[K] }>
>;
type Hooked<P> = { [K in FrozenHook]: P[K & keyof P] };
export type LifecycleHooks = Assert<
  Hooked<Plugin> extends Hooked<PluginV1>
    ? Hooked<PluginV1> extends Hooked<Plugin>
      ? true
      : false
    : false
>;

// (c) ObservationEvent: 1.35's kinds are the frozen list; the workspace has
// every one of them, each with exactly 1.35's payload. New kinds may be added
// (open union), so this is not an equality on the whole union.
type FrozenKind = (typeof OBSERVATION_KINDS_1_35)[number];
export type KindsV1 = Assert<Equal<ObservationEventV1["type"], FrozenKind>>;
export type KindsLocal = Assert<
  FrozenKind extends ObservationEvent["type"] ? true : false
>;
export type Payloads = Assert<
  Equal<
    { [K in FrozenKind]: Extract<ObservationEvent, { type: K }> },
    { [K in FrozenKind]: Extract<ObservationEventV1, { type: K }> }
  >
>;

// (d) inspect() returns 1.35's SystemInspection, from either system shape.
export type Inspection = Assert<Equal<SystemInspection, SystemInspectionV1>>;
export type InspectSingle = Assert<
  Equal<ReturnType<typeof single.inspect>, SystemInspectionV1>
>;
export type InspectNamespaced = Assert<
  Equal<ReturnType<typeof namespaced.inspect>, SystemInspectionV1>
>;
