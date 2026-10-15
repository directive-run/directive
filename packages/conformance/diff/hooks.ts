/**
 * Every plugin hook, by name, in declaration order.
 *
 * The recorder installs one listener per name. The type assertions below
 * fail the typecheck if this list and the `Plugin` interface ever disagree,
 * on either engine: a hook added to core without being added here would
 * otherwise go unrecorded, and a difference in it would go unnoticed.
 */

import type { Plugin } from "@directive-run/core";
import type { Plugin as PluginV1 } from "directive-v1";

export const PLUGIN_HOOKS = [
  "onInit",
  "onStart",
  "onStop",
  "onDestroy",
  "onFactSet",
  "onFactDelete",
  "onFactsBatch",
  "onDerivationCompute",
  "onDerivationInvalidate",
  "onReconcileStart",
  "onReconcileEnd",
  "onConstraintEvaluate",
  "onConstraintError",
  "onConstraintBindingDisabled",
  "onRequirementCreated",
  "onRequirementMet",
  "onRequirementCanceled",
  "onResolverStart",
  "onResolverComplete",
  "onResolverError",
  "onResolverRetry",
  "onResolverCancel",
  "onResolverWriteRejected",
  "onEffectRun",
  "onEffectError",
  "onEffectWriteBlocked",
  "onSourceAttach",
  "onSourcePublish",
  "onSourceDrop",
  "onSourceDetach",
  "onSourceError",
  "onGuardrailBlocked",
  "onGuardrailCoverage",
  "onClobberLoopDetected",
  "onClobberLoopResolved",
  "onSnapshot",
  "onHistoryNavigate",
  "onError",
  "onErrorRecovery",
  "onDefinitionRegister",
  "onDefinitionAssign",
  "onDefinitionUnregister",
  "onModuleRegistered",
  "onModuleUnregistered",
  "onDefinitionCall",
  "onTraceComplete",
] as const;

export type HookName = (typeof PLUGIN_HOOKS)[number];

/** Hooks whose only argument is the system itself: recorded without it. */
export const SYSTEM_HOOKS: ReadonlySet<HookName> = new Set([
  "onInit",
  "onStart",
  "onStop",
  "onDestroy",
]);

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Hooks<P> = Exclude<keyof P, "name">;

// Compile-time: the list is exactly the hooks of each engine's Plugin type.
export const hooksMatchLocal: Equal<HookName, Hooks<Plugin>> = true;
export const hooksMatchV1: Equal<HookName, Hooks<PluginV1>> = true;
