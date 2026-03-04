/**
 * Directive Server Example
 *
 * An Express API demonstrating Directive's server-side features:
 * - Distributable snapshots with TTL
 * - Signed snapshot verification (HMAC-SHA256)
 * - Cryptographic audit trail
 * - GDPR/CCPA compliance tooling
 *
 * Run: npx tsx --watch src/server.ts
 */

import {
  createAuditTrail,
  createCompliance,
  createInMemoryComplianceStorage,
} from "@directive-run/ai";
import {
  createSystem,
  isSnapshotExpired,
  signSnapshot,
  verifySnapshotSignature,
} from "@directive-run/core";
import express from "express";
import { userProfile } from "./module.js";

const app = express();
app.use(express.json());

// ============================================================================
// Shared Infrastructure
// ============================================================================

const SIGNING_SECRET =
  process.env.SIGNING_SECRET ?? "dev-secret-change-in-production";

// Audit trail – shared across requests, acts as a Directive plugin
const audit = createAuditTrail({
  maxEntries: 10_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  piiMasking: {
    enabled: true,
    types: ["email", "name"],
    redactionStyle: "masked",
  },
});

// Compliance – in-memory storage for this example (use a DB adapter in production)
const compliance = createCompliance({
  storage: createInMemoryComplianceStorage(),
  consentPurposes: ["analytics", "marketing", "personalization"],
});

// In-memory snapshot cache (use Redis in production)
const snapshotCache = new Map<
  string,
  { snapshot: unknown; cachedAt: number }
>();
const CACHE_TTL_MS = 60_000; // 1 minute

// ============================================================================
// Helper: Per-Request System Factory
// ============================================================================

function createUserSystem(userId: string) {
  const system = createSystem({
    module: userProfile,
    plugins: [audit.createPlugin()],
  });

  system.start();
  system.events.loadUser({ userId });

  return system;
}

// ============================================================================
// GET /snapshot/:userId
// Distributable Snapshots with TTL
// ============================================================================

app.get("/snapshot/:userId", async (req, res) => {
  const { userId } = req.params;

  // Check cache first
  const cached = snapshotCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    res.json({ source: "cache", snapshot: cached.snapshot });

    return;
  }

  // Create a per-request system, settle it, then export a distributable snapshot
  const system = createUserSystem(userId);

  try {
    await system.settle(5000);

    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["effectivePlan", "canUseFeature", "isReady"],
      ttlSeconds: 3600,
    });

    // Cache it
    snapshotCache.set(userId, { snapshot, cachedAt: Date.now() });

    res.json({ source: "fresh", snapshot });
  } catch (error) {
    res.status(500).json({ error: "Failed to settle system" });
  } finally {
    system.destroy();
  }
});

// ============================================================================
// POST /snapshot/:userId/verify
// Signed Snapshot Verification
// ============================================================================

app.post("/snapshot/:userId/verify", async (req, res) => {
  const { snapshot } = req.body;

  if (!snapshot) {
    res.status(400).json({ error: "Missing snapshot in request body" });

    return;
  }

  // Sign a fresh snapshot for this user
  const system = createUserSystem(req.params.userId);

  try {
    await system.settle(5000);

    const freshSnapshot = system.getDistributableSnapshot({
      includeDerivations: ["effectivePlan", "canUseFeature", "isReady"],
      ttlSeconds: 3600,
    });

    // Sign the snapshot with HMAC-SHA256
    const signed = await signSnapshot(freshSnapshot, SIGNING_SECRET);

    // Verify the provided snapshot's signature
    if (snapshot.signature) {
      const isValid = await verifySnapshotSignature(snapshot, SIGNING_SECRET);
      const isExpired = isSnapshotExpired(snapshot);

      res.json({
        signatureValid: isValid,
        expired: isExpired,
        signedSnapshot: signed,
      });
    } else {
      // No signature on the incoming snapshot – just return a signed version
      res.json({
        signatureValid: null,
        expired: false,
        signedSnapshot: signed,
      });
    }
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  } finally {
    system.destroy();
  }
});

// ============================================================================
// GET /audit
// Query Audit Entries
// ============================================================================

app.get("/audit", (req, res) => {
  const { eventType, since, actorId, limit } = req.query;

  // biome-ignore lint/suspicious/noExplicitAny: eventType comes from query string
  const entries = audit.getEntries({
    eventTypes: eventType ? [eventType as any] : undefined,
    since: since ? Number(since) : undefined,
    actorId: actorId as string | undefined,
    limit: limit ? Number(limit) : 50,
  });

  res.json({
    count: entries.length,
    entries,
  });
});

// ============================================================================
// GET /audit/verify
// Verify Audit Hash Chain Integrity
// ============================================================================

app.get("/audit/verify", async (_req, res) => {
  const result = await audit.verifyChain();

  res.json({
    chainValid: result.valid,
    entriesVerified: result.entriesVerified,
    brokenAt: result.brokenAt ?? null,
    verifiedAt: new Date(result.verifiedAt).toISOString(),
  });
});

// ============================================================================
// POST /compliance/:subjectId/export
// GDPR Article 20 – Data Export
// ============================================================================

app.post("/compliance/:subjectId/export", async (req, res) => {
  const { subjectId } = req.params;

  // Record consent for analytics before exporting
  await compliance.consent.grant(subjectId, "analytics", {
    source: "api-request",
  });

  const result = await compliance.exportData({
    subjectId,
    format: "json",
    includeAudit: true,
  });

  if (result.success) {
    res.json({
      subjectId,
      exportedAt: new Date(result.exportedAt).toISOString(),
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : null,
      recordCount: result.recordCount,
      checksum: result.checksum,
      data: JSON.parse(result.data),
    });
  } else {
    res.status(500).json({ error: "Export failed" });
  }
});

// ============================================================================
// POST /compliance/:subjectId/delete
// GDPR Article 17 – Right to Erasure
// ============================================================================

app.post("/compliance/:subjectId/delete", async (req, res) => {
  const { subjectId } = req.params;
  const { reason } = req.body;

  const result = await compliance.deleteData({
    subjectId,
    scope: "all",
    reason: reason ?? "GDPR Article 17 request",
  });

  if (result.success) {
    res.json({
      subjectId,
      deletedAt: new Date(result.deletedAt).toISOString(),
      recordsAffected: result.recordsAffected,
      certificate: result.certificate,
    });
  } else {
    res.status(500).json({ error: "Deletion failed" });
  }
});

// ============================================================================
// GET /health
// Health Check
// ============================================================================

app.get("/health", (_req, res) => {
  const auditStats = audit.getStats();

  res.json({
    status: "ok",
    audit: {
      totalEntries: auditStats.totalEntries,
      oldestEntry: auditStats.oldestEntry
        ? new Date(auditStats.oldestEntry).toISOString()
        : null,
      newestEntry: auditStats.newestEntry
        ? new Date(auditStats.newestEntry).toISOString()
        : null,
      chainIntegrity: auditStats.chainIntegrity,
    },
  });
});

// ============================================================================
// Start
// ============================================================================

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
  console.log(`Directive server example running on http://localhost:${PORT}`);
  console.log();
  console.log("Endpoints:");
  console.log(
    "  GET  /snapshot/:userId           Distributable snapshot with TTL",
  );
  console.log("  POST /snapshot/:userId/verify     Sign and verify snapshots");
  console.log("  GET  /audit                      Query audit entries");
  console.log("  GET  /audit/verify               Verify hash chain integrity");
  console.log("  POST /compliance/:subjectId/export  GDPR data export");
  console.log("  POST /compliance/:subjectId/delete  GDPR right to erasure");
  console.log("  GET  /health                     Health check");
  console.log();
  console.log("Try: curl http://localhost:3000/snapshot/user-1");
});
