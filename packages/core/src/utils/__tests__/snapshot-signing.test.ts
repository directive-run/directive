import { describe, expect, it } from "vitest";
import { signSnapshot, verifySnapshotSignature } from "../utils.js";

// ---------------------------------------------------------------------------
// Snapshot signing / verification — `expiresAt` enforcement (R1 finding C1)
// ---------------------------------------------------------------------------

const SECRET = "test-secret-do-not-use-in-production";

describe("verifySnapshotSignature", () => {
  it("returns true for a valid, non-expired signed snapshot", async () => {
    const snapshot = {
      data: { canUseFeature: true },
      createdAt: 1_000_000,
      expiresAt: 9_999_999_999_999, // far future
      version: "1.0.0",
    };
    const signed = await signSnapshot(snapshot, SECRET);
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
  });

  it("returns true for a valid signed snapshot WITHOUT expiresAt", async () => {
    const snapshot = {
      data: { canUseFeature: true },
      createdAt: 1_000_000,
      version: "1.0.0",
    };
    const signed = await signSnapshot(snapshot, SECRET);
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
  });

  it("returns false when the signature is invalid", async () => {
    const snapshot = {
      data: { canUseFeature: true },
      createdAt: 1_000_000,
      expiresAt: 9_999_999_999_999,
      version: "1.0.0",
    };
    const signed = await signSnapshot(snapshot, SECRET);
    expect(
      await verifySnapshotSignature(signed, "wrong-secret"),
    ).toBe(false);
  });

  it("returns false for an EXPIRED snapshot with a valid signature (R1 C1 fix)", async () => {
    // This is the canonical replay-attack chain the round flagged: a
    // captured-and-replayed valid signature should NOT verify once the
    // snapshot's expiresAt has elapsed.
    const snapshot = {
      data: { canUseFeature: true },
      createdAt: 1_000_000,
      expiresAt: 2_000_000, // long in the past now
      version: "1.0.0",
    };
    const signed = await signSnapshot(snapshot, SECRET);
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(false);
  });

  it("respects { ignoreExpiry: true } for signature-only validation", async () => {
    // Archival validators and testing infrastructure may legitimately
    // need to verify only the cryptographic integrity of a long-expired
    // snapshot. Opt-in escape hatch.
    const snapshot = {
      data: { canUseFeature: true },
      createdAt: 1_000_000,
      expiresAt: 2_000_000,
      version: "1.0.0",
    };
    const signed = await signSnapshot(snapshot, SECRET);
    expect(
      await verifySnapshotSignature(signed, SECRET, { ignoreExpiry: true }),
    ).toBe(true);
  });

  it("respects { now } override for time-based testing", async () => {
    // The `now` option lets tests freeze the comparison clock without
    // needing fake timers.
    const snapshot = {
      data: { canUseFeature: true },
      createdAt: 1_000_000,
      expiresAt: 2_000_000,
      version: "1.0.0",
    };
    const signed = await signSnapshot(snapshot, SECRET);
    // Before expiry: valid
    expect(
      await verifySnapshotSignature(signed, SECRET, { now: 1_500_000 }),
    ).toBe(true);
    // After expiry: not valid
    expect(
      await verifySnapshotSignature(signed, SECRET, { now: 2_500_000 }),
    ).toBe(false);
  });
});
