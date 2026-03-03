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

/** Fact change record */
export interface FactChange {
  key: string;
  value: unknown;
  prev: unknown;
  type: "set" | "delete";
}
