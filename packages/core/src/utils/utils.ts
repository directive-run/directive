/**
 * Shared utilities for Directive
 */

/**
 * Execute a promise with a timeout, properly cleaning up the timer.
 * Used by both constraints and resolvers for timeout handling.
 *
 * @param promise - The promise to wrap with a timeout
 * @param ms - Timeout duration in milliseconds
 * @param errorMessage - Error message if timeout occurs
 * @returns The promise result
 * @throws Error if timeout is exceeded
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Normalize an error to an Error instance.
 * Ensures consistent error handling throughout the library.
 *
 * @param error - The error to normalize (can be anything)
 * @returns An Error instance
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Create a stable JSON string with sorted keys.
 * Handles circular references and deeply nested objects safely.
 *
 * @param value - The value to stringify
 * @param maxDepth - Maximum nesting depth (default: 50)
 * @returns A stable JSON string
 */
export function stableStringify(value: unknown, maxDepth = 50): string {
  const seen = new WeakSet();

  function stringifyPrimitive(val: unknown): string | undefined {
    if (val === null) return "null";
    if (val === undefined) return "undefined";

    const type = typeof val;
    if (type === "string") return JSON.stringify(val);
    if (type === "number" || type === "boolean") return String(val);
    if (type === "function") return '"[function]"';
    if (type === "symbol") return '"[symbol]"';

    return undefined;
  }

  function withCircularGuard(
    obj: object,
    fn: () => string,
  ): string {
    if (seen.has(obj)) {
      return '"[circular]"';
    }
    seen.add(obj);
    const result = fn();
    seen.delete(obj);

    return result;
  }

  function stringifyArray(val: unknown[], depth: number): string {
    return withCircularGuard(val, () =>
      `[${val.map((v) => stringify(v, depth + 1)).join(",")}]`,
    );
  }

  function stringifyObject(obj: Record<string, unknown>, depth: number): string {
    return withCircularGuard(obj, () => {
      const keys = Object.keys(obj).sort();
      const pairs = keys.map(
        (k) => `${JSON.stringify(k)}:${stringify(obj[k], depth + 1)}`,
      );

      return `{${pairs.join(",")}}`;
    });
  }

  function stringify(val: unknown, depth: number): string {
    if (depth > maxDepth) {
      return '"[max depth exceeded]"';
    }

    const primitive = stringifyPrimitive(val);
    if (primitive !== undefined) {
      return primitive;
    }

    if (Array.isArray(val)) {
      return stringifyArray(val, depth);
    }

    if (typeof val === "object") {
      return stringifyObject(val as Record<string, unknown>, depth);
    }

    return '"[unknown]"';
  }

  return stringify(value, 0);
}

/**
 * Check for prototype pollution in an object, including nested objects.
 * Returns true if the object is safe, false if dangerous keys are found.
 *
 * @param obj - The object to check
 * @param maxDepth - Maximum nesting depth to check (default: 50)
 * @returns True if safe, false if dangerous keys found
 */
export function isPrototypeSafe(obj: unknown, maxDepth = 50): boolean {
  const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);
  const seen = new WeakSet();

  function withCircularGuard(
    objVal: object,
    fn: () => boolean,
  ): boolean {
    if (seen.has(objVal)) return true;
    seen.add(objVal);
    const result = fn();
    seen.delete(objVal);

    return result;
  }

  function checkArray(arr: unknown[], depth: number): boolean {
    for (const item of arr) {
      if (!check(item, depth + 1)) {
        return false;
      }
    }

    return true;
  }

  function checkObject(objVal: Record<string, unknown>, depth: number): boolean {
    for (const key of Object.keys(objVal)) {
      if (dangerousKeys.has(key)) {
        return false;
      }
      if (!check(objVal[key], depth + 1)) {
        return false;
      }
    }

    return true;
  }

  function check(val: unknown, depth: number): boolean {
    if (depth > maxDepth) return false; // Fail safe at max depth - don't assume safety
    if (val === null || val === undefined) return true;
    if (typeof val !== "object") return true;

    const objVal = val as Record<string, unknown>;

    if (Array.isArray(objVal)) {
      return withCircularGuard(objVal, () => checkArray(objVal, depth));
    }

    return withCircularGuard(objVal, () => checkObject(objVal, depth));
  }

  return check(obj, 0);
}

/**
 * Shallow equality comparison for objects.
 * Used by React hooks to avoid unnecessary re-renders.
 *
 * @param a - First object
 * @param b - Second object
 * @returns True if objects are shallowly equal
 */
export function shallowEqual<T extends Record<string, unknown>>(
  a: T,
  b: T,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}

/**
 * Generate a simple hash string from an object.
 * Uses djb2 algorithm on the stable stringified value.
 *
 * **Limitations:**
 * - 32-bit hash output means collision probability increases with data set size
 *   (birthday paradox: ~50% collision chance at ~77,000 distinct values)
 * - Suitable for: cache invalidation, change detection, deduplication of small sets
 * - NOT suitable for: cryptographic use, security-sensitive operations, large-scale deduplication
 *
 * For security-sensitive use cases requiring stronger collision resistance,
 * consider using a cryptographic hash like SHA-256.
 *
 * @param value - The value to hash
 * @returns A hex hash string (8 characters, 32 bits)
 */
export function hashObject(value: unknown): string {
  const str = stableStringify(value);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit and then to hex
  return (hash >>> 0).toString(16);
}

// ============================================================================
// Distributable Snapshot Utilities
// ============================================================================

/**
 * Distributable snapshot type for type-safe helper functions.
 */
export interface DistributableSnapshotLike<T = Record<string, unknown>> {
  data: T;
  createdAt: number;
  expiresAt?: number;
  version?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Check if a distributable snapshot has expired.
 * Returns false if the snapshot has no expiresAt field.
 *
 * @example
 * ```typescript
 * const snapshot = system.getDistributableSnapshot({ ttlSeconds: 3600 });
 * // ... later ...
 * if (isSnapshotExpired(snapshot)) {
 *   // Refresh the snapshot
 * }
 * ```
 *
 * @param snapshot - The snapshot to check
 * @param now - Optional current timestamp (defaults to Date.now())
 * @returns True if the snapshot has expired, false otherwise
 */
export function isSnapshotExpired<T>(
  snapshot: DistributableSnapshotLike<T>,
  now: number = Date.now(),
): boolean {
  return snapshot.expiresAt !== undefined && now > snapshot.expiresAt;
}

/**
 * Validate a distributable snapshot and return its data.
 * Throws if the snapshot is malformed or has expired.
 *
 * @example
 * ```typescript
 * const cached = JSON.parse(await redis.get(`entitlements:${userId}`));
 * try {
 *   const data = validateSnapshot(cached);
 *   // Use data.canUseFeature, etc.
 * } catch (e) {
 *   // Snapshot invalid or expired, refresh it
 * }
 * ```
 *
 * @example Using custom timestamp for testing
 * ```typescript
 * const snapshot = { data: { test: true }, createdAt: 1000, expiresAt: 2000 };
 * validateSnapshot(snapshot, 1500); // Returns { test: true }
 * validateSnapshot(snapshot, 2500); // Throws: Snapshot expired
 * ```
 *
 * @param snapshot - The snapshot to validate
 * @param now - Optional current timestamp (defaults to Date.now())
 * @returns The snapshot data if valid
 * @throws Error if the snapshot is malformed or has expired
 */
export function validateSnapshot<T>(
  snapshot: DistributableSnapshotLike<T>,
  now: number = Date.now(),
): T {
  // Structural validation
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(
      "[Directive] Invalid snapshot: expected an object with 'data' and 'createdAt' properties.",
    );
  }
  if (!("data" in snapshot)) {
    throw new Error(
      "[Directive] Invalid snapshot: missing required 'data' property.",
    );
  }
  if (!("createdAt" in snapshot) || typeof snapshot.createdAt !== "number") {
    throw new Error(
      "[Directive] Invalid snapshot: missing or invalid 'createdAt' property (expected number).",
    );
  }

  // Expiration validation
  if (isSnapshotExpired(snapshot, now)) {
    const expiredAt = new Date(snapshot.expiresAt!).toISOString();
    throw new Error(
      `[Directive] Snapshot expired at ${expiredAt}. Obtain a fresh snapshot from the source.`,
    );
  }
  return snapshot.data;
}

/**
 * Diff result for a single changed value.
 */
export interface SnapshotDiffEntry {
  /** The key path that changed (e.g., "canUseApi" or "limits.apiCalls") */
  path: string;
  /** The value in the old snapshot */
  oldValue: unknown;
  /** The value in the new snapshot */
  newValue: unknown;
  /** Type of change: "added", "removed", or "changed" */
  type: "added" | "removed" | "changed";
}

/**
 * Result of diffing two snapshots.
 */
export interface SnapshotDiff {
  /** Whether the snapshots are identical */
  identical: boolean;
  /** List of changes between snapshots */
  changes: SnapshotDiffEntry[];
  /** Whether the version changed (if both have versions) */
  versionChanged: boolean;
  /** Old version (if available) */
  oldVersion?: string;
  /** New version (if available) */
  newVersion?: string;
}

/**
 * Compare two distributable snapshots and return the differences.
 * Useful for debugging, audit logs, and webhook payloads.
 *
 * @example
 * ```typescript
 * const oldSnapshot = system.getDistributableSnapshot({ includeVersion: true });
 * system.dispatch({ type: "upgradePlan", plan: "pro" });
 * const newSnapshot = system.getDistributableSnapshot({ includeVersion: true });
 *
 * const diff = diffSnapshots(oldSnapshot, newSnapshot);
 * if (!diff.identical) {
 *   console.log("Changes:", diff.changes);
 *   // [{ path: "canUseApi", oldValue: false, newValue: true, type: "changed" }]
 * }
 * ```
 *
 * @param oldSnapshot - The previous snapshot
 * @param newSnapshot - The new snapshot
 * @returns A diff result with all changes
 */
export function diffSnapshots<T = Record<string, unknown>>(
  oldSnapshot: DistributableSnapshotLike<T>,
  newSnapshot: DistributableSnapshotLike<T>,
): SnapshotDiff {
  const changes: SnapshotDiffEntry[] = [];

  function pushChange(
    path: string,
    oldValue: unknown,
    newValue: unknown,
    type: SnapshotDiffEntry["type"],
  ): void {
    changes.push({ path, oldValue, newValue, type });
  }

  function compareNullish(
    oldObj: unknown,
    newObj: unknown,
    path: string,
  ): boolean {
    if (oldObj === null || oldObj === undefined) {
      if (newObj !== null && newObj !== undefined) {
        pushChange(path, oldObj, newObj, "added");
      }

      return true;
    }
    if (newObj === null || newObj === undefined) {
      pushChange(path, oldObj, newObj, "removed");

      return true;
    }

    return false;
  }

  function compareArrays(
    oldArr: unknown[],
    newArr: unknown[],
    path: string,
  ): void {
    if (oldArr.length !== newArr.length) {
      pushChange(path, oldArr, newArr, "changed");

      return;
    }
    for (let i = 0; i < oldArr.length; i++) {
      compare(oldArr[i], newArr[i], `${path}[${i}]`);
    }
  }

  function compareObjects(
    oldRecord: Record<string, unknown>,
    newRecord: Record<string, unknown>,
    path: string,
  ): void {
    const allKeys = new Set([
      ...Object.keys(oldRecord),
      ...Object.keys(newRecord),
    ]);

    for (const key of allKeys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in oldRecord)) {
        pushChange(childPath, undefined, newRecord[key], "added");
      } else if (!(key in newRecord)) {
        pushChange(childPath, oldRecord[key], undefined, "removed");
      } else {
        compare(oldRecord[key], newRecord[key], childPath);
      }
    }
  }

  function compare(oldObj: unknown, newObj: unknown, path: string): void {
    if (compareNullish(oldObj, newObj, path)) {
      return;
    }

    // Handle primitives
    if (typeof oldObj !== "object" || typeof newObj !== "object") {
      if (!Object.is(oldObj, newObj)) {
        pushChange(path, oldObj, newObj, "changed");
      }

      return;
    }

    // Handle arrays
    if (Array.isArray(oldObj) && Array.isArray(newObj)) {
      compareArrays(oldObj, newObj, path);

      return;
    }

    // Handle objects
    compareObjects(
      oldObj as Record<string, unknown>,
      newObj as Record<string, unknown>,
      path,
    );
  }

  // Compare data
  compare(oldSnapshot.data, newSnapshot.data, "");

  // Check version change
  const versionChanged =
    oldSnapshot.version !== newSnapshot.version &&
    (oldSnapshot.version !== undefined || newSnapshot.version !== undefined);

  return {
    identical: changes.length === 0,
    changes,
    versionChanged,
    oldVersion: oldSnapshot.version,
    newVersion: newSnapshot.version,
  };
}

// ============================================================================
// Snapshot Signing (HMAC)
// ============================================================================

/**
 * A signed distributable snapshot.
 * Contains the original snapshot plus a cryptographic signature.
 */
export interface SignedSnapshot<T = Record<string, unknown>>
  extends DistributableSnapshotLike<T> {
  /** HMAC-SHA256 signature in hex format */
  signature: string;
  /** Signing algorithm used */
  algorithm: "hmac-sha256";
}

/**
 * Check if a snapshot is signed.
 *
 * @param snapshot - The snapshot to check
 * @returns True if the snapshot has a signature
 */
export function isSignedSnapshot<T>(
  snapshot: DistributableSnapshotLike<T> | SignedSnapshot<T>,
): snapshot is SignedSnapshot<T> {
  return "signature" in snapshot && typeof snapshot.signature === "string";
}

/**
 * Sign a distributable snapshot using HMAC-SHA256.
 * Creates a tamper-proof signature that can be verified later.
 *
 * **Security Notes:**
 * - Use a cryptographically random secret of at least 32 bytes
 * - Store the secret securely (environment variable, secrets manager)
 * - Never expose the secret to clients
 * - The signature covers all snapshot fields for integrity
 *
 * @example
 * ```typescript
 * const snapshot = system.getDistributableSnapshot({
 *   includeDerivations: ['canUseFeature', 'limits'],
 *   ttlSeconds: 3600,
 * });
 *
 * // Sign the snapshot (server-side only)
 * const signed = await signSnapshot(snapshot, process.env.SNAPSHOT_SECRET);
 *
 * // Store in JWT, Redis, or send to client
 * const jwt = createJWT({ snapshot: signed });
 *
 * // Later, verify the signature
 * const isValid = await verifySnapshotSignature(signed, process.env.SNAPSHOT_SECRET);
 * if (!isValid) {
 *   throw new Error('Snapshot has been tampered with');
 * }
 * ```
 *
 * @param snapshot - The snapshot to sign
 * @param secret - The HMAC secret (string or Uint8Array)
 * @returns A signed snapshot with the signature attached
 */
export async function signSnapshot<T>(
  snapshot: DistributableSnapshotLike<T>,
  secret: string | Uint8Array,
): Promise<SignedSnapshot<T>> {
  // Create a canonical representation for signing
  const payload = stableStringify({
    data: snapshot.data,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    version: snapshot.version,
    metadata: snapshot.metadata,
  });

  const signature = await hmacSha256(payload, secret);

  return {
    ...snapshot,
    signature,
    algorithm: "hmac-sha256",
  };
}

/**
 * Verify the signature of a signed snapshot.
 * Returns true if the signature is valid, false otherwise.
 *
 * **Important:** Always verify signatures before trusting snapshot data,
 * especially if the snapshot was received from an untrusted source (client, cache).
 *
 * @example
 * ```typescript
 * // Receive signed snapshot from client or cache
 * const snapshot = JSON.parse(cachedData);
 *
 * // Verify before using
 * const isValid = await verifySnapshotSignature(snapshot, process.env.SNAPSHOT_SECRET);
 * if (!isValid) {
 *   throw new Error('Invalid snapshot signature - possible tampering');
 * }
 *
 * // Now safe to use snapshot.data
 * if (snapshot.data.canUseFeature.api) {
 *   // Grant access
 * }
 * ```
 *
 * @param signedSnapshot - The signed snapshot to verify
 * @param secret - The HMAC secret (must match the signing secret)
 * @returns True if signature is valid, false otherwise
 */
export async function verifySnapshotSignature<T>(
  signedSnapshot: SignedSnapshot<T>,
  secret: string | Uint8Array,
): Promise<boolean> {
  if (!signedSnapshot.signature || signedSnapshot.algorithm !== "hmac-sha256") {
    return false;
  }

  // Recreate the canonical payload (same as signing)
  const payload = stableStringify({
    data: signedSnapshot.data,
    createdAt: signedSnapshot.createdAt,
    expiresAt: signedSnapshot.expiresAt,
    version: signedSnapshot.version,
    metadata: signedSnapshot.metadata,
  });

  const expectedSignature = await hmacSha256(payload, secret);

  // Use timing-safe comparison
  return timingSafeEqual(signedSnapshot.signature, expectedSignature);
}

/**
 * Create HMAC-SHA256 signature of a message.
 * Uses Web Crypto API for cross-platform support (Node.js, browsers, Deno, Bun).
 */
async function hmacSha256(
  message: string,
  secret: string | Uint8Array,
): Promise<string> {
  // Convert secret to Uint8Array if string
  const secretBytes: Uint8Array =
    typeof secret === "string" ? new TextEncoder().encode(secret) : secret;

  // Import key for HMAC
  const algorithm: HmacImportParams = {
    name: "HMAC",
    hash: { name: "SHA-256" },
  };
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as unknown as ArrayBuffer,
    algorithm,
    false,
    ["sign"],
  );

  // Sign the message
  const messageBytes = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign("HMAC", key, messageBytes);

  // Convert to hex string
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Both strings should be the same length (hex signatures from same algorithm).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
