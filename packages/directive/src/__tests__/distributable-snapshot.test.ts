/**
 * Distributable Snapshot Tests
 *
 * Tests for getDistributableSnapshot() which creates serializable
 * snapshots of computed derivations for distribution (Redis, JWT, etc).
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t, isSnapshotExpired, validateSnapshot, diffSnapshots, signSnapshot, verifySnapshotSignature, isSignedSnapshot } from "../index.js";

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

	describe("diffSnapshots utility", () => {
		it("returns identical: true when snapshots are the same", () => {
			const snapshot = {
				data: { canUseApi: true, limits: { apiCalls: 1000 } },
				createdAt: Date.now(),
				version: "abc123",
			};

			const diff = diffSnapshots(snapshot, snapshot);

			expect(diff.identical).toBe(true);
			expect(diff.changes).toHaveLength(0);
			expect(diff.versionChanged).toBe(false);
		});

		it("detects primitive value changes", () => {
			const oldSnapshot = {
				data: { canUseApi: false, plan: "free" },
				createdAt: Date.now(),
			};
			const newSnapshot = {
				data: { canUseApi: true, plan: "pro" },
				createdAt: Date.now(),
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			expect(diff.changes).toHaveLength(2);
			expect(diff.changes).toContainEqual({
				path: "canUseApi",
				oldValue: false,
				newValue: true,
				type: "changed",
			});
			expect(diff.changes).toContainEqual({
				path: "plan",
				oldValue: "free",
				newValue: "pro",
				type: "changed",
			});
		});

		it("detects added properties", () => {
			const oldSnapshot = {
				data: { canUseApi: true },
				createdAt: Date.now(),
			};
			const newSnapshot = {
				data: { canUseApi: true, canExport: true },
				createdAt: Date.now(),
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			expect(diff.changes).toContainEqual({
				path: "canExport",
				oldValue: undefined,
				newValue: true,
				type: "added",
			});
		});

		it("detects removed properties", () => {
			const oldSnapshot = {
				data: { canUseApi: true, canExport: true },
				createdAt: Date.now(),
			};
			const newSnapshot = {
				data: { canUseApi: true },
				createdAt: Date.now(),
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			expect(diff.changes).toContainEqual({
				path: "canExport",
				oldValue: true,
				newValue: undefined,
				type: "removed",
			});
		});

		it("detects nested object changes", () => {
			const oldSnapshot = {
				data: { limits: { apiCalls: 100, storage: 1 } },
				createdAt: Date.now(),
			};
			const newSnapshot = {
				data: { limits: { apiCalls: 10000, storage: 100 } },
				createdAt: Date.now(),
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			expect(diff.changes).toContainEqual({
				path: "limits.apiCalls",
				oldValue: 100,
				newValue: 10000,
				type: "changed",
			});
			expect(diff.changes).toContainEqual({
				path: "limits.storage",
				oldValue: 1,
				newValue: 100,
				type: "changed",
			});
		});

		it("detects array changes", () => {
			const oldSnapshot = {
				data: { features: ["api", "export"] },
				createdAt: Date.now(),
			};
			const newSnapshot = {
				data: { features: ["api", "export", "analytics"] },
				createdAt: Date.now(),
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			// Arrays with different lengths are reported as changed
			expect(diff.changes).toContainEqual({
				path: "features",
				oldValue: ["api", "export"],
				newValue: ["api", "export", "analytics"],
				type: "changed",
			});
		});

		it("detects version changes", () => {
			const oldSnapshot = {
				data: { test: true },
				createdAt: Date.now(),
				version: "abc123",
			};
			const newSnapshot = {
				data: { test: true },
				createdAt: Date.now(),
				version: "def456",
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(true); // data is the same
			expect(diff.versionChanged).toBe(true);
			expect(diff.oldVersion).toBe("abc123");
			expect(diff.newVersion).toBe("def456");
		});

		it("handles null values", () => {
			const oldSnapshot = {
				data: { value: null },
				createdAt: Date.now(),
			};
			const newSnapshot = {
				data: { value: "something" },
				createdAt: Date.now(),
			};

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			expect(diff.changes).toContainEqual({
				path: "value",
				oldValue: null,
				newValue: "something",
				type: "added",
			});
		});

		it("works with real system snapshots", () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			const oldSnapshot = system.getDistributableSnapshot({ includeVersion: true });

			system.dispatch({ type: "setPlan", plan: "pro" });

			const newSnapshot = system.getDistributableSnapshot({ includeVersion: true });

			const diff = diffSnapshots(oldSnapshot, newSnapshot);

			expect(diff.identical).toBe(false);
			expect(diff.versionChanged).toBe(true);
			expect(diff.changes.some(c => c.path === "canUseApi")).toBe(true);
			expect(diff.changes.some(c => c.path === "effectivePlan")).toBe(true);

			system.stop();
		});
	});

	describe("watchDistributableSnapshot", () => {
		it("calls callback when derivations change", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			const snapshots: Array<{ data: Record<string, unknown>; version?: string }> = [];

			const unsubscribe = system.watchDistributableSnapshot(
				{ includeDerivations: ["canUseApi", "effectivePlan"] },
				(snapshot) => {
					snapshots.push(snapshot);
				},
			);

			// Change plan which should trigger callback
			system.dispatch({ type: "setPlan", plan: "pro" });
			await new Promise((r) => setTimeout(r, 10));

			expect(snapshots.length).toBe(1);
			expect(snapshots[0].data).toHaveProperty("canUseApi", true);
			expect(snapshots[0].data).toHaveProperty("effectivePlan", "pro");

			// Change plan again
			system.dispatch({ type: "setPlan", plan: "enterprise" });
			await new Promise((r) => setTimeout(r, 10));

			expect(snapshots.length).toBe(2);
			expect(snapshots[1].data).toHaveProperty("effectivePlan", "enterprise");

			unsubscribe();
			system.stop();
		});

		it("returns unsubscribe function that stops callbacks", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			let callCount = 0;
			const unsubscribe = system.watchDistributableSnapshot(
				{ includeDerivations: ["canUseApi"] },
				() => {
					callCount++;
				},
			);

			system.dispatch({ type: "setPlan", plan: "pro" });
			await new Promise((r) => setTimeout(r, 10));
			expect(callCount).toBe(1);

			// Unsubscribe
			unsubscribe();

			// Should not trigger callback
			system.dispatch({ type: "setPlan", plan: "enterprise" });
			await new Promise((r) => setTimeout(r, 10));
			expect(callCount).toBe(1);

			system.stop();
		});

		it("does not call callback when values are unchanged", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			let callCount = 0;
			const unsubscribe = system.watchDistributableSnapshot(
				{ includeDerivations: ["canUseApi"] },
				() => {
					callCount++;
				},
			);

			// Change to same plan (free -> free)
			system.dispatch({ type: "setPlan", plan: "free" });
			await new Promise((r) => setTimeout(r, 10));

			// Should not trigger callback because derivation value is the same
			expect(callCount).toBe(0);

			unsubscribe();
			system.stop();
		});

		it("respects options like ttlSeconds and metadata", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			let capturedSnapshot: {
				data: Record<string, unknown>;
				expiresAt?: number;
				metadata?: Record<string, unknown>;
			} | null = null;

			const unsubscribe = system.watchDistributableSnapshot(
				{
					includeDerivations: ["canUseApi"],
					ttlSeconds: 3600,
					metadata: { source: "watch" },
				},
				(snapshot) => {
					capturedSnapshot = snapshot;
				},
			);

			system.dispatch({ type: "setPlan", plan: "pro" });
			await new Promise((r) => setTimeout(r, 10));

			expect(capturedSnapshot).not.toBeNull();
			expect(capturedSnapshot!.expiresAt).toBeDefined();
			expect(capturedSnapshot!.metadata).toEqual({ source: "watch" });

			unsubscribe();
			system.stop();
		});

		it("works with namespaced systems", async () => {
			const authSchema = {
				facts: {
					role: t.string<"user" | "admin">(),
				},
				derivations: {
					isAdmin: t.boolean(),
				},
				events: {
					setRole: { role: t.string<"user" | "admin">() },
				},
				requirements: {},
			} satisfies ModuleSchema;

			const authModule = createModule("auth", {
				schema: authSchema,
				init: (facts) => {
					facts.role = "user";
				},
				derive: {
					isAdmin: (facts) => facts.role === "admin",
				},
				events: {
					setRole: (facts, { role }) => {
						facts.role = role;
					},
				},
			});

			const system = createSystem({
				modules: { auth: authModule },
			});
			system.start();

			const snapshots: Array<{ data: Record<string, Record<string, unknown>> }> = [];

			const unsubscribe = system.watchDistributableSnapshot(
				{ includeDerivations: ["auth.isAdmin"] },
				(snapshot) => {
					snapshots.push(snapshot as { data: Record<string, Record<string, unknown>> });
				},
			);

			system.events.auth.setRole({ role: "admin" });
			await new Promise((r) => setTimeout(r, 10));

			expect(snapshots.length).toBe(1);
			expect(snapshots[0].data.auth).toHaveProperty("isAdmin", true);

			unsubscribe();
			system.stop();
		});

		it("warns when no derivations to watch", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			try {
				const module = createEntitlementsModule();
				const system = createSystem({ module });
				system.start();

				const unsubscribe = system.watchDistributableSnapshot(
					{ includeDerivations: ["nonExistent"] },
					() => {},
				);

				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringContaining("No derivations to watch"),
				);

				unsubscribe();
				system.stop();
			} finally {
				warnSpy.mockRestore();
			}
		});
	});

	describe("snapshot signing (HMAC)", () => {
		const TEST_SECRET = "test-secret-key-for-hmac-signing-32bytes!";

		it("signs and verifies a snapshot", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			const snapshot = system.getDistributableSnapshot({
				includeDerivations: ["canUseApi", "effectivePlan"],
				ttlSeconds: 3600,
			});

			// Sign the snapshot
			const signed = await signSnapshot(snapshot, TEST_SECRET);

			// Verify it has signature
			expect(signed.signature).toBeDefined();
			expect(signed.algorithm).toBe("hmac-sha256");
			expect(typeof signed.signature).toBe("string");
			expect(signed.signature.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars

			// Verify the signature
			const isValid = await verifySnapshotSignature(signed, TEST_SECRET);
			expect(isValid).toBe(true);

			system.stop();
		});

		it("fails verification with wrong secret", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			const snapshot = system.getDistributableSnapshot();
			const signed = await signSnapshot(snapshot, TEST_SECRET);

			// Verify with wrong secret
			const isValid = await verifySnapshotSignature(signed, "wrong-secret");
			expect(isValid).toBe(false);

			system.stop();
		});

		it("fails verification if data is tampered", async () => {
			const module = createEntitlementsModule();
			const system = createSystem({ module });
			system.start();

			const snapshot = system.getDistributableSnapshot();
			const signed = await signSnapshot(snapshot, TEST_SECRET);

			// Tamper with the data
			const tampered = {
				...signed,
				data: { ...signed.data, canUseApi: true }, // Changed from false
			};

			const isValid = await verifySnapshotSignature(tampered, TEST_SECRET);
			expect(isValid).toBe(false);

			system.stop();
		});

		it("fails verification if signature is missing", async () => {
			const snapshot = {
				data: { test: true },
				createdAt: Date.now(),
			};

			// Try to verify unsigned snapshot
			const isValid = await verifySnapshotSignature(
				snapshot as never, // Force type for test
				TEST_SECRET,
			);
			expect(isValid).toBe(false);
		});

		it("isSignedSnapshot returns correct result", async () => {
			const unsigned = {
				data: { test: true },
				createdAt: Date.now(),
			};

			expect(isSignedSnapshot(unsigned)).toBe(false);

			const signed = await signSnapshot(unsigned, TEST_SECRET);
			expect(isSignedSnapshot(signed)).toBe(true);
		});

		it("signature is deterministic for same data", async () => {
			const snapshot1 = {
				data: { value: 42 },
				createdAt: 1000,
			};
			const snapshot2 = {
				data: { value: 42 },
				createdAt: 1000,
			};

			const signed1 = await signSnapshot(snapshot1, TEST_SECRET);
			const signed2 = await signSnapshot(snapshot2, TEST_SECRET);

			expect(signed1.signature).toBe(signed2.signature);
		});

		it("supports Uint8Array secret", async () => {
			const binarySecret = new Uint8Array([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
				0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
			]);

			const snapshot = { data: { test: true }, createdAt: Date.now() };
			const signed = await signSnapshot(snapshot, binarySecret);

			const isValid = await verifySnapshotSignature(signed, binarySecret);
			expect(isValid).toBe(true);
		});
	});
});
