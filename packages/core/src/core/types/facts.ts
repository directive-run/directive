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
  batch(fn: () => void, options?: { origin?: "restore" }): void;
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
  /**
   * Where the write came from, when it was not the application.
   *
   * Recorded on the change itself, at the moment it is made, rather than read
   * from "are we restoring right now?" when the batch is reported. A flag read
   * later answers for the wrong moment: a restore nested inside another batch
   * is reported after the flag has cleared, and an ordinary write made while a
   * restore settles is reported while it is still set. Both mislabel, in
   * opposite directions, and a durable record that drops or keeps entries by
   * this label would drop real writes and keep invented ones.
   */
  origin?: "restore";
}
