/**
 * The canonical count names, plus the one alias, in read order.
 *
 * Kept as a list so the set of names read is a single visible fact rather than
 * something a reader has to reconstruct from the function body.
 */
import type { NormalizedTokenUsage } from "../types/plugin-token-usage.js";

const COUNT_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheCreationTokens",
] as const;

/**
 * Read one own numeric property off a caller-supplied object.
 *
 * Returns `undefined` when the field is absent and `NaN` when it is present but
 * holds something other than a number. Every caller already refuses `NaN`,
 * because a non-finite count is unusable however it arrived; returning
 * `undefined` for a present-but-wrong-typed field would instead have it read as
 * an absent one, which callers treat as a legitimate zero.
 *
 * Gated on {@link Object.hasOwn}: a value inherited from `Object.prototype` is
 * not a value the caller supplied. Without the gate a polluted
 * `Object.prototype.cacheReadTokens` reaches every usage object that omits
 * cache counts — which is most of them — and silently rewrites what every call
 * appears to have consumed. The same holds for a polluted `cost`, which is why
 * this reader is shared rather than reimplemented per field.
 */
export function readOwnNumber(
  source: unknown,
  field: string,
): number | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  if (!Object.hasOwn(source, field)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[field];

  return typeof value === "number" ? value : Number.NaN;
}

/**
 * Read a provider-reported token usage exactly once and resolve its cache-write
 * count from either spelling.
 *
 * Every property is read a single time into a primitive. Re-reading the
 * caller's object later is a check-then-use gap: a getter, a `Proxy`, or a
 * plain assignment after validation would answer one way to the check and
 * another to the use.
 *
 * When both cache-write spellings are present the larger wins — under-counting
 * is the failure mode worth avoiding, and a non-finite value in either one
 * propagates through the comparison so the consumer's own validation rejects
 * it rather than silently taking the other.
 *
 * @param usage - Anything that might carry token counts, including `undefined`.
 */
export function normalizeTokenUsage(usage: unknown): NormalizedTokenUsage {
  const own = new Map<string, number | undefined>();
  for (const field of COUNT_FIELDS) {
    own.set(field, readOwnNumber(usage, field));
  }

  const creation = own.get("cacheCreationTokens");
  const write = own.get("cacheWriteTokens");
  let cacheWriteTokens: number | undefined;

  if (creation !== undefined && write !== undefined) {
    cacheWriteTokens = Math.max(creation, write);
  } else if (creation !== undefined) {
    cacheWriteTokens = creation;
  } else if (write !== undefined) {
    cacheWriteTokens = write;
  }

  return Object.freeze({
    inputTokens: own.get("inputTokens"),
    outputTokens: own.get("outputTokens"),
    cacheReadTokens: own.get("cacheReadTokens"),
    cacheWriteTokens,
  });
}
