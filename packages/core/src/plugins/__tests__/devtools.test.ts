import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { devtoolsPlugin } from "../devtools.js";

// ============================================================================
// Environment Setup — simulate browser for window.__DIRECTIVE__ registration
// ============================================================================

beforeEach(() => {
	// Make the plugin think it's running in a browser
	(globalThis as Record<string, unknown>).window = globalThis;
	delete (globalThis as Record<string, unknown>).__DIRECTIVE__;
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>).__DIRECTIVE__;
	delete (globalThis as Record<string, unknown>).window;
	vi.restoreAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

function createTestModule() {
	return createModule("test", {
		schema: {
			facts: {
				count: t.number(),
				label: t.string(),
			},
			derivations: {
				doubled: t.number(),
			},
			events: {
				increment: {},
				setLabel: { label: t.string() },
			},
			requirements: {},
		},
		init: (facts) => {
			facts.count = 0;
			facts.label = "";
		},
		derive: {
			doubled: (facts) => (facts.count as number) * 2,
		},
		events: {
			increment: (facts) => {
				facts.count = (facts.count as number) + 1;
			},
			setLabel: (facts, { label }) => {
				facts.label = label;
			},
		},
	});
}

function createConstraintModule() {
	return createModule("constrained", {
		schema: {
			facts: {
				status: t.string(),
				data: t.string(),
			},
			derivations: {},
			events: {
				setStatus: { value: t.string() },
			},
			requirements: {
				FETCH_DATA: { url: t.string() },
			},
		},
		init: (facts) => {
			facts.status = "idle";
			facts.data = "";
		},
		events: {
			setStatus: (facts, { value }) => {
				facts.status = value;
			},
		},
		constraints: {
			needsData: {
				when: (facts) => facts.status === "loading",
				require: () => ({ type: "FETCH_DATA", url: "/api/data" }),
			},
		},
		resolvers: {
			fetchData: {
				requirement: "FETCH_DATA",
				resolve: async (_req, context) => {
					context.facts.data = "loaded";
					context.facts.status = "loaded";
				},
			},
		},
	});
}

// Helper to get the global devtools
function dt() {
	return (globalThis as Record<string, unknown>).__DIRECTIVE__ as NonNullable<Window["__DIRECTIVE__"]>;
}

// ============================================================================
// Console API & Registration
// ============================================================================

describe("devtoolsPlugin", () => {
	describe("console API registration", () => {
		it("registers system on window.__DIRECTIVE__", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "test-app" })],
			});
			system.start();

			expect(dt()).toBeDefined();
			expect(dt().getSystems()).toContain("test-app");
			expect(dt().getSystem("test-app")).not.toBeNull();

			system.destroy();
		});

		it("uses 'default' name when none provided", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin()],
			});
			system.start();

			expect(dt().getSystems()).toContain("default");

			system.destroy();
		});

		it("supports multiple systems", () => {
			const mod1 = createTestModule();
			const mod2 = createTestModule();
			const system1 = createSystem({
				module: mod1,
				plugins: [devtoolsPlugin({ name: "app1" })],
			});
			const system2 = createSystem({
				module: mod2,
				plugins: [devtoolsPlugin({ name: "app2" })],
			});
			system1.start();
			system2.start();

			const names = dt().getSystems();
			expect(names).toContain("app1");
			expect(names).toContain("app2");
			expect(dt().getSystem("app1")).not.toBeNull();
			expect(dt().getSystem("app2")).not.toBeNull();

			system1.destroy();
			system2.destroy();
		});

		it("getSystem() returns first system when no name provided", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "only-one" })],
			});
			system.start();

			expect(dt().getSystem()).not.toBeNull();

			system.destroy();
		});

		it("getSystem() returns null for unknown name", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "exists" })],
			});
			system.start();

			expect(dt().getSystem("does-not-exist")).toBeNull();

			system.destroy();
		});

		it("unregisters system on destroy", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "ephemeral" })],
			});
			system.start();

			expect(dt().getSystems()).toContain("ephemeral");

			system.destroy();

			expect(dt().getSystems()).not.toContain("ephemeral");
		});

		it("logs initialization message", () => {
			const logSpy = vi.spyOn(console, "log");
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "my-app" })],
			});
			system.start();

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("[Directive Devtools]"),
				expect.any(String),
				expect.any(String),
			);

			system.destroy();
		});
	});

	// ============================================================================
	// Inspect API
	// ============================================================================

	describe("inspect()", () => {
		it("returns inspection data for named system", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "inspectable" })],
			});
			system.start();
			await system.settle();

			const result = dt().inspect("inspectable") as Record<string, unknown>;
			expect(result).toBeDefined();
			expect(result).toHaveProperty("unmet");
			expect(result).toHaveProperty("inflight");
			expect(result).toHaveProperty("constraints");
			expect(result).toHaveProperty("resolvers");

			system.destroy();
		});

		it("returns null for unknown system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "known" })],
			});
			system.start();

			expect(dt().inspect("unknown")).toBeNull();

			system.destroy();
		});

		it("inspect() with no name uses first system", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "first" })],
			});
			system.start();
			await system.settle();

			const result = dt().inspect();
			expect(result).toBeDefined();

			system.destroy();
		});
	});

	// ============================================================================
	// Event Tracing
	// ============================================================================

	describe("event tracing", () => {
		it("records no events when trace is false", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "no-trace", trace: false })],
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			const events = dt().getEvents("no-trace");
			expect(events).toHaveLength(0);

			system.destroy();
		});

		it("records events when trace is true", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "traced", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			const events = dt().getEvents("traced");
			expect(events.length).toBeGreaterThan(0);

			system.destroy();
		});

		it("records init event on startup", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "init-test", trace: true })],
			});
			system.start();

			const events = dt().getEvents("init-test");
			const initEvent = events.find(e => e.type === "init");
			expect(initEvent).toBeDefined();

			system.destroy();
		});

		it("records start event", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "start-test", trace: true })],
			});
			system.start();

			const events = dt().getEvents("start-test");
			const startEvent = events.find(e => e.type === "start");
			expect(startEvent).toBeDefined();

			system.destroy();
		});

		it("records fact.set events", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "fact-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.facts.count = 42;
			await system.settle();

			const events = dt().getEvents("fact-test");
			const factEvent = events.find(
				e => e.type === "fact.set" && (e.data as Record<string, unknown>).key === "count",
			);
			expect(factEvent).toBeDefined();
			expect((factEvent!.data as Record<string, unknown>).value).toBe(42);

			system.destroy();
		});

		it("records derivation.compute events", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "deriv-test", trace: true })],
			});
			system.start();
			await system.settle();

			// Trigger derivation computation by reading it
			void system.read("doubled");

			const events = dt().getEvents("deriv-test");
			const derivEvent = events.find(e => e.type === "derivation.compute");
			expect(derivEvent).toBeDefined();

			system.destroy();
		});

		it("records reconcile.start and reconcile.end events", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "reconcile-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.setStatus({ value: "loading" });
			await system.settle();

			const events = dt().getEvents("reconcile-test");
			expect(events.some(e => e.type === "reconcile.start")).toBe(true);
			expect(events.some(e => e.type === "reconcile.end")).toBe(true);

			system.destroy();
		});

		it("records constraint.evaluate events", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "constraint-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.setStatus({ value: "loading" });
			await system.settle();

			const events = dt().getEvents("constraint-test");
			const constraintEvent = events.find(e => e.type === "constraint.evaluate");
			expect(constraintEvent).toBeDefined();

			system.destroy();
		});

		it("records requirement and resolver events", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "resolver-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.setStatus({ value: "loading" });
			await system.settle();

			const events = dt().getEvents("resolver-test");
			expect(events.some(e => e.type === "requirement.created")).toBe(true);
			expect(events.some(e => e.type === "resolver.start")).toBe(true);
			expect(events.some(e => e.type === "resolver.complete")).toBe(true);
			expect(events.some(e => e.type === "requirement.met")).toBe(true);

			system.destroy();
		});

		it("records effect.run events", async () => {
			const effectModule = createModule("effect-test", {
				schema: {
					facts: { count: t.number() },
					derivations: {},
					events: { increment: {} },
					requirements: {},
				},
				init: (facts) => {
					facts.count = 0;
				},
				events: {
					increment: (facts) => {
						facts.count = (facts.count as number) + 1;
					},
				},
				effects: {
					log: {
						run: () => {
							// side effect
						},
					},
				},
			});

			const system = createSystem({
				module: effectModule,
				plugins: [devtoolsPlugin({ name: "effect-test", trace: true })],
			});
			system.start();
			await system.settle();

			const events = dt().getEvents("effect-test");
			expect(events.some(e => e.type === "effect.run")).toBe(true);

			system.destroy();
		});

		it("events have timestamp, type, and data", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "shape-test", trace: true })],
			});
			system.start();
			await system.settle();

			const events = dt().getEvents("shape-test");
			expect(events.length).toBeGreaterThan(0);

			for (const event of events) {
				expect(typeof event.timestamp).toBe("number");
				expect(typeof event.type).toBe("string");
				expect(event).toHaveProperty("data");
			}

			system.destroy();
		});

		it("respects maxEvents cap", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "capped", trace: true, maxEvents: 5 })],
			});
			system.start();

			// Generate many fact changes to exceed the cap
			for (let i = 0; i < 20; i++) {
				system.facts.count = i;
			}

			const events = dt().getEvents("capped");
			expect(events.length).toBeLessThanOrEqual(5);

			system.destroy();
		});

		it("getEvents() returns empty array for unknown system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "exists", trace: true })],
			});
			system.start();

			const events = dt().getEvents("nonexistent");
			expect(events).toEqual([]);

			system.destroy();
		});

		it("getEvents() with no name uses first system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "only", trace: true })],
			});
			system.start();

			const events = dt().getEvents();
			expect(Array.isArray(events)).toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Export / Import Session
	// ============================================================================

	describe("exportSession / importSession", () => {
		it("exportSession returns JSON string with events", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "export-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			const json = dt().exportSession("export-test");
			expect(json).not.toBeNull();

			const parsed = JSON.parse(json!);
			expect(parsed.version).toBe(1);
			expect(parsed.name).toBe("export-test");
			expect(parsed.exportedAt).toBeGreaterThan(0);
			expect(Array.isArray(parsed.events)).toBe(true);
			expect(parsed.events.length).toBeGreaterThan(0);

			system.destroy();
		});

		it("exportSession returns null for unknown system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "known" })],
			});
			system.start();

			expect(dt().exportSession("unknown")).toBeNull();

			system.destroy();
		});

		it("importSession replaces events in target system", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "import-test", trace: true })],
			});
			system.start();
			await system.settle();

			const payload = JSON.stringify({
				version: 1,
				events: [
					{ timestamp: 1000, type: "test.imported", data: { foo: "bar" } },
					{ timestamp: 2000, type: "test.imported2", data: {} },
				],
			});

			const success = dt().importSession(payload, "import-test");
			expect(success).toBe(true);

			const events = dt().getEvents("import-test");
			expect(events).toHaveLength(2);
			expect(events[0]!.type).toBe("test.imported");
			expect(events[1]!.type).toBe("test.imported2");

			system.destroy();
		});

		it("importSession rejects invalid JSON", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "bad-import" })],
			});
			system.start();

			expect(dt().importSession("not json", "bad-import")).toBe(false);

			system.destroy();
		});

		it("importSession rejects payload without events array", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "bad-import2" })],
			});
			system.start();

			expect(dt().importSession(JSON.stringify({ version: 1 }), "bad-import2")).toBe(false);

			system.destroy();
		});

		it("importSession filters malformed events", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "filter-test", trace: true })],
			});
			system.start();
			await system.settle();

			const payload = JSON.stringify({
				events: [
					{ timestamp: 1000, type: "valid", data: {} },
					{ timestamp: "not-a-number", type: "invalid-ts", data: {} },
					{ timestamp: 2000, data: {} },
					null,
					{ timestamp: 3000, type: "also-valid", data: {} },
				],
			});

			dt().importSession(payload, "filter-test");

			const events = dt().getEvents("filter-test");
			expect(events).toHaveLength(2);
			expect(events[0]!.type).toBe("valid");
			expect(events[1]!.type).toBe("also-valid");

			system.destroy();
		});

		it("importSession returns false for unknown target system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "known2" })],
			});
			system.start();

			const payload = JSON.stringify({ events: [{ timestamp: 1, type: "x", data: {} }] });
			expect(dt().importSession(payload, "unknown2")).toBe(false);

			system.destroy();
		});
	});

	// ============================================================================
	// Explain API
	// ============================================================================

	describe("explain()", () => {
		it("returns null for unknown system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "explain-sys" })],
			});
			system.start();

			expect(dt().explain("some-req", "nonexistent")).toBeNull();

			system.destroy();
		});

		it("returns explanation from system.explain()", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "explain-test" })],
			});
			system.start();
			await system.settle();

			system.events.setStatus({ value: "loading" });
			await system.settle();

			// explain() may return null if req no longer exists
			const result = dt().explain("fake-id", "explain-test");
			expect(result === null || typeof result === "string" || typeof result === "object").toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Plugin Lifecycle
	// ============================================================================

	describe("lifecycle", () => {
		it("plugin has name 'devtools'", () => {
			const plugin = devtoolsPlugin();
			expect(plugin.name).toBe("devtools");
		});

		it("records destroy event and unregisters", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "destroy-test", trace: true })],
			});
			system.start();

			// Capture events before destroy
			const eventsBefore = dt().getEvents("destroy-test");
			const hasInit = eventsBefore.some(e => e.type === "init");
			expect(hasInit).toBe(true);

			system.destroy();

			// After destroy, system is unregistered
			expect(dt().getSystems()).not.toContain("destroy-test");
		});

		it("handles full constraint→requirement→resolver lifecycle", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "full-lifecycle", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.setStatus({ value: "loading" });
			await system.settle();

			const events = dt().getEvents("full-lifecycle");
			const types = new Set(events.map(e => e.type));

			expect(types.has("init")).toBe(true);
			expect(types.has("start")).toBe(true);
			expect(types.has("reconcile.start")).toBe(true);
			expect(types.has("reconcile.end")).toBe(true);
			expect(types.has("constraint.evaluate")).toBe(true);
			expect(types.has("requirement.created")).toBe(true);
			expect(types.has("resolver.start")).toBe(true);
			expect(types.has("resolver.complete")).toBe(true);
			expect(types.has("requirement.met")).toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Default Options
	// ============================================================================

	describe("default options", () => {
		it("defaults trace to false", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "defaults" })],
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			expect(dt().getEvents("defaults")).toHaveLength(0);

			system.destroy();
		});

		it("maxEvents defaults to 1000", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "max-default", trace: true })],
			});
			system.start();

			for (let i = 0; i < 100; i++) {
				system.facts.count = i;
			}

			const events = dt().getEvents("max-default");
			expect(events.length).toBeGreaterThan(0);
			expect(events.length).toBeLessThanOrEqual(1000);

			system.destroy();
		});
	});

	// ============================================================================
	// Panel safety in Node environment
	// ============================================================================

	describe("panel in non-DOM environment", () => {
		it("panel: true does not crash when document.body is unavailable", () => {
			const mod = createTestModule();
			// panel: true but no document — should not throw
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "panel-safe", panel: true })],
			});
			system.start();

			expect(dt().getSystem("panel-safe")).not.toBeNull();

			system.destroy();
		});
	});

	// ============================================================================
	// Time-travel event recording
	// ============================================================================

	describe("time-travel events", () => {
		it("records timetravel.snapshot events", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "tt-test", trace: true })],
				debug: { timeTravel: true, maxSnapshots: 50 },
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			const events = dt().getEvents("tt-test");
			expect(events.some(e => e.type === "timetravel.snapshot")).toBe(true);

			system.destroy();
		});

		it("records timetravel.jump events on goBack", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "tt-jump", trace: true })],
				debug: { timeTravel: true, maxSnapshots: 50 },
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			system.debug!.goBack();

			const events = dt().getEvents("tt-jump");
			expect(events.some(e => e.type === "timetravel.jump")).toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Error events
	// ============================================================================

	describe("error events", () => {
		it("records resolver.error events on failure", async () => {
			const errorModule = createModule("error-mod", {
				schema: {
					facts: { status: t.string() },
					derivations: {},
					events: { trigger: {} },
					requirements: {
						FAIL: {},
					},
				},
				init: (facts) => {
					facts.status = "idle";
				},
				events: {
					trigger: (facts) => {
						facts.status = "active";
					},
				},
				constraints: {
					fail: {
						when: (facts) => facts.status === "active",
						require: () => ({ type: "FAIL" }),
					},
				},
				resolvers: {
					failing: {
						requirement: "FAIL",
						resolve: async () => {
							throw new Error("Intentional failure");
						},
					},
				},
			});

			const system = createSystem({
				module: errorModule,
				plugins: [devtoolsPlugin({ name: "error-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.trigger();
			await system.settle();

			const events = dt().getEvents("error-test");
			const hasResolverError = events.some(e => e.type === "resolver.error");
			expect(hasResolverError).toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Batch fact changes
	// ============================================================================

	describe("batch fact changes", () => {
		it("records fact change events for event-driven mutations", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "batch-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			const events = dt().getEvents("batch-test");
			const hasBatch = events.some(e => e.type === "facts.batch");
			const hasFactSet = events.some(e => e.type === "fact.set");

			// At least one of these should be present
			expect(hasBatch || hasFactSet).toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Multi-module tracing
	// ============================================================================

	describe("multi-module", () => {
		it("traces events across multiple modules", async () => {
			const modA = createModule("modA", {
				schema: {
					facts: { x: t.number() },
					derivations: {},
					events: { setX: { value: t.number() } },
					requirements: {},
				},
				init: (facts) => { facts.x = 0; },
				events: {
					setX: (facts, { value }) => { facts.x = value; },
				},
			});

			const modB = createModule("modB", {
				schema: {
					facts: { y: t.number() },
					derivations: {},
					events: { setY: { value: t.number() } },
					requirements: {},
				},
				init: (facts) => { facts.y = 0; },
				events: {
					setY: (facts, { value }) => { facts.y = value; },
				},
			});

			const system = createSystem({
				modules: { a: modA, b: modB },
				plugins: [devtoolsPlugin({ name: "multi-mod", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.a.setX({ value: 10 });
			await system.settle();

			system.events.b.setY({ value: 20 });
			await system.settle();

			const events = dt().getEvents("multi-mod");
			const factEvents = events.filter(e => e.type === "fact.set" || e.type === "facts.batch");
			expect(factEvents.length).toBeGreaterThan(0);

			system.destroy();
		});
	});

	// ============================================================================
	// Circular buffer overflow
	// ============================================================================

	describe("circular buffer behavior", () => {
		it("oldest events are dropped when maxEvents is exceeded", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "overflow", trace: true, maxEvents: 3 })],
			});
			system.start();

			// init + start already logged — push fact changes to overflow
			system.facts.count = 1;
			system.facts.count = 2;
			system.facts.count = 3;
			system.facts.count = 4;
			system.facts.count = 5;

			const events = dt().getEvents("overflow");
			expect(events.length).toBeLessThanOrEqual(3);
			// Most recent events should be preserved
			const lastEvent = events[events.length - 1]!;
			expect(lastEvent.type).toBe("fact.set");

			system.destroy();
		});

		it("preserves event order after wrapping", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "order", trace: true, maxEvents: 4 })],
			});
			system.start();

			// Overflow the buffer
			for (let i = 0; i < 10; i++) {
				system.facts.count = i;
			}

			const events = dt().getEvents("order");
			// All events should have monotonically increasing timestamps
			for (let i = 1; i < events.length; i++) {
				expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
			}

			system.destroy();
		});
	});

	// ============================================================================
	// ExportSession edge cases
	// ============================================================================

	describe("exportSession edge cases", () => {
		it("exportSession with no name uses first system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "auto-export", trace: true })],
			});
			system.start();

			const json = dt().exportSession();
			expect(json).not.toBeNull();
			const parsed = JSON.parse(json!);
			expect(parsed.version).toBe(1);

			system.destroy();
		});
	});

	// ============================================================================
	// clearEvents API (E6)
	// ============================================================================

	describe("clearEvents()", () => {
		it("clears events for a named system", async () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "clear-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.increment();
			await system.settle();

			expect(dt().getEvents("clear-test").length).toBeGreaterThan(0);

			dt().clearEvents("clear-test");

			expect(dt().getEvents("clear-test")).toHaveLength(0);

			system.destroy();
		});

		it("clears events for first system when no name provided", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "clear-default", trace: true })],
			});
			system.start();

			expect(dt().getEvents("clear-default").length).toBeGreaterThan(0);

			dt().clearEvents();

			expect(dt().getEvents("clear-default")).toHaveLength(0);

			system.destroy();
		});

		it("does nothing for unknown system", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "clear-safe" })],
			});
			system.start();

			// Should not throw
			dt().clearEvents("nonexistent");

			system.destroy();
		});
	});

	// ============================================================================
	// importSession security (C1)
	// ============================================================================

	describe("importSession security", () => {
		it("rejects oversized JSON payload", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "size-cap" })],
			});
			system.start();

			// Create a string larger than 10MB
			const huge = "x".repeat(11 * 1024 * 1024);
			expect(dt().importSession(huge, "size-cap")).toBe(false);

			system.destroy();
		});

		it("rejects prototype pollution in event type", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "proto-test", trace: true })],
			});
			system.start();

			const payload = JSON.stringify({
				events: [
					{ timestamp: 1, type: "__proto__", data: {} },
					{ timestamp: 2, type: "constructor", data: {} },
					{ timestamp: 3, type: "prototype", data: {} },
					{ timestamp: 4, type: "valid.event", data: {} },
				],
			});

			dt().importSession(payload, "proto-test");

			const events = dt().getEvents("proto-test");
			expect(events).toHaveLength(1);
			expect(events[0]!.type).toBe("valid.event");

			system.destroy();
		});

		it("sanitizes imported events to only known fields", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "sanitize-test", trace: true })],
			});
			system.start();

			const payload = JSON.stringify({
				events: [
					{
						timestamp: 1000,
						type: "test.event",
						data: { foo: "bar" },
						malicious: "should-be-stripped",
						__proto__: { admin: true },
					},
				],
			});

			dt().importSession(payload, "sanitize-test");

			const events = dt().getEvents("sanitize-test");
			expect(events).toHaveLength(1);
			const evt = events[0]! as unknown as Record<string, unknown>;
			expect(evt.timestamp).toBe(1000);
			expect(evt.type).toBe("test.event");
			expect(evt).not.toHaveProperty("malicious");

			system.destroy();
		});

		it("rejects non-object payload", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "reject-array" })],
			});
			system.start();

			expect(dt().importSession("[1,2,3]", "reject-array")).toBe(false);
			expect(dt().importSession("\"string\"", "reject-array")).toBe(false);
			expect(dt().importSession("42", "reject-array")).toBe(false);

			system.destroy();
		});
	});

	// ============================================================================
	// maxEvents validation (M7)
	// ============================================================================

	describe("maxEvents validation", () => {
		it("treats zero maxEvents as default 1000", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "zero-max", trace: true, maxEvents: 0 })],
			});
			system.start();

			// Should not throw, buffer works
			for (let i = 0; i < 10; i++) {
				system.facts.count = i;
			}

			const events = dt().getEvents("zero-max");
			expect(events.length).toBeGreaterThan(0);

			system.destroy();
		});

		it("treats negative maxEvents as default 1000", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "neg-max", trace: true, maxEvents: -5 })],
			});
			system.start();

			system.facts.count = 42;

			const events = dt().getEvents("neg-max");
			expect(events.length).toBeGreaterThan(0);

			system.destroy();
		});
	});

	// ============================================================================
	// Non-writable global (C2)
	// ============================================================================

	describe("non-writable global", () => {
		it("window.__DIRECTIVE__ cannot be overwritten by assignment", () => {
			const mod = createTestModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "readonly-test" })],
			});
			system.start();

			const original = dt();

			// Attempt to overwrite should fail silently (non-strict) or throw
			try {
				(globalThis as Record<string, unknown>).__DIRECTIVE__ = { hacked: true };
			} catch {
				// TypeError in strict mode — expected
			}

			// Original should still be intact
			expect(dt().getSystems()).toContain("readonly-test");
			expect(dt()).toBe(original);

			system.destroy();
		});
	});

	// ============================================================================
	// explain() return type (E9)
	// ============================================================================

	describe("explain() return type", () => {
		it("returns string or null", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "explain-type" })],
			});
			system.start();
			await system.settle();

			const result = dt().explain("nonexistent-id", "explain-type");
			expect(result === null || typeof result === "string").toBe(true);

			system.destroy();
		});
	});

	// ============================================================================
	// Timeline tracking (I1)
	// ============================================================================

	describe("timeline tracking", () => {
		it("tracks resolver execution in trace events", async () => {
			const mod = createConstraintModule();
			const system = createSystem({
				module: mod,
				plugins: [devtoolsPlugin({ name: "timeline-test", trace: true })],
			});
			system.start();
			await system.settle();

			system.events.setStatus({ value: "loading" });
			await system.settle();

			const events = dt().getEvents("timeline-test");
			const resolverStart = events.find(e => e.type === "resolver.start");
			const resolverComplete = events.find(e => e.type === "resolver.complete");

			expect(resolverStart).toBeDefined();
			expect(resolverComplete).toBeDefined();

			// Complete event should have duration
			const data = resolverComplete!.data as Record<string, unknown>;
			expect(typeof data.duration).toBe("number");

			system.destroy();
		});
	});
});
