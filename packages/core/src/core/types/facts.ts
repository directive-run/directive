/**
 * Facts Types - Type definitions for facts store and accessor
 */

import type { InferSchema, Schema } from "./schema.js";

// ============================================================================
// Facts Types
// ============================================================================

/** Read-only snapshot of facts */
export interface FactsSnapshot<S extends Schema = Schema> {
  get<K extends keyof InferSchema<S>>(key: K): InferSchema<S>[K] | undefined;
  has(key: keyof InferSchema<S>): boolean;
}

/** Mutable facts store */
export interface FactsStore<S extends Schema = Schema>
  extends FactsSnapshot<S> {
  set<K extends keyof InferSchema<S>>(key: K, value: InferSchema<S>[K]): void;
  delete(key: keyof InferSchema<S>): void;
  batch(fn: () => void): void;
  subscribe(
    keys: Array<keyof InferSchema<S>>,
    listener: () => void,
  ): () => void;
  subscribeAll(listener: () => void): () => void;
  /** Get all facts as a plain object (for serialization/time-travel) */
  toObject(): Record<string, unknown>;
}

/** Proxy-based facts accessor (cleaner API) */
export type Facts<S extends Schema = Schema> = InferSchema<S> & {
  readonly $store: FactsStore<S>;
  readonly $snapshot: () => FactsSnapshot<S>;
};

/**
 * Where a write came from.
 *
 * Recorded against each change as it is made, never sampled from a flag when
 * the batch is reported. A batch can contain writes of more than one origin —
 * a program that writes a fact and then rewinds history in the same batch makes
 * both — and a label read at the end describes whichever happened to be in
 * effect at that moment, which is neither of them.
 *
 * - `authored` — the program made this write.
 * - `restore` — a history navigation replayed it: `restore`, `goBack`,
 *   `goForward`, `goTo`, `replay`, `import`.
 * - `hydrate` — a stored state was loaded into a fresh system: `hydrate`,
 *   `initialFacts`, a snapshot restored through `system.restore`, or a
 *   persistence plugin rehydrating on start.
 *
 * `authored` is spelled out rather than left as the absence of a value, so a
 * consumer that wants program writes asks for them by name. A predicate
 * written as "no origin means the program did it" silently reclassifies every
 * row the day another origin is added.
 */
export type FactOrigin = "authored" | "restore" | "hydrate";

/** Fact change record */
export interface FactChange {
  key: string;
  value: unknown;
  prev: unknown;
  type: "set" | "delete";
  /** Where this write came from. Stamped at the write, not at the report. */
  origin: FactOrigin;
}
