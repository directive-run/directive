/**
 * Copied from 1.35 (packages/core/src/utils/utils.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

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
