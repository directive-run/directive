/**
 * Distributable Snapshot Tests
 *
 * Tests for getDistributableSnapshot() which creates serializable
 * snapshots of computed derivations for distribution (Redis, JWT, etc).
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t, isSnapshotExpired, validateSnapshot } from "../index.js";

describe("Distributable Snapshots", () => {
	const createEntitlementsModule = () => {
		const schema = {
			facts: {
				plan: t.string<"free" | "pro" | "enterprise">(),
				userId: t.string(),
			},
			derivations: {
				effectivePlan: t.string(),
				canUseApi: t.boolean(),
				canExport: t.boolean(),
				limits: t.any<{ apiCalls: number; storage: number }>(),
			},
			events: {
				setPlan: { plan: t.string<"free" | "pro" | "enterprise">() },
			},
			requirements: {},
		} satisfies ModuleSchema;

		return createModule("entitlements", {
			schema,
			init: (facts) => {
				facts.plan = "free";
				facts.userId = "user-123";
			},
			derive: {
				effectivePlan: (facts) => facts.plan,
				canUseApi: (facts) => facts.plan !== "free",
				canExport: (facts) => facts.plan === "enterprise",
				limits: (facts) => {
					switch (facts.plan) {
						case "enterprise":
							return { apiCalls: -1, storage: -1 };
						case "pro":
							return { apiCalls: 10000, storage: 100 };
						default:
							return { apiCalls: 100, storage: 1 };
					}
				},
			},
			events: {
				setPlan: (facts, { plan }) => {
					facts.plan = plan;
				},
			},
		});
	};

	it("returns computed derivations as serializable snapshot", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot = system.getDistributableSnapshot();

		expect(snapshot.data).toHaveProperty("effectivePlan", "free");
		expect(snapshot.data).toHaveProperty("canUseApi", false);
		expect(snapshot.data).toHaveProperty("canExport", false);
		expect(snapshot.data).toHaveProperty("limits");
		expect(snapshot.createdAt).toBeLessThanOrEqual(Date.now());

		// Verify it's serializable
		const serialized = JSON.stringify(snapshot);
		const deserialized = JSON.parse(serialized);
		expect(deserialized.data.effectivePlan).toBe("free");

		system.stop();
	});

	it("includes only specified derivations when includeDerivations is set", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot = system.getDistributableSnapshot({
			includeDerivations: ["canUseApi", "canExport"],
		});

		expect(Object.keys(snapshot.data)).toEqual(["canUseApi", "canExport"]);
		expect(snapshot.data).not.toHaveProperty("effectivePlan");
		expect(snapshot.data).not.toHaveProperty("limits");

		system.stop();
	});

	it("excludes specified derivations", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot = system.getDistributableSnapshot({
			excludeDerivations: ["limits"],
		});

		expect(snapshot.data).toHaveProperty("effectivePlan");
		expect(snapshot.data).toHaveProperty("canUseApi");
		expect(snapshot.data).toHaveProperty("canExport");
		expect(snapshot.data).not.toHaveProperty("limits");

		system.stop();
	});

	it("includes specified facts", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot = system.getDistributableSnapshot({
			includeDerivations: ["canUseApi"],
			includeFacts: ["plan", "userId"],
		});

		expect(snapshot.data).toHaveProperty("canUseApi");
		expect(snapshot.data).toHaveProperty("plan", "free");
		expect(snapshot.data).toHaveProperty("userId", "user-123");

		system.stop();
	});

	it("sets expiresAt based on ttlSeconds", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const beforeTime = Date.now();
		const snapshot = system.getDistributableSnapshot({
			ttlSeconds: 3600, // 1 hour
		});

		expect(snapshot.expiresAt).toBeDefined();
		expect(snapshot.expiresAt).toBeGreaterThanOrEqual(beforeTime + 3600 * 1000);
		expect(snapshot.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000);

		system.stop();
	});

	it("includes metadata when provided", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot = system.getDistributableSnapshot({
			metadata: {
				source: "api",
				requestId: "req-456",
			},
		});

		expect(snapshot.metadata).toEqual({
			source: "api",
			requestId: "req-456",
		});

		system.stop();
	});

	it("includes version hash when includeVersion is true", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot1 = system.getDistributableSnapshot({
			includeVersion: true,
		});

		expect(snapshot1.version).toBeDefined();
		expect(typeof snapshot1.version).toBe("string");

		// Change plan and get new snapshot
		system.dispatch({ type: "setPlan", plan: "pro" });

		const snapshot2 = system.getDistributableSnapshot({
			includeVersion: true,
		});

		// Version should change when data changes
		expect(snapshot2.version).not.toBe(snapshot1.version);

		system.stop();
	});

	it("reflects current state after changes", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		const snapshot1 = system.getDistributableSnapshot();
		expect(snapshot1.data).toHaveProperty("canUseApi", false);

		system.dispatch({ type: "setPlan", plan: "pro" });

		const snapshot2 = system.getDistributableSnapshot();
		expect(snapshot2.data).toHaveProperty("canUseApi", true);
		expect(snapshot2.data).toHaveProperty("effectivePlan", "pro");

		system.stop();
	});

	describe("namespaced systems", () => {
		it("transforms keys to namespaced format", () => {
			const authSchema = {
				facts: {
					token: t.string(),
				},
				derivations: {
					isAuthenticated: t.boolean(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const authModule = createModule("auth", {
				schema: authSchema,
				init: (facts) => {
					facts.token = "abc123";
				},
				derive: {
					isAuthenticated: (facts) => facts.token.length > 0,
				},
				events: {},
			});

			const dataSchema = {
				facts: {
					count: t.number(),
				},
				derivations: {
					doubled: t.number(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const dataModule = createModule("data", {
				schema: dataSchema,
				init: (facts) => {
					facts.count = 5;
				},
				derive: {
					doubled: (facts) => facts.count * 2,
				},
				events: {},
			});

			const system = createSystem({
				modules: { auth: authModule, data: dataModule },
			});
			system.start();

			const snapshot = system.getDistributableSnapshot();

			// Should be organized by namespace
			expect(snapshot.data).toHaveProperty("auth");
			expect(snapshot.data).toHaveProperty("data");

			const data = snapshot.data as {
				auth: { isAuthenticated: boolean };
				data: { doubled: number };
			};
			expect(data.auth.isAuthenticated).toBe(true);
			expect(data.data.doubled).toBe(10);

			system.stop();
		});

		it("accepts namespaced keys in options", () => {
			const authSchema = {
				facts: {
					token: t.string(),
				},
				derivations: {
					isAuthenticated: t.boolean(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const authModule = createModule("auth", {
				schema: authSchema,
				init: (facts) => {
					facts.token = "abc123";
				},
				derive: {
					isAuthenticated: (facts) => facts.token.length > 0,
				},
				events: {},
			});

			const dataSchema = {
				facts: {
					count: t.number(),
				},
				derivations: {
					doubled: t.number(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const dataModule = createModule("data", {
				schema: dataSchema,
				init: (facts) => {
					facts.count = 5;
				},
				derive: {
					doubled: (facts) => facts.count * 2,
				},
				events: {},
			});

			const system = createSystem({
				modules: { auth: authModule, data: dataModule },
			});
			system.start();

			const snapshot = system.getDistributableSnapshot({
				includeDerivations: ["auth.isAuthenticated"],
			});

			const data = snapshot.data as {
				auth: { isAuthenticated: boolean };
			};

			expect(data.auth).toHaveProperty("isAuthenticated", true);
			expect(data).not.toHaveProperty("data");

			system.stop();
		});
	});

	it("is safe to serialize to JSON", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();
		system.dispatch({ type: "setPlan", plan: "enterprise" });

		const snapshot = system.getDistributableSnapshot({
			ttlSeconds: 3600,
			metadata: { source: "test" },
			includeVersion: true,
		});

		// Should not throw
		const json = JSON.stringify(snapshot);
		const parsed = JSON.parse(json);

		expect(parsed.data.effectivePlan).toBe("enterprise");
		expect(parsed.data.canExport).toBe(true);
		expect(parsed.expiresAt).toBeDefined();
		expect(parsed.version).toBeDefined();
		expect(parsed.metadata.source).toBe("test");

		system.stop();
	});

	it("produces deterministic version hashes for same data", () => {
		const module = createEntitlementsModule();
		const system = createSystem({ module });
		system.start();

		// Get multiple snapshots with same state
		const snapshot1 = system.getDistributableSnapshot({ includeVersion: true });
		const snapshot2 = system.getDistributableSnapshot({ includeVersion: true });
		const snapshot3 = system.getDistributableSnapshot({ includeVersion: true });

		// All should have identical version hashes
		expect(snapshot1.version).toBe(snapshot2.version);
		expect(snapshot2.version).toBe(snapshot3.version);

		system.stop();
	});

	it("warns about unknown derivation keys in dev mode", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			system.getDistributableSnapshot({
				includeDerivations: ["effectivePlan", "nonExistent", "alsoFake"],
			});

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("nonExistent"),
			);
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("alsoFake"),
			);

			system.stop();
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("warns about unknown fact keys in dev mode", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			system.getDistributableSnapshot({
				includeFacts: ["plan", "unknownFact"],
			});

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("unknownFact"),
			);

			system.stop();
		} finally {
			warnSpy.mockRestore();
		}
	});

	describe("isSnapshotExpired utility", () => {
		it("returns false when snapshot has no expiresAt", () => {
			const snapshot = {
				data: { test: true },
				createdAt: Date.now() - 10000,
			};

			expect(isSnapshotExpired(snapshot)).toBe(false);
		});

		it("returns false when snapshot has not expired", () => {
			const snapshot = {
				data: { test: true },
				createdAt: Date.now(),
				expiresAt: Date.now() + 3600000, // 1 hour from now
			};

			expect(isSnapshotExpired(snapshot)).toBe(false);
		});

		it("returns true when snapshot has expired", () => {
			const snapshot = {
				data: { test: true },
				createdAt: Date.now() - 7200000, // 2 hours ago
				expiresAt: Date.now() - 3600000, // 1 hour ago
			};

			expect(isSnapshotExpired(snapshot)).toBe(true);
		});

		it("accepts custom now timestamp for testing", () => {
			const snapshot = {
				data: { test: true },
				createdAt: 1000,
				expiresAt: 2000,
			};

			expect(isSnapshotExpired(snapshot, 1500)).toBe(false);
			expect(isSnapshotExpired(snapshot, 2001)).toBe(true);
		});

		it("returns false when now equals expiresAt exactly (boundary)", () => {
			// The implementation uses > not >=, so exactly-at-expiration is NOT expired
			const snapshot = {
				data: { test: true },
				createdAt: 1000,
				expiresAt: 2000,
			};

			expect(isSnapshotExpired(snapshot, 2000)).toBe(false); // exactly at boundary
			expect(isSnapshotExpired(snapshot, 1999)).toBe(false); // 1ms before
			expect(isSnapshotExpired(snapshot, 2001)).toBe(true);  // 1ms after
		});
	});

	describe("validateSnapshot utility", () => {
		it("returns data when snapshot is valid", () => {
			const snapshot = {
				data: { effectivePlan: "pro", canUseApi: true },
				createdAt: Date.now(),
				expiresAt: Date.now() + 3600000,
			};

			const data = validateSnapshot(snapshot);
			expect(data).toEqual({ effectivePlan: "pro", canUseApi: true });
		});

		it("returns data when snapshot has no expiration", () => {
			const snapshot = {
				data: { effectivePlan: "pro" },
				createdAt: Date.now() - 86400000, // 1 day ago
			};

			const data = validateSnapshot(snapshot);
			expect(data).toEqual({ effectivePlan: "pro" });
		});

		it("throws when snapshot has expired", () => {
			const snapshot = {
				data: { effectivePlan: "pro" },
				createdAt: Date.now() - 7200000,
				expiresAt: Date.now() - 3600000, // 1 hour ago
			};

			expect(() => validateSnapshot(snapshot)).toThrow(/expired/i);
		});

		it("accepts custom now timestamp for testing", () => {
			const snapshot = {
				data: { test: true },
				createdAt: 1000,
				expiresAt: 2000,
			};

			expect(validateSnapshot(snapshot, 1500)).toEqual({ test: true });
			expect(() => validateSnapshot(snapshot, 2001)).toThrow(/expired/i);
		});

		it("throws on null/undefined snapshot", () => {
			expect(() => validateSnapshot(null as any)).toThrow(/invalid snapshot/i);
			expect(() => validateSnapshot(undefined as any)).toThrow(/invalid snapshot/i);
		});

		it("throws on non-object snapshot", () => {
			expect(() => validateSnapshot("string" as any)).toThrow(/invalid snapshot/i);
			expect(() => validateSnapshot(123 as any)).toThrow(/invalid snapshot/i);
		});

		it("throws when missing data property", () => {
			const snapshot = { createdAt: Date.now() };
			expect(() => validateSnapshot(snapshot as any)).toThrow(/missing.*data/i);
		});

		it("throws when missing createdAt property", () => {
			const snapshot = { data: { test: true } };
			expect(() => validateSnapshot(snapshot as any)).toThrow(/missing.*createdAt/i);
		});

		it("throws when createdAt is not a number", () => {
			const snapshot = { data: { test: true }, createdAt: "2024-01-01" };
			expect(() => validateSnapshot(snapshot as any)).toThrow(/invalid.*createdAt/i);
		});
	});
});
