/**
 * `@directive-run/core/migration` on core-next: not built yet (the Redux,
 * Zustand and XState migration helpers).
 * 1.35's exports with 1.35's names and signatures, taken from
 * packages/conformance/contracts/api-surface.json. Each function throws
 * `featureMissing` (code E_FEATURE_MISSING) when called; the entry arrives
 * in layer 13. Generated for the alpha.0 tarball (slice P3-F5).
 */
import { featureMissing } from "./api/missing.js";

export interface DirectiveModuleStructure {
  name: string;
  facts: Record<string, string>;
  derivations: Record<string, string>;
  events: Record<string, Record<string, string>>;
  requirements: Record<string, unknown>;
  initCode: string;
  deriveCode: Record<string, string>;
  eventsCode: Record<string, string>;
}

export interface ReduxSliceConfig {
  name: string;
  initialState: Record<string, unknown>;
  reducers: Record<
    string,
    (
      state: unknown,
      action?: {
        payload?: unknown;
      },
    ) => void
  >;
}

export interface XStateMachineConfig {
  id: string;
  initial: string;
  states: Record<
    string,
    {
      on?: Record<
        string,
        | string
        | {
            target: string;
          }
      >;
    }
  >;
  context?: Record<string, unknown>;
}

export interface ZustandStoreConfig {
  state: Record<string, unknown>;
  actions: Record<string, (...args: unknown[]) => void>;
}

export function analyzeReduxSlice(
  config: ReduxSliceConfig,
): DirectiveModuleStructure;
export function analyzeReduxSlice(): never {
  return featureMissing("analyzeReduxSlice", 13);
}

export function analyzeXStateMachine(
  config: XStateMachineConfig,
): DirectiveModuleStructure;
export function analyzeXStateMachine(): never {
  return featureMissing("analyzeXStateMachine", 13);
}

export function analyzeZustandStore(
  config: ZustandStoreConfig,
): DirectiveModuleStructure;
export function analyzeZustandStore(): never {
  return featureMissing("analyzeZustandStore", 13);
}

export function generateMigrationChecklist(
  source: "redux" | "zustand" | "xstate",
): string[];
export function generateMigrationChecklist(): never {
  return featureMissing("generateMigrationChecklist", 13);
}

export function generateModuleCode(structure: DirectiveModuleStructure): string;
export function generateModuleCode(): never {
  return featureMissing("generateModuleCode", 13);
}
