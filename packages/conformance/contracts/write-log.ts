/**
 * The frozen write-log / event record, version 1. Types only: nothing in
 * 1.x emits it. 2.0 writes every record in exactly this shape; see
 * STABILITY.md "The write-log record". A new field is optional; changing
 * or removing a field is a new `v`.
 */

/**
 * Where a write came from: 1.35's (unexported) `FactOrigin` values, kept
 * open for new origins. Values are added, never renamed.
 */
export type WriteOrigin = "authored" | "restore" | "hydrate" | (string & {});

export interface WriteLogRecordV1 {
  /** Record format version. Always 1 for this shape. */
  readonly v: 1;
  /** Record type, dotted (`fact.set`, `resolver.complete`, …). Open union. */
  readonly t: string;
  /** Per-system sequence number: starts at 0, +1 per record, no gaps. */
  readonly seq: number;
  /** The id of the system that wrote it. */
  readonly sys: string;
  /** When, in epoch milliseconds from the system's clock. */
  readonly at: number;
  /** The definition responsible (`resolver:load`, `effect:sync`), if any. */
  readonly by?: string;
  /** Where the write came from, if it is a write. */
  readonly origin?: WriteOrigin;
  /** Type-specific payload fields. */
  readonly [field: string]: unknown;
}
