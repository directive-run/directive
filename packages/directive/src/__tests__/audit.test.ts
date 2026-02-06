import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	createAuditTrail,
	createAgentAuditHandlers,
	type AuditInstance,
	type AuditEntry,
	type AuditPluginConfig,
} from "../adapters/plugins/audit.js";

describe("Audit Plugin", () => {
	let audit: AuditInstance;

	afterEach(async () => {
		if (audit) {
			await audit.dispose();
		}
	});

	describe("createAuditTrail", () => {
		it("should create an audit trail with default config", () => {
			audit = createAuditTrail();
			expect(audit).toBeDefined();
			expect(audit.getEntries()).toHaveLength(0);
		});

		it("should create an audit trail with custom config", () => {
			audit = createAuditTrail({
				maxEntries: 100,
				retentionMs: 1000,
				sessionId: "test-session",
				actorId: "test-actor",
			});
			expect(audit).toBeDefined();
		});
	});

	describe("addEntry", () => {
		beforeEach(() => {
			audit = createAuditTrail();
		});

		it("should add an entry with correct structure", async () => {
			const entry = await audit.addEntry("fact.set", { key: "test", value: 123 });

			expect(entry.id).toBeDefined();
			expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
			expect(entry.eventType).toBe("fact.set");
			expect(entry.payload).toEqual({ key: "test", value: 123 });
			expect(entry.hash).toHaveLength(64); // SHA-256 hex
			expect(entry.previousHash).toHaveLength(64); // Genesis hash
		});

		it("should chain entries with previous hash", async () => {
			const entry1 = await audit.addEntry("fact.set", { key: "a" });
			const entry2 = await audit.addEntry("fact.set", { key: "b" });

			expect(entry2.previousHash).toBe(entry1.hash);
		});

		it("should include sessionId and actorId when configured", async () => {
			audit = createAuditTrail({
				sessionId: "session-123",
				actorId: "user-456",
			});

			const entry = await audit.addEntry("requirement.created", { type: "TEST" });

			expect(entry.sessionId).toBe("session-123");
			expect(entry.actorId).toBe("user-456");
		});
	});

	describe("hash chain verification", () => {
		beforeEach(() => {
			audit = createAuditTrail();
		});

		it("should verify empty chain", async () => {
			const result = await audit.verifyChain();
			expect(result.valid).toBe(true);
			expect(result.entriesVerified).toBe(0);
		});

		it("should verify valid chain", async () => {
			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("fact.set", { key: "b" });
			await audit.addEntry("fact.set", { key: "c" });

			const result = await audit.verifyChain();
			expect(result.valid).toBe(true);
			expect(result.entriesVerified).toBe(3);
		});

		it("should detect tampered entry", async () => {
			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("fact.set", { key: "b" });

			// Tamper with an entry
			const entries = audit.getEntries();
			(entries[1] as { payload: Record<string, unknown> }).payload.key = "tampered";

			const result = await audit.verifyChain();
			expect(result.valid).toBe(false);
			expect(result.brokenAt?.index).toBe(1);
		});

		it("should call onChainBroken callback when chain is broken", async () => {
			const onChainBroken = vi.fn();
			audit = createAuditTrail({
				events: { onChainBroken },
			});

			await audit.addEntry("fact.set", { key: "a" });

			// Tamper
			const entries = audit.getEntries();
			(entries[0] as { hash: string }).hash = "tampered";

			await audit.verifyChain();
			expect(onChainBroken).toHaveBeenCalled();
		});
	});

	describe("PII masking", () => {
		it("should mask PII when enabled", async () => {
			audit = createAuditTrail({
				piiMasking: {
					enabled: true,
					types: ["ssn", "email"],
					redactionStyle: "typed",
				},
			});

			const entry = await audit.addEntry("agent.run.complete", {
				output: "Contact john@example.com, SSN: 123-45-6789",
			});

			expect(entry.payload.output).toContain("john@example.com");
			expect(entry.maskedPayload).toBeDefined();
			expect(entry.maskedPayload?.output).toContain("[EMAIL]");
			expect(entry.maskedPayload?.output).toContain("[SSN]");
		});

		it("should not mask when disabled", async () => {
			audit = createAuditTrail({
				piiMasking: {
					enabled: false,
					types: ["ssn"],
					redactionStyle: "typed",
				},
			});

			const entry = await audit.addEntry("agent.run.complete", {
				output: "SSN: 123-45-6789",
			});

			expect(entry.maskedPayload).toBeUndefined();
		});
	});

	describe("signing", () => {
		it("should sign entries when configured", async () => {
			const signFn = vi.fn().mockResolvedValue("mock-signature");

			audit = createAuditTrail({
				signing: { signFn },
			});

			const entry = await audit.addEntry("fact.set", { key: "test" });

			expect(signFn).toHaveBeenCalledWith(entry.hash);
			expect(entry.signature).toBe("mock-signature");
		});

		it("should verify signatures during chain verification", async () => {
			const verifyFn = vi.fn().mockResolvedValue(true);

			audit = createAuditTrail({
				signing: {
					signFn: async () => "valid-sig",
					verifyFn,
				},
			});

			await audit.addEntry("fact.set", { key: "test" });
			const result = await audit.verifyChain();

			expect(result.valid).toBe(true);
			expect(verifyFn).toHaveBeenCalled();
		});

		it("should fail verification with invalid signature", async () => {
			let callCount = 0;
			const verifyFn = vi.fn().mockImplementation(() => {
				callCount++;
				return Promise.resolve(callCount > 1 ? false : true);
			});

			audit = createAuditTrail({
				signing: {
					signFn: async () => "sig",
					verifyFn,
				},
			});

			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("fact.set", { key: "b" });

			const result = await audit.verifyChain();
			expect(result.valid).toBe(false);
		});
	});

	describe("bounded storage", () => {
		it("should enforce maxEntries with FIFO eviction", async () => {
			audit = createAuditTrail({ maxEntries: 3 });

			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("fact.set", { key: "b" });
			await audit.addEntry("fact.set", { key: "c" });
			await audit.addEntry("fact.set", { key: "d" });

			const entries = audit.getEntries();
			expect(entries).toHaveLength(3);
			expect(entries[0]?.payload.key).toBe("b"); // 'a' was evicted
		});

		it("should track pruned entries in stats", async () => {
			audit = createAuditTrail({ maxEntries: 2 });

			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("fact.set", { key: "b" });
			await audit.addEntry("fact.set", { key: "c" });

			const stats = audit.getStats();
			expect(stats.entriesPruned).toBe(1);
		});
	});

	describe("getEntries with filters", () => {
		beforeEach(async () => {
			audit = createAuditTrail();
			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("resolver.start", { resolver: "test" });
			await audit.addEntry("fact.set", { key: "b" });
			await audit.addEntry("error.occurred", { message: "test error" });
		});

		it("should filter by event types", () => {
			const entries = audit.getEntries({ eventTypes: ["fact.set"] });
			expect(entries).toHaveLength(2);
			expect(entries.every((e) => e.eventType === "fact.set")).toBe(true);
		});

		it("should filter by time range", async () => {
			const now = Date.now();
			const entries = audit.getEntries({ since: now - 1000 });
			expect(entries.length).toBeGreaterThan(0);
		});

		it("should apply limit", () => {
			const entries = audit.getEntries({ limit: 2 });
			expect(entries).toHaveLength(2);
		});

		it("should apply offset", () => {
			const entries = audit.getEntries({ offset: 2 });
			expect(entries).toHaveLength(2);
		});
	});

	describe("export", () => {
		it("should export entries", async () => {
			const exporter = vi.fn().mockResolvedValue(undefined);
			audit = createAuditTrail({ exporter, exportInterval: 0 });

			await audit.addEntry("fact.set", { key: "test" });
			const exported = await audit.export();

			expect(exported).toHaveLength(1);
			expect(exporter).toHaveBeenCalledWith(exported);
		});

		it("should export entries since timestamp", async () => {
			audit = createAuditTrail();

			await audit.addEntry("fact.set", { key: "a" });
			await new Promise((r) => setTimeout(r, 50)); // Wait longer to ensure clear time difference
			const midpoint = Date.now();
			await new Promise((r) => setTimeout(r, 50));
			await audit.addEntry("fact.set", { key: "b" });

			const exported = await audit.export(midpoint);
			expect(exported).toHaveLength(1);
			expect(exported[0]?.payload.key).toBe("b");
		});
	});

	describe("prune", () => {
		it("should prune entries older than retention period", async () => {
			audit = createAuditTrail({ retentionMs: 50 });

			await audit.addEntry("fact.set", { key: "old" });
			await new Promise((r) => setTimeout(r, 100));
			await audit.addEntry("fact.set", { key: "new" });

			const pruned = audit.prune();
			expect(pruned).toBe(1);
			expect(audit.getEntries()).toHaveLength(1);
			expect(audit.getEntries()[0]?.payload.key).toBe("new");
		});
	});

	describe("getStats", () => {
		it("should return correct statistics", async () => {
			audit = createAuditTrail();

			await audit.addEntry("fact.set", { key: "a" });
			await audit.addEntry("fact.set", { key: "b" });
			await audit.addEntry("error.occurred", { message: "test" });

			const stats = audit.getStats();
			expect(stats.totalEntries).toBe(3);
			expect(stats.byEventType["fact.set"]).toBe(2);
			expect(stats.byEventType["error.occurred"]).toBe(1);
			expect(stats.chainIntegrity).toBe(true);
		});
	});

	describe("dispose", () => {
		it("should flush remaining entries on dispose", async () => {
			const exporter = vi.fn().mockResolvedValue(undefined);
			audit = createAuditTrail({ exporter, exportInterval: 0 });

			await audit.addEntry("fact.set", { key: "test" });
			await audit.dispose();

			expect(exporter).toHaveBeenCalled();
		});

		it("should clear export timer on dispose", async () => {
			const exporter = vi.fn().mockResolvedValue(undefined);
			audit = createAuditTrail({ exporter, exportInterval: 100 });

			await audit.addEntry("fact.set", { key: "test" });
			await audit.dispose();

			// No more exports should happen
			await new Promise((r) => setTimeout(r, 150));
			const callCount = exporter.mock.calls.length;
			await new Promise((r) => setTimeout(r, 150));
			expect(exporter.mock.calls.length).toBe(callCount);
		});
	});

	describe("createPlugin", () => {
		it("should create a plugin with correct hooks", () => {
			audit = createAuditTrail();
			const plugin = audit.createPlugin();

			expect(plugin.name).toBe("audit-trail");
			expect(plugin.onFactSet).toBeDefined();
			expect(plugin.onFactsBatch).toBeDefined();
			expect(plugin.onRequirementCreated).toBeDefined();
			expect(plugin.onRequirementMet).toBeDefined();
			expect(plugin.onResolverStart).toBeDefined();
			expect(plugin.onResolverComplete).toBeDefined();
			expect(plugin.onResolverError).toBeDefined();
			expect(plugin.onError).toBeDefined();
			expect(plugin.onErrorRecovery).toBeDefined();
		});

		it("should log fact changes through plugin hooks", async () => {
			audit = createAuditTrail();
			const plugin = audit.createPlugin();

			plugin.onFactSet?.("testKey", "newValue", "oldValue");

			// Wait for async entry creation
			await new Promise((r) => setTimeout(r, 10));

			const entries = audit.getEntries({ eventTypes: ["fact.set"] });
			expect(entries).toHaveLength(1);
			expect(entries[0]?.payload).toEqual({
				key: "testKey",
				value: "newValue",
				prev: "oldValue",
			});
		});
	});

	describe("createAgentAuditHandlers", () => {
		it("should create handlers for agent events", () => {
			audit = createAuditTrail();
			const handlers = createAgentAuditHandlers(audit);

			expect(handlers.onAgentStart).toBeDefined();
			expect(handlers.onAgentComplete).toBeDefined();
			expect(handlers.onAgentError).toBeDefined();
			expect(handlers.onToolStart).toBeDefined();
			expect(handlers.onToolComplete).toBeDefined();
			expect(handlers.onToolError).toBeDefined();
			expect(handlers.onApprovalRequested).toBeDefined();
			expect(handlers.onApprovalGranted).toBeDefined();
			expect(handlers.onApprovalDenied).toBeDefined();
		});

		it("should log agent events", async () => {
			audit = createAuditTrail();
			const handlers = createAgentAuditHandlers(audit);

			handlers.onAgentStart("test-agent", "test input");
			handlers.onAgentComplete("test-agent", "output", 100, 0.01);

			await new Promise((r) => setTimeout(r, 10));

			const entries = audit.getEntries();
			expect(entries.some((e) => e.eventType === "agent.run.start")).toBe(true);
			expect(entries.some((e) => e.eventType === "agent.run.complete")).toBe(true);
		});
	});

	describe("event callbacks", () => {
		it("should call onEntryAdded callback", async () => {
			const onEntryAdded = vi.fn();
			audit = createAuditTrail({ events: { onEntryAdded } });

			await audit.addEntry("fact.set", { key: "test" });

			expect(onEntryAdded).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "fact.set",
					payload: { key: "test" },
				})
			);
		});

		it("should call onExportError on export failure", async () => {
			const onExportError = vi.fn();
			const exporter = vi.fn().mockRejectedValue(new Error("Export failed"));

			audit = createAuditTrail({
				exporter,
				exportInterval: 50,
				events: { onExportError },
			});

			await audit.addEntry("fact.set", { key: "test" });
			await new Promise((r) => setTimeout(r, 100));

			expect(onExportError).toHaveBeenCalled();
		});
	});
});
