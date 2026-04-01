/** Common interface for all benchmark adapters */
export interface BenchAdapter {
  name: string;
  /** Create a store with a single "count" value initialized to 0 */
  createCounter(): unknown;
  /** Read the count value */
  read(store: unknown): number;
  /** Write a new count value */
  write(store: unknown, value: number): void;
  /** Create a store with a derived value (count * 2) */
  createWithDerived(): unknown;
  /** Read the derived value */
  readDerived(store: unknown): number;
  /** Write to trigger derived recompute */
  writeDerived(store: unknown, value: number): void;
  /** Cleanup if needed */
  destroy?(store: unknown): void;
}
