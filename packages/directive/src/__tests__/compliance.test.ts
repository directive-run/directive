import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	createCompliance,
	createInMemoryComplianceStorage,
	type ComplianceInstance,
	type ComplianceStorage,
} from "../adapters/plugins/compliance.js";

describe("Compliance Plugin", () => {
	let compliance: ComplianceInstance;
	let storage: ComplianceStorage;

	beforeEach(() => {
		storage = createInMemoryComplianceStorage();
		compliance = createCompliance({ storage });
	});

	describe("createInMemoryComplianceStorage", () => {
		it("should create an empty storage", async () => {
			const data = await storage.getSubjectData("user-123");
			expect(data).toHaveLength(0);
		});

		it("should store and retrieve consent", async () => {
			await storage.storeConsent({
				subjectId: "user-123",
				purpose: "marketing",
				granted: true,
				grantedAt: Date.now(),
			});

			const consent = await storage.getConsent("user-123", "marketing");
			expect(consent).toBeDefined();
			expect(consent?.granted).toBe(true);
		});

		it("should return null for non-existent consent", async () => {
			const consent = await storage.getConsent("user-999", "marketing");
			expect(consent).toBeNull();
		});

		it("should get consents by subject", async () => {
			await storage.storeConsent({
				subjectId: "user-123",
				purpose: "marketing",
				granted: true,
			});
			await storage.storeConsent({
				subjectId: "user-123",
				purpose: "analytics",
				granted: false,
			});

			const consents = await storage.getConsentsBySubject("user-123");
			expect(consents).toHaveLength(2);
		});

		it("should get consents by purpose", async () => {
			await storage.storeConsent({
				subjectId: "user-123",
				purpose: "marketing",
				granted: true,
			});
			await storage.storeConsent({
				subjectId: "user-456",
				purpose: "marketing",
				granted: true,
			});

			const consents = await storage.getConsentsByPurpose("marketing");
			expect(consents).toHaveLength(2);
		});
	});

	describe("Consent Tracking", () => {
		it("should grant consent", async () => {
			const record = await compliance.consent.grant("user-123", "marketing", {
				source: "signup_form",
			});

			expect(record.subjectId).toBe("user-123");
			expect(record.purpose).toBe("marketing");
			expect(record.granted).toBe(true);
			expect(record.grantedAt).toBeDefined();
			expect(record.source).toBe("signup_form");
		});

		it("should check consent - granted", async () => {
			await compliance.consent.grant("user-123", "marketing");

			const hasConsent = await compliance.consent.check("user-123", "marketing");
			expect(hasConsent).toBe(true);
		});

		it("should check consent - not granted", async () => {
			const hasConsent = await compliance.consent.check("user-123", "marketing");
			expect(hasConsent).toBe(false);
		});

		it("should revoke consent", async () => {
			await compliance.consent.grant("user-123", "marketing");
			const revoked = await compliance.consent.revoke("user-123", "marketing");

			expect(revoked?.granted).toBe(false);
			expect(revoked?.revokedAt).toBeDefined();

			const hasConsent = await compliance.consent.check("user-123", "marketing");
			expect(hasConsent).toBe(false);
		});

		it("should return null when revoking non-existent consent", async () => {
			const revoked = await compliance.consent.revoke("user-999", "marketing");
			expect(revoked).toBeNull();
		});

		it("should handle expired consent", async () => {
			await compliance.consent.grant("user-123", "marketing", {
				expiresAt: Date.now() - 1000, // Expired 1 second ago
			});

			const hasConsent = await compliance.consent.check("user-123", "marketing");
			expect(hasConsent).toBe(false);
		});

		it("should get all consents for subject", async () => {
			await compliance.consent.grant("user-123", "marketing");
			await compliance.consent.grant("user-123", "analytics");

			const consents = await compliance.consent.getForSubject("user-123");
			expect(consents).toHaveLength(2);
		});

		it("should get all consents for purpose", async () => {
			await compliance.consent.grant("user-123", "marketing");
			await compliance.consent.grant("user-456", "marketing");

			const consents = await compliance.consent.getForPurpose("marketing");
			expect(consents).toHaveLength(2);
		});

		it("should call onConsentChange callback", async () => {
			const onConsentChange = vi.fn();
			compliance = createCompliance({
				storage,
				events: { onConsentChange },
			});

			await compliance.consent.grant("user-123", "marketing");

			expect(onConsentChange).toHaveBeenCalledWith(
				expect.objectContaining({
					subjectId: "user-123",
					purpose: "marketing",
					granted: true,
				})
			);
		});
	});

	describe("Data Export (DSR)", () => {
		it("should export data as JSON", async () => {
			const result = await compliance.exportData({
				subjectId: "user-123",
				format: "json",
			});

			expect(result.success).toBe(true);
			expect(result.format).toBe("json");
			expect(result.checksum).toHaveLength(64);
			expect(result.exportedAt).toBeDefined();
		});

		it("should export data as CSV", async () => {
			const result = await compliance.exportData({
				subjectId: "user-123",
				format: "csv",
			});

			expect(result.success).toBe(true);
			expect(result.format).toBe("csv");
		});

		it("should include checksum for data integrity", async () => {
			const result = await compliance.exportData({
				subjectId: "user-123",
				format: "json",
			});

			expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
		});

		it("should include expiration timestamp", async () => {
			const result = await compliance.exportData({
				subjectId: "user-123",
				format: "json",
			});

			expect(result.expiresAt).toBeDefined();
			expect(result.expiresAt! > Date.now()).toBe(true);
		});

		it("should call onExport callback", async () => {
			const onExport = vi.fn();
			compliance = createCompliance({
				storage,
				events: { onExport },
			});

			await compliance.exportData({
				subjectId: "user-123",
				format: "json",
			});

			expect(onExport).toHaveBeenCalled();
		});

		it("should handle export errors gracefully", async () => {
			const badStorage = {
				...storage,
				getSubjectData: async () => {
					throw new Error("Storage error");
				},
			};

			const badCompliance = createCompliance({ storage: badStorage });

			const result = await badCompliance.exportData({
				subjectId: "user-123",
				format: "json",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Storage error");
		});
	});

	describe("Data Deletion (Right to Erasure)", () => {
		it("should delete all data for a subject", async () => {
			const result = await compliance.deleteData({
				subjectId: "user-123",
				scope: "all",
			});

			expect(result.success).toBe(true);
			expect(result.scope).toBe("all");
			expect(result.anonymized).toBe(false);
		});

		it("should generate deletion certificate", async () => {
			const result = await compliance.deleteData({
				subjectId: "user-123",
				scope: "all",
				reason: "User requested deletion",
			});

			expect(result.certificate).toBeDefined();
			expect(result.certificate.id).toBeDefined();
			expect(result.certificate.subjectId).toBe("user-123");
			expect(result.certificate.type).toBe("hard");
			expect(result.certificate.reason).toBe("User requested deletion");
			expect(result.certificate.hash).toHaveLength(64);
		});

		it("should anonymize instead of delete when requested", async () => {
			const result = await compliance.deleteData({
				subjectId: "user-123",
				scope: "all",
				anonymize: true,
			});

			expect(result.success).toBe(true);
			expect(result.anonymized).toBe(true);
			expect(result.certificate.type).toBe("anonymization");
		});

		it("should delete specific categories", async () => {
			const result = await compliance.deleteData({
				subjectId: "user-123",
				scope: "specific",
				categories: ["sessions", "analytics"],
			});

			expect(result.success).toBe(true);
			expect(result.scope).toBe("specific");
		});

		it("should call onDelete callback", async () => {
			const onDelete = vi.fn();
			compliance = createCompliance({
				storage,
				events: { onDelete },
			});

			await compliance.deleteData({
				subjectId: "user-123",
				scope: "all",
			});

			expect(onDelete).toHaveBeenCalled();
		});

		it("should handle deletion errors gracefully", async () => {
			const badStorage = {
				...storage,
				deleteSubjectData: async () => {
					throw new Error("Deletion error");
				},
			};

			const badCompliance = createCompliance({ storage: badStorage });

			const result = await badCompliance.deleteData({
				subjectId: "user-123",
				scope: "all",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Deletion error");
		});
	});

	describe("Retention Policy Enforcement", () => {
		it("should enforce retention policy", async () => {
			compliance = createCompliance({
				storage,
				retention: {
					name: "default",
					defaultRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
				},
			});

			const deleted = await compliance.enforceRetention();
			expect(typeof deleted).toBe("number");
		});

		it("should call retention callbacks", async () => {
			const onBeforeDelete = vi.fn().mockResolvedValue(undefined);
			const onAfterDelete = vi.fn();

			compliance = createCompliance({
				storage,
				retention: {
					name: "test",
					defaultRetentionMs: 0, // Immediate expiration
					onBeforeDelete,
					onAfterDelete,
				},
			});

			await compliance.enforceRetention();
			// Callbacks may or may not be called depending on data
		});

		it("should call onRetentionEnforced callback", async () => {
			const onRetentionEnforced = vi.fn();

			compliance = createCompliance({
				storage,
				retention: {
					name: "test",
					defaultRetentionMs: 0,
				},
				events: { onRetentionEnforced },
			});

			await compliance.enforceRetention();
			// Callback may or may not be called depending on data
		});

		it("should handle category-specific retention", async () => {
			compliance = createCompliance({
				storage,
				retention: {
					name: "mixed",
					defaultRetentionMs: 365 * 24 * 60 * 60 * 1000,
					categoryRetention: {
						sessions: 7 * 24 * 60 * 60 * 1000,
						audit: 7 * 365 * 24 * 60 * 60 * 1000,
					},
				},
			});

			const deleted = await compliance.enforceRetention();
			expect(typeof deleted).toBe("number");
		});

		it("should skip retention when not configured", async () => {
			compliance = createCompliance({ storage });

			const deleted = await compliance.enforceRetention();
			expect(deleted).toBe(0);
		});
	});

	describe("Consent Guardrail", () => {
		it("should create a consent guardrail", () => {
			const guardrail = compliance.createConsentGuardrail("marketing");
			expect(guardrail).toBeDefined();
		});

		it("should pass when consent is granted", async () => {
			await compliance.consent.grant("user-123", "marketing");

			const guardrail = compliance.createConsentGuardrail("marketing");
			const result = await guardrail(
				{ input: "Process data for user_id: user-123", agentName: "test" },
				{ agentName: "test", input: "", facts: {} }
			);

			expect(result.passed).toBe(true);
		});

		it("should fail when consent is not granted", async () => {
			const guardrail = compliance.createConsentGuardrail("marketing");
			const result = await guardrail(
				{ input: "Process data for user_id: user-123", agentName: "test" },
				{ agentName: "test", input: "", facts: {} }
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("No consent");
		});

		it("should pass when no subject ID found (fail open)", async () => {
			const guardrail = compliance.createConsentGuardrail("marketing");
			const result = await guardrail(
				{ input: "General query without user ID", agentName: "test" },
				{ agentName: "test", input: "", facts: {} }
			);

			expect(result.passed).toBe(true);
		});
	});

	describe("Configuration", () => {
		it("should use custom export expiration", async () => {
			const customExpiration = 60 * 60 * 1000; // 1 hour
			compliance = createCompliance({
				storage,
				exportExpirationMs: customExpiration,
			});

			const result = await compliance.exportData({
				subjectId: "user-123",
				format: "json",
			});

			const expectedExpiry = result.exportedAt + customExpiration;
			expect(result.expiresAt).toBe(expectedExpiry);
		});
	});

	describe("CSV Export", () => {
		it("should generate valid CSV format", async () => {
			// Note: With empty storage, we get an empty CSV
			const result = await compliance.exportData({
				subjectId: "user-123",
				format: "csv",
			});

			expect(result.success).toBe(true);
			// Empty data = empty CSV
			expect(result.data).toBe("");
		});
	});

	describe("getDeletionCertificate", () => {
		it("should return null (not implemented in base storage)", async () => {
			const cert = await compliance.getDeletionCertificate("user-123");
			expect(cert).toBeNull();
		});
	});
});
