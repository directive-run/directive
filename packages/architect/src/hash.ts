/**
 * Shared FNV-1a hash utility.
 *
 * Not cryptographically secure — used for tamper-evidence chain integrity
 * and federation pattern hashing.
 */

/**
 * Synchronous FNV-1a hash. Returns 8-character hex string.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
