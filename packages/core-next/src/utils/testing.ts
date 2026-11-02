/**
 * `@directive-run/core/testing`, as far as L2 needs it: 1.35's
 * `flushMicrotasks`. The rest of the subpath is L13: stubs with 1.35's names
 * and signatures that throw `featureMissing` when called (P3-F3). Its own
 * entry, so nothing here reaches a bundle that does not import it.
 */

import { featureMissing } from "../api/missing.js";
import type {
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  ObservationEvent,
  Requirement,
  SingleModuleSystem,
  SystemInspection,
} from "../types/index.js";
import type {
  CoverageReport,
  CreateTestSystemOptions,
  CreateTestSystemOptionsSingle,
  FakeTimers,
  MockResolver,
  MockResolverContext,
  MockResolverDef,
  MockResolverOptions,
  TestSystem,
  TestSystemSingle,
} from "../types/testing.js";

/** Ten microtask turns: lets a pass, a run and its follow-ups settle. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// 1.35's public types for this entry, exactly: copied from 1.35 into
// src/types/ (types only, no runtime code).
export type {
  CoverageReport,
  CreateTestSystemOptions,
  CreateTestSystemOptionsSingle,
  FactChangeRecord,
  FakeTimers,
  MockResolver,
  MockResolverContext,
  MockResolverOptions,
  TestSystem,
  TestSystemBase,
  TestSystemSingle,
} from "../types/testing.js";

// --- not built yet (layer 13): 1.35's exports, throwing when called ---------

export function assertDynamic(
  system: {
    constraints: {
      isDynamic(id: string): boolean;
    };
    effects: {
      isDynamic(id: string): boolean;
    };
    resolvers: {
      isDynamic(id: string): boolean;
    };
    derive: {
      isDynamic(id: string): boolean;
    };
  },
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string,
): void;
export function assertDynamic(): never {
  return featureMissing("assertDynamic", 13);
}

export function assertNotDynamic(
  system: {
    constraints: {
      isDynamic(id: string): boolean;
    };
    effects: {
      isDynamic(id: string): boolean;
    };
    resolvers: {
      isDynamic(id: string): boolean;
    };
    derive: {
      isDynamic(id: string): boolean;
    };
  },
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string,
): void;
export function assertNotDynamic(): never {
  return featureMissing("assertNotDynamic", 13);
}

export function createCoverageTracker(
  system: SingleModuleSystem<any> | NamespacedSystem<any>,
): {
  run: (scenario: () => Promise<void> | void) => Promise<void>;
  report: () => CoverageReport;
};
export function createCoverageTracker(): never {
  return featureMissing("createCoverageTracker", 13);
}

export function createFakeTimers(): FakeTimers;
export function createFakeTimers(): never {
  return featureMissing("createFakeTimers", 13);
}

export function createMockResolver<R extends Requirement = Requirement>(
  typeOrOptions: string | MockResolverOptions<R>,
): MockResolverDef;
export function createMockResolver(): never {
  return featureMissing("createMockResolver", 13);
}

export function createTestObserver(
  system: SingleModuleSystem<any> | NamespacedSystem<any>,
): {
  events: ObservationEvent[];
  ofType: <T extends ObservationEvent["type"]>(
    type: T,
  ) => Extract<
    ObservationEvent,
    {
      type: T;
    }
  >[];
  clear: () => void;
  dispose: () => void;
};
export function createTestObserver(): never {
  return featureMissing("createTestObserver", 13);
}

export function createTestSystem<S extends ModuleSchema>(
  options: CreateTestSystemOptionsSingle<S>,
): TestSystemSingle<S>;
export function createTestSystem<Modules extends ModulesMap>(
  options: CreateTestSystemOptions<Modules>,
): TestSystem<Modules>;
export function createTestSystem(): never {
  return featureMissing("createTestSystem", 13);
}

export function flushAsync(): Promise<void>;
export function flushAsync(): never {
  return featureMissing("flushAsync", 13);
}

export function mockResolver<R extends Requirement = Requirement>(
  _requirementType: string,
): MockResolver<R> & {
  handler: (req: Requirement, ctx: MockResolverContext) => Promise<void>;
};
export function mockResolver(): never {
  return featureMissing("mockResolver", 13);
}

export function settleWithFakeTimers(
  system: {
    inspect(): SystemInspection;
  },
  advanceTime: (ms: number) => void,
  options?: {
    totalTime?: number;
    stepSize?: number;
    maxIterations?: number;
  },
): Promise<void>;
export function settleWithFakeTimers(): never {
  return featureMissing("settleWithFakeTimers", 13);
}
