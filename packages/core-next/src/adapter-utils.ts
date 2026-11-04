/**
 * `@directive-run/core/adapter-utils` on core-next: not built yet (the
 * helpers the framework adapters share).
 * 1.35's exports with 1.35's names and signatures, taken from
 * packages/conformance/contracts/api-surface.json. Each function throws
 * `featureMissing` (code E_FEATURE_MISSING) when called; the entry arrives
 * in layer 13. Generated for the alpha.0 tarball (slice P3-F5).
 */
import { featureMissing } from "./api/missing.js";
import type { Facts } from "./types/facts.js";
import type { Plugin } from "./types/plugins.js";
import type { Requirement } from "./types/requirements.js";
import type { Schema } from "./types/schema.js";
import type {
  HistoryAPI,
  HistoryState,
  SystemInspection,
} from "./types/system.js";

// 1.35 declares this here without exporting it.
interface AdapterCallbacks {
  onRequirementCreated?: (req: Requirement) => void;
  onRequirementResolved?: (req: Requirement) => void;
  onError?: (error: Error) => void;
}

export interface ConstraintInfo {
  id: string;
  active: boolean;
  priority: number;
}

export interface InspectState {
  isSettled: boolean;
  unmet: RequirementsState["unmet"];
  inflight: RequirementsState["inflight"];
  isWorking: boolean;
  hasUnmet: boolean;
  hasInflight: boolean;
}

export interface RequirementsState {
  unmet: Array<{
    id: string;
    requirement: {
      type: string;
      [key: string]: unknown;
    };
    fromConstraint: string;
  }>;
  inflight: Array<{
    id: string;
    resolverId: string;
    startedAt: number;
  }>;
  hasUnmet: boolean;
  hasInflight: boolean;
  isWorking: boolean;
}

export interface SystemLike {
  readonly isSettled: boolean;
  readonly history: HistoryAPI | null;
  readonly facts: {
    $store: {
      get(key: string): unknown;
      has(key: string): boolean;
      toObject(): Record<string, unknown>;
    };
  };
  readonly derive?: Record<string, unknown>;
  read(key: string): unknown;
  inspect(): SystemInspection;
}

export interface ThrottledHookOptions {
  throttleMs?: number;
}

export interface TrackedSelectorResult<R> {
  value: R;
  factKeys: string[];
  deriveKeys: string[];
}

export function assertSystem(hookName: string, system: unknown): void;
export function assertSystem(): never {
  return featureMissing("assertSystem", 13);
}

export function buildHistoryState(system: SystemLike): HistoryState | null;
export function buildHistoryState(): never {
  return featureMissing("buildHistoryState", 13);
}

export function computeInspectState(system: SystemLike): InspectState;
export function computeInspectState(): never {
  return featureMissing("computeInspectState", 13);
}

export function createCallbackPlugin(
  name: string,
  callbacks: AdapterCallbacks,
): Plugin<any>;
export function createCallbackPlugin(): never {
  return featureMissing("createCallbackPlugin", 13);
}

export function createThrottle<T extends (...args: unknown[]) => void>(
  callback: T,
  ms: number,
): {
  throttled: T;
  cleanup: () => void;
};
export function createThrottle(): never {
  return featureMissing("createThrottle", 13);
}

export function defaultEquality<T>(a: T, b: T): boolean;
export function defaultEquality(): never {
  return featureMissing("defaultEquality", 13);
}

export function depsChanged(
  prevFacts: string[],
  newFacts: string[],
  prevDerived: string[],
  newDerived: string[],
): boolean;
export function depsChanged(): never {
  return featureMissing("depsChanged", 13);
}

export function getBridgeFact<V>(facts: Facts<Schema>, key: string): V;
export function getBridgeFact(): never {
  return featureMissing("getBridgeFact", 13);
}

export function mergeHydrationFacts(
  snapshot:
    | {
        data?: Record<string, unknown>;
      }
    | Record<string, unknown>
    | undefined
    | null,
  initialFacts?: Record<string, unknown>,
): Record<string, unknown>;
export function mergeHydrationFacts(): never {
  return featureMissing("mergeHydrationFacts", 13);
}

export function pickFacts(
  system: SystemLike,
  keys: string[],
): Record<string, unknown>;
export function pickFacts(): never {
  return featureMissing("pickFacts", 13);
}

export function requirementGuard<R extends Requirement>(
  type: R["type"],
): (req: Requirement) => req is R;
export function requirementGuard(): never {
  return featureMissing("requirementGuard", 13);
}

export function requirementGuardMultiple<R extends Requirement>(
  types: R["type"][],
): (req: Requirement) => req is R;
export function requirementGuardMultiple(): never {
  return featureMissing("requirementGuardMultiple", 13);
}

export function runTrackedSelector<R>(
  system: SystemLike,
  deriveKeySet: Set<string>,
  selector: (state: Record<string, unknown>) => R,
): TrackedSelectorResult<R>;
export function runTrackedSelector(): never {
  return featureMissing("runTrackedSelector", 13);
}

export function setBridgeFact<V>(
  facts: Facts<Schema>,
  key: string,
  value: V,
): void;
export function setBridgeFact(): never {
  return featureMissing("setBridgeFact", 13);
}

export function shallowEqual<T extends Record<string, unknown>>(
  a: T,
  b: T,
): boolean;
export function shallowEqual(): never {
  return featureMissing("shallowEqual", 13);
}
