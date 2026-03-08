import { describe, it, expect, vi } from "vitest";
import {
  createCompliance,
  createInMemoryComplianceStorage,
  type ComplianceStorage,
} from "../../plugins/compliance.js";
import type { InputGuardrailData } from "../../types.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockStorage(): ComplianceStorage & {
  getSubjectData: ReturnType<typeof vi.fn>;
  deleteSubjectData: ReturnType<typeof vi.fn>;
  anonymizeSubjectData: ReturnType<typeof vi.fn>;
  getExpiredData: ReturnType<typeof vi.fn>;
  deleteByIds: ReturnType<typeof vi.fn>;
  storeConsent: ReturnType<typeof vi.fn>;
  getConsent: ReturnType<typeof vi.fn>;
  getConsentsBySubject: ReturnType<typeof vi.fn>;
  getConsentsByPurpose: ReturnType<typeof vi.fn>;
  storeDeletionCertificate: ReturnType<typeof vi.fn>;
  getAuditEntries: ReturnType<typeof vi.fn>;
} {
  return {
    getSubjectData: vi.fn().mockResolvedValue([
      {
        category: "profile",
        records: [
          {
            id: "r1",
            data: { name: "John", email: "john@example.com" },
            createdAt: Date.now(),
          },
        ],
      },
    ]),
    deleteSubjectData: vi.fn().mockResolvedValue(1),
    anonymizeSubjectData: vi.fn().mockResolvedValue(1),
    getExpiredData: vi.fn().mockResolvedValue([]),
    deleteByIds: vi.fn().mockResolvedValue(0),
    storeConsent: vi.fn().mockResolvedValue(undefined),
    getConsent: vi.fn().mockResolvedValue(null),
    getConsentsBySubject: vi.fn().mockResolvedValue([]),
    getConsentsByPurpose: vi.fn().mockResolvedValue([]),
    storeDeletionCertificate: vi.fn().mockResolvedValue(undefined),
    getAuditEntries: vi.fn().mockResolvedValue([]),
  };
}

function createGuardrailData(
  input: string,
  agentName = "test-agent",
): InputGuardrailData {
  return { input, agentName };
}

// ============================================================================
// consent
// ============================================================================

describe("compliance", () => {
  describe("consent", () => {
    it("grant() stores consent record with granted=true and grantedAt", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      const record = await compliance.consent.grant("user-1", "marketing");

      expect(record.subjectId).toBe("user-1");
      expect(record.purpose).toBe("marketing");
      expect(record.granted).toBe(true);
      expect(record.grantedAt).toBeTypeOf("number");
    });

    it("revoke() sets granted=false and revokedAt", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      await compliance.consent.grant("user-1", "marketing");
      const revoked = await compliance.consent.revoke("user-1", "marketing");

      expect(revoked).not.toBeNull();
      expect(revoked!.granted).toBe(false);
      expect(revoked!.revokedAt).toBeTypeOf("number");
    });

    it("revoke() returns null for non-existent consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.consent.revoke("user-1", "marketing");

      expect(result).toBeNull();
    });

    it("check() returns true for active consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      await compliance.consent.grant("user-1", "analytics");

      const result = await compliance.consent.check("user-1", "analytics");

      expect(result).toBe(true);
    });

    it("check() returns false for revoked consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      await compliance.consent.grant("user-1", "analytics");
      await compliance.consent.revoke("user-1", "analytics");

      const result = await compliance.consent.check("user-1", "analytics");

      expect(result).toBe(false);
    });

    it("check() returns false for expired consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      // Grant with an already-expired expiresAt
      await compliance.consent.grant("user-1", "marketing", {
        expiresAt: Date.now() - 1000,
      });

      const result = await compliance.consent.check("user-1", "marketing");

      expect(result).toBe(false);
    });

    it("check() returns false for non-existent consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.consent.check("user-1", "marketing");

      expect(result).toBe(false);
    });

    it("getForSubject() returns all consents for a subject", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      await compliance.consent.grant("user-1", "marketing");
      await compliance.consent.grant("user-1", "analytics");
      await compliance.consent.grant("user-2", "marketing");

      const consents = await compliance.consent.getForSubject("user-1");

      expect(consents).toHaveLength(2);
      expect(consents.map((c) => c.purpose).sort()).toEqual([
        "analytics",
        "marketing",
      ]);
    });

    it("getForPurpose() returns all subjects with consent for purpose", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      await compliance.consent.grant("user-1", "marketing");
      await compliance.consent.grant("user-2", "marketing");
      await compliance.consent.grant("user-3", "analytics");

      const consents = await compliance.consent.getForPurpose("marketing");

      expect(consents).toHaveLength(2);
      expect(consents.map((c) => c.subjectId).sort()).toEqual([
        "user-1",
        "user-2",
      ]);
    });

    it("onConsentChange callback fires on grant and revoke", async () => {
      const storage = createInMemoryComplianceStorage();
      const onConsentChange = vi.fn();
      const compliance = createCompliance({
        storage,
        events: { onConsentChange },
      });

      await compliance.consent.grant("user-1", "marketing");
      expect(onConsentChange).toHaveBeenCalledTimes(1);
      expect(onConsentChange).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: "user-1",
          purpose: "marketing",
          granted: true,
        }),
      );

      await compliance.consent.revoke("user-1", "marketing");
      expect(onConsentChange).toHaveBeenCalledTimes(2);
      expect(onConsentChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          subjectId: "user-1",
          purpose: "marketing",
          granted: false,
        }),
      );
    });
  });

  // ==========================================================================
  // exportData
  // ==========================================================================

  describe("exportData", () => {
    it("exports data in JSON format with checksum", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "json",
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("json");
      expect(result.checksum).toBeTypeOf("string");
      expect(result.checksum.length).toBeGreaterThan(0);

      const parsed = JSON.parse(result.data);
      expect(parsed.subjectId).toBe("user-1");
      expect(parsed.records).toHaveLength(1);
    });

    it("exports data in CSV format", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "csv",
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("csv");
      // CSV should have a header row and at least one data row
      const lines = result.data.split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(2);
      // Header should include category, id, createdAt, and data fields
      expect(lines[0]).toContain("category");
      expect(lines[0]).toContain("id");
    });

    it("returns success=true with recordCount", async () => {
      const storage = createMockStorage();
      storage.getSubjectData.mockResolvedValue([
        {
          category: "profile",
          records: [
            { id: "r1", data: { name: "John" }, createdAt: Date.now() },
            { id: "r2", data: { name: "Jane" }, createdAt: Date.now() },
          ],
        },
        {
          category: "orders",
          records: [
            { id: "r3", data: { item: "widget" }, createdAt: Date.now() },
          ],
        },
      ]);
      const compliance = createCompliance({ storage });

      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "json",
      });

      expect(result.success).toBe(true);
      expect(result.recordCount).toBe(3);
      expect(result.categories).toEqual(["profile", "orders"]);
    });

    it("includes audit entries when includeAudit=true", async () => {
      const storage = createMockStorage();
      storage.getAuditEntries.mockResolvedValue([
        {
          id: "audit-1",
          timestamp: Date.now(),
          eventType: "login",
          payload: { ip: "127.0.0.1" },
        },
      ]);
      const compliance = createCompliance({ storage });

      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "json",
        includeAudit: true,
      });

      expect(result.success).toBe(true);
      expect(result.categories).toContain("audit");
      // 1 profile record + 1 audit record
      expect(result.recordCount).toBe(2);
    });

    it("filters by categories", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      await compliance.exportData({
        subjectId: "user-1",
        format: "json",
        categories: ["profile"],
      });

      expect(storage.getSubjectData).toHaveBeenCalledWith("user-1", [
        "profile",
      ]);
    });

    it("sets expiresAt based on exportExpirationMs config", async () => {
      const storage = createMockStorage();
      const exportExpirationMs = 60 * 60 * 1000; // 1 hour
      const compliance = createCompliance({ storage, exportExpirationMs });

      const before = Date.now();
      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "json",
      });
      const after = Date.now();

      expect(result.expiresAt).toBeTypeOf("number");
      expect(result.expiresAt!).toBeGreaterThanOrEqual(
        before + exportExpirationMs,
      );
      expect(result.expiresAt!).toBeLessThanOrEqual(
        after + exportExpirationMs,
      );
    });

    it("onExport callback fires", async () => {
      const storage = createMockStorage();
      const onExport = vi.fn();
      const compliance = createCompliance({ storage, events: { onExport } });

      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "json",
      });

      expect(onExport).toHaveBeenCalledTimes(1);
      expect(onExport).toHaveBeenCalledWith(result);
    });

    it("returns success=false with error on storage failure", async () => {
      const storage = createMockStorage();
      storage.getSubjectData.mockRejectedValue(new Error("Storage unavailable"));
      const compliance = createCompliance({ storage });

      const result = await compliance.exportData({
        subjectId: "user-1",
        format: "json",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Storage unavailable");
      expect(result.data).toBe("");
      expect(result.recordCount).toBe(0);
    });
  });

  // ==========================================================================
  // deleteData
  // ==========================================================================

  describe("deleteData", () => {
    it("deletes subject data with scope all", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.deleteData({
        subjectId: "user-1",
        scope: "all",
      });

      expect(result.success).toBe(true);
      expect(result.recordsAffected).toBe(1);
      expect(storage.deleteSubjectData).toHaveBeenCalledWith(
        "user-1",
        undefined,
      );
    });

    it("returns deletion certificate with hash", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.deleteData({
        subjectId: "user-1",
        scope: "all",
      });

      expect(result.certificate).toBeDefined();
      expect(result.certificate.id).toBeTypeOf("string");
      expect(result.certificate.subjectId).toBe("user-1");
      expect(result.certificate.hash).toBeTypeOf("string");
      expect(result.certificate.hash.length).toBeGreaterThan(0);
      expect(result.certificate.type).toBe("hard");
      expect(storage.storeDeletionCertificate).toHaveBeenCalledTimes(1);
    });

    it("anonymize=true calls anonymizeSubjectData instead of deleteSubjectData", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.deleteData({
        subjectId: "user-1",
        scope: "all",
        anonymize: true,
      });

      expect(result.success).toBe(true);
      expect(result.anonymized).toBe(true);
      expect(storage.anonymizeSubjectData).toHaveBeenCalledWith(
        "user-1",
        undefined,
      );
      expect(storage.deleteSubjectData).not.toHaveBeenCalled();
    });

    it("certificate type is anonymization when anonymize=true", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const result = await compliance.deleteData({
        subjectId: "user-1",
        scope: "all",
        anonymize: true,
      });

      expect(result.certificate.type).toBe("anonymization");
    });

    it("onDelete callback fires", async () => {
      const storage = createMockStorage();
      const onDelete = vi.fn();
      const compliance = createCompliance({ storage, events: { onDelete } });

      const result = await compliance.deleteData({
        subjectId: "user-1",
        scope: "all",
      });

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith(result);
    });

    it("returns success=false with error on storage failure", async () => {
      const storage = createMockStorage();
      storage.deleteSubjectData.mockRejectedValue(
        new Error("Deletion failed"),
      );
      const compliance = createCompliance({ storage });

      const result = await compliance.deleteData({
        subjectId: "user-1",
        scope: "all",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Deletion failed");
      expect(result.recordsAffected).toBe(0);
      expect(result.certificate.id).toBe("error");
    });
  });

  // ==========================================================================
  // enforceRetention
  // ==========================================================================

  describe("enforceRetention", () => {
    it("deletes expired data by category based on retention policy", async () => {
      const storage = createMockStorage();
      storage.getExpiredData.mockResolvedValue([
        { id: "old-1", createdAt: 1000 },
        { id: "old-2", createdAt: 2000 },
      ]);
      storage.deleteByIds.mockResolvedValue(2);

      const compliance = createCompliance({
        storage,
        retention: {
          name: "standard",
          defaultRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
        },
      });

      const deleted = await compliance.enforceRetention();

      expect(deleted).toBe(2);
      expect(storage.getExpiredData).toHaveBeenCalled();
      expect(storage.deleteByIds).toHaveBeenCalledWith(["old-1", "old-2"]);
    });

    it("uses categoryRetention for specific categories", async () => {
      const storage = createMockStorage();
      const now = Date.now();
      storage.getExpiredData.mockImplementation(
        async (category: string, olderThan: number) => {
          if (category === "sessions") {
            // Verify the cutoff uses category-specific retention
            const expectedCutoff = now - 7 * 24 * 60 * 60 * 1000;
            // Allow a small time delta for test execution
            if (Math.abs(olderThan - expectedCutoff) < 1000) {
              return [{ id: "session-1", createdAt: 1000 }];
            }
          }

          return [];
        },
      );
      storage.deleteByIds.mockResolvedValue(1);

      const compliance = createCompliance({
        storage,
        retention: {
          name: "custom",
          defaultRetentionMs: 365 * 24 * 60 * 60 * 1000,
          categoryRetention: {
            sessions: 7 * 24 * 60 * 60 * 1000, // 7 days
          },
        },
      });

      const deleted = await compliance.enforceRetention();

      expect(deleted).toBe(1);
      expect(storage.getExpiredData).toHaveBeenCalledWith(
        "sessions",
        expect.any(Number),
      );
    });

    it("falls back to defaultRetentionMs", async () => {
      const storage = createMockStorage();
      storage.getExpiredData.mockResolvedValue([]);

      const defaultRetentionMs = 90 * 24 * 60 * 60 * 1000; // 90 days
      const compliance = createCompliance({
        storage,
        retention: {
          name: "default-only",
          defaultRetentionMs,
        },
      });

      await compliance.enforceRetention();

      // "default" category should use defaultRetentionMs
      const callArgs = storage.getExpiredData.mock.calls[0]!;
      expect(callArgs[0]).toBe("default");

      const now = Date.now();
      const expectedCutoff = now - defaultRetentionMs;
      expect(Math.abs((callArgs[1] as number) - expectedCutoff)).toBeLessThan(1000);
    });

    it("returns total deleted count", async () => {
      const storage = createMockStorage();
      storage.getExpiredData.mockImplementation(
        async (category: string) => {
          if (category === "audit") {
            return [{ id: "a1", createdAt: 1000 }];
          }
          if (category === "logs") {
            return [
              { id: "l1", createdAt: 1000 },
              { id: "l2", createdAt: 2000 },
            ];
          }

          return [];
        },
      );
      storage.deleteByIds.mockImplementation(async (ids: string[]) => ids.length);

      const compliance = createCompliance({
        storage,
        retention: {
          name: "multi",
          defaultRetentionMs: 30 * 24 * 60 * 60 * 1000,
          categoryRetention: {
            audit: 365 * 24 * 60 * 60 * 1000,
            logs: 7 * 24 * 60 * 60 * 1000,
          },
        },
      });

      const total = await compliance.enforceRetention();

      expect(total).toBe(3);
    });

    it("fires onRetentionEnforced callback", async () => {
      const storage = createMockStorage();
      storage.getExpiredData.mockResolvedValue([
        { id: "old-1", createdAt: 1000 },
      ]);
      storage.deleteByIds.mockResolvedValue(1);

      const onRetentionEnforced = vi.fn();
      const compliance = createCompliance({
        storage,
        retention: {
          name: "with-callback",
          defaultRetentionMs: 30 * 24 * 60 * 60 * 1000,
        },
        events: { onRetentionEnforced },
      });

      await compliance.enforceRetention();

      expect(onRetentionEnforced).toHaveBeenCalledWith("default", 1);
    });

    it("returns 0 when no retention policy is configured", async () => {
      const storage = createMockStorage();
      const compliance = createCompliance({ storage });

      const deleted = await compliance.enforceRetention();

      expect(deleted).toBe(0);
    });
  });

  // ==========================================================================
  // createConsentGuardrail
  // ==========================================================================

  describe("createConsentGuardrail", () => {
    it("returns passed=true when no user_id in input", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      const guardrail = compliance.createConsentGuardrail("marketing");
      const result = await guardrail(
        createGuardrailData("Hello, how are you?"),
        { agentName: "test", input: "", facts: {} },
      );

      expect(result.passed).toBe(true);
    });

    it("returns passed=false when user has no consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      const guardrail = compliance.createConsentGuardrail("marketing");
      const result = await guardrail(
        createGuardrailData("Process data for user_id: abc123"),
        { agentName: "test", input: "", facts: {} },
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toContain("No consent");
      expect(result.reason).toContain("marketing");
    });

    it("returns passed=true when user has consent", async () => {
      const storage = createInMemoryComplianceStorage();
      const compliance = createCompliance({ storage });

      await compliance.consent.grant("abc123", "marketing");

      const guardrail = compliance.createConsentGuardrail("marketing");
      const result = await guardrail(
        createGuardrailData("Process data for user_id: abc123"),
        { agentName: "test", input: "", facts: {} },
      );

      expect(result.passed).toBe(true);
    });
  });
});
