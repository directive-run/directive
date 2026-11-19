/**
 * The snapshot tools (L12a, the RFC's G1 to G6): 1.35's `isSnapshotExpired`,
 * `validateSnapshot`, `diffSnapshots`, `isSignedSnapshot`, `signSnapshot` and
 * `verifySnapshotSignature` (utils/utils.ts:436–887). Root exports only, so a
 * system that does not call them bundles none of this file.
 *
 * Two rows, approved on the owner's instruction ("I approve you for to do
 * everything", 2026-11-15; the L12 RFC's (bu) and (bv), each "Option taken:
 * approved, in L12a"):
 * - (bu) the signed form keeps 1.35's envelope (the five fields through
 *   `stableStringify`, an absent one written `undefined`) and writes `data`
 *   and `metadata` in their JSON form, as `JSON.stringify` would send them:
 *   an `undefined` key dropped, a `Date` through its `toJSON`. A snapshot
 *   holding either now verifies after it travels as JSON, where 1.35's never
 *   does. For plain JSON values the bytes are 1.35's, so a signature either
 *   version made verifies on the other.
 * - (bv) the signature covers all of the data or none: a function is dropped,
 *   as JSON drops it (1.35 signed it as the string "[function]"); a cycle
 *   throws, as `JSON.stringify` does; data nested past `stableStringify`'s 50
 *   levels, which 1.35 signs as "[max depth exceeded]", makes `signSnapshot`
 *   throw and `verifySnapshotSignature` return false.
 *
 * `version` is untouched: it stays 1.35's `hashObject` (C).
 */

import { stableStringify } from "../api/requirements.js";
import type {
  DistributableSnapshotLike,
  SignedSnapshot,
  SnapshotDiff,
  SnapshotDiffEntry,
} from "../types/snapshot-utils.js";

/** True once `now` is past `expiresAt`; a snapshot with none never expires. */
export function isSnapshotExpired<T>(
  snapshot: DistributableSnapshotLike<T>,
  now: number = Date.now(),
): boolean {
  return snapshot.expiresAt !== undefined && now > snapshot.expiresAt;
}

/** Checks the shape and the expiry, and returns `data`; throws 1.35's messages. */
export function validateSnapshot<T>(
  snapshot: DistributableSnapshotLike<T>,
  now: number = Date.now(),
): T {
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
  if (isSnapshotExpired(snapshot, now)) {
    throw new Error(
      `[Directive] Snapshot expired at ${new Date(snapshot.expiresAt!).toISOString()}. Obtain a fresh snapshot from the source.`,
    );
  }

  return snapshot.data;
}

/** What changed in `data` between two snapshots, by dotted path, and the version. */
export function diffSnapshots<T = Record<string, unknown>>(
  oldSnapshot: DistributableSnapshotLike<T>,
  newSnapshot: DistributableSnapshotLike<T>,
): SnapshotDiff {
  const changes: SnapshotDiffEntry[] = [];
  const push = (
    path: string,
    oldValue: unknown,
    newValue: unknown,
    type: SnapshotDiffEntry["type"],
  ) => {
    changes.push({ path, oldValue, newValue, type });
  };
  const compare = (a: unknown, b: unknown, path: string): void => {
    if (a === null || a === undefined) {
      if (b !== null && b !== undefined) {
        push(path, a, b, "added");
      }

      return;
    }
    if (b === null || b === undefined) {
      push(path, a, b, "removed");

      return;
    }
    if (typeof a !== "object" || typeof b !== "object") {
      if (!Object.is(a, b)) {
        push(path, a, b, "changed");
      }

      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        push(path, a, b, "changed");

        return;
      }
      for (let i = 0; i < a.length; i++) {
        compare(a[i], b[i], `${path}[${i}]`);
      }

      return;
    }
    const before = a as Record<string, unknown>;
    const after = b as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      const child = path ? `${path}.${key}` : key;
      if (!(key in before)) {
        push(child, undefined, after[key], "added");
      } else if (!(key in after)) {
        push(child, before[key], undefined, "removed");
      } else {
        compare(before[key], after[key], child);
      }
    }
  };
  compare(oldSnapshot.data, newSnapshot.data, "");
  const oldVersion = oldSnapshot.version;
  const newVersion = newSnapshot.version;

  return {
    identical: changes.length === 0,
    changes,
    versionChanged:
      oldVersion !== newVersion &&
      (oldVersion !== undefined || newVersion !== undefined),
    oldVersion,
    newVersion,
  };
}

/** True when the snapshot carries a string `signature`. */
export function isSignedSnapshot<T>(
  snapshot: DistributableSnapshotLike<T> | SignedSnapshot<T>,
): snapshot is SignedSnapshot<T> {
  return "signature" in snapshot && typeof snapshot.signature === "string";
}

/** (bu): a value as JSON would carry it; `undefined` stays `undefined`. */
const asJson = (value: unknown): unknown =>
  value === undefined ? value : JSON.parse(JSON.stringify(value) ?? "null");

/**
 * The signed form: 1.35's envelope over `data` and `metadata` in JSON form
 * (bu). Throws when the signature could not cover the data (bv).
 */
function payload(snapshot: DistributableSnapshotLike<unknown>): string {
  const envelope = {
    data: asJson(snapshot.data),
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    version: snapshot.version,
    metadata: asJson(snapshot.metadata),
  };
  const signed = stableStringify(envelope);
  // (bv): JSON form has no function or cycle left, so the only placeholder
  // stableStringify can still write is its depth cap.
  if (signed !== stableStringify(envelope, Number.POSITIVE_INFINITY)) {
    throw new Error(
      "[Directive] signSnapshot: the snapshot's data or metadata is nested more than 50 levels deep, past what the signature can cover.",
    );
  }

  return signed;
}

async function hmacSha256(
  message: string,
  secret: string | Uint8Array,
): Promise<string> {
  const encode = (text: string) => new TextEncoder().encode(text);
  const key = await crypto.subtle.importKey(
    "raw",
    (typeof secret === "string" ? encode(secret) : secret) as BufferSource,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encode(message));

  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Signs the snapshot with HMAC-SHA256 (Web Crypto) and returns it with
 * `signature` (64 hex characters) and `algorithm`.
 */
export async function signSnapshot<T>(
  snapshot: DistributableSnapshotLike<T>,
  secret: string | Uint8Array,
): Promise<SignedSnapshot<T>> {
  const signature = await hmacSha256(payload(snapshot), secret);

  return { ...snapshot, signature, algorithm: "hmac-sha256" };
}

/**
 * True when the signature matches (compared in constant time) and the
 * snapshot has not expired, unless `ignoreExpiry`.
 */
export async function verifySnapshotSignature<T>(
  signedSnapshot: SignedSnapshot<T>,
  secret: string | Uint8Array,
  options?: { ignoreExpiry?: boolean; now?: number },
): Promise<boolean> {
  if (!signedSnapshot.signature || signedSnapshot.algorithm !== "hmac-sha256") {
    return false;
  }
  let signed: string;
  try {
    signed = payload(signedSnapshot);
  } catch {
    // (bv): what no signature can cover does not verify.
    return false;
  }
  const expected = await hmacSha256(signed, secret);
  const given = signedSnapshot.signature;
  if (given.length !== expected.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < given.length; i++) {
    result |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return (
    result === 0 &&
    (!!options?.ignoreExpiry ||
      !isSnapshotExpired(signedSnapshot, options?.now))
  );
}
