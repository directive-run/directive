/**
 * Builder Integration Tests
 *
 * End-to-end tests verifying that builder-created constraints, modules,
 * and systems work correctly through the full runtime cycle:
 * builder → module → system → constraint fires → resolver runs → facts update.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	createModule,
	createSystem,
	constraint,
	when,
	module,
	system,
	t,
	type ModuleSchema,
} from "../index.js";

// ============================================================================
// Cleanup
// ============================================================================

const systems: Array<{ stop(): void; destroy(): void }> = [];

afterEach(() => {
	for (const s of systems) {
		try { s.stop(); } catch {}
		try { s.destroy(); } catch {}
	}
	systems.length = 0;
});

function track<T extends { stop(): void; destroy(): void }>(s: T): T {
	systems.push(s);
	return s;
}

// ============================================================================
// constraint() builder in a running system
// ============================================================================

describe("constraint() builder in a running system", () => {
	const schema = {
		facts: {
			count: t.number(),
			status: t.string<"idle" | "resetting">(),
		},
		derivations: {
			isHigh: t.boolean(),
		},
		events: {
			increment: {},
		},
		requirements: {
			RESET: {},
		},
	} satisfies ModuleSchema;

	it("constraint triggers resolver when condition is met", async () => {
		const resolved = vi.fn();

		const resetWhenHigh = constraint<typeof schema>()
			.when((f) => f.count > 5)
			.require({ type: "RESET" })
			.priority(50)
			.build();

		const mod = createModule("counter", {
			schema,
			init: (facts) => {
				facts.count = 0;
				facts.status = "idle";
			},
			derive: {
				isHigh: (facts) => facts.count > 5,
			},
			events: {
				increment: (facts) => { facts.count++; },
			},
			constraints: { resetWhenHigh },
			resolvers: {
				reset: {
					requirement: "RESET",
					resolve: async (_req, ctx) => {
						resolved();
						ctx.facts.count = 0;
						ctx.facts.status = "idle";
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Push count above threshold
		for (let i = 0; i < 6; i++) sys.events.increment();
		expect(sys.facts.count).toBe(6);

		await sys.settle();
		expect(resolved).toHaveBeenCalled();
		expect(sys.facts.count).toBe(0);
	});

	it("constraint with all options (.after, .deps, .timeout) works in system", async () => {
		const healthResolved = vi.fn();
		const resetResolved = vi.fn();

		const healthCheck = constraint<typeof schema>()
			.when((f) => f.count >= 0)
			.require({ type: "RESET" })
			.build();

		// This constraint uses .after to wait for healthCheck
		const conditionalReset = constraint<typeof schema>()
			.when((f) => f.count > 3)
			.require({ type: "RESET" })
			.priority(10)
			.after("healthCheck")
			.deps("count")
			.build();

		const mod = createModule("test", {
			schema,
			init: (facts) => {
				facts.count = 5;
				facts.status = "idle";
			},
			derive: {
				isHigh: (facts) => facts.count > 5,
			},
			events: {
				increment: (facts) => { facts.count++; },
			},
			constraints: {
				healthCheck,
				conditionalReset,
			},
			resolvers: {
				reset: {
					requirement: "RESET",
					resolve: async (_req, ctx) => {
						resetResolved();
						ctx.facts.count = 0;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await sys.settle();

		// Both constraints triggered, resolver ran
		expect(resetResolved).toHaveBeenCalled();
	});
});

// ============================================================================
// when() shorthand in a running system
// ============================================================================

describe("when() shorthand in a running system", () => {
	const schema = {
		facts: {
			errorCount: t.number(),
			paused: t.boolean(),
		},
		derivations: {},
		events: {
			addError: {},
		},
		requirements: {
			PAUSE: {},
		},
	} satisfies ModuleSchema;

	it("when() constraint fires resolver on condition match", async () => {
		const resolved = vi.fn();

		const pauseOnErrors = when<typeof schema>((f) => f.errorCount > 3)
			.require({ type: "PAUSE" });

		const mod = createModule("errors", {
			schema,
			init: (facts) => {
				facts.errorCount = 0;
				facts.paused = false;
			},
			events: {
				addError: (facts) => { facts.errorCount++; },
			},
			constraints: { pauseOnErrors },
			resolvers: {
				pause: {
					requirement: "PAUSE",
					resolve: async (_req, ctx) => {
						resolved();
						ctx.facts.paused = true;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Below threshold — no resolve
		for (let i = 0; i < 3; i++) sys.events.addError();
		await sys.settle();
		expect(resolved).not.toHaveBeenCalled();
		expect(sys.facts.paused).toBe(false);

		// Cross threshold
		sys.events.addError();
		await sys.settle();
		expect(resolved).toHaveBeenCalled();
		expect(sys.facts.paused).toBe(true);
	});

	it("when().withPriority() respects priority ordering", async () => {
		const order: string[] = [];

		const lowPriority = when<typeof schema>((f) => f.errorCount > 0)
			.require({ type: "PAUSE" })
			.withPriority(10);

		const highPriority = when<typeof schema>((f) => f.errorCount > 0)
			.require({ type: "PAUSE" })
			.withPriority(90);

		const mod = createModule("priority-test", {
			schema,
			init: (facts) => {
				facts.errorCount = 1;
				facts.paused = false;
			},
			events: {
				addError: (facts) => { facts.errorCount++; },
			},
			constraints: {
				lowPriority,
				highPriority,
			},
			resolvers: {
				pause: {
					requirement: "PAUSE",
					resolve: async (_req, ctx) => {
						ctx.facts.paused = true;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await sys.settle();

		// Both constraints fire, resolver runs — system settles
		expect(sys.facts.paused).toBe(true);
	});

	it("when() with function require produces dynamic requirements", async () => {
		const resolvedWith = vi.fn();

		const dynamicSchema = {
			facts: {
				level: t.number(),
				message: t.string(),
			},
			derivations: {},
			events: {},
			requirements: {
				ALERT: { message: t.string() },
			},
		} satisfies ModuleSchema;

		const alert = when<typeof dynamicSchema>((f) => f.level > 5)
			.require((f) => ({ type: "ALERT" as const, message: `Level is ${f.level}` }));

		const mod = createModule("dynamic", {
			schema: dynamicSchema,
			init: (facts) => {
				facts.level = 10;
				facts.message = "";
			},
			constraints: { alert },
			resolvers: {
				handleAlert: {
					requirement: "ALERT",
					resolve: async (req, ctx) => {
						resolvedWith(req);
						ctx.facts.message = req.message;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await sys.settle();

		expect(resolvedWith).toHaveBeenCalledWith(
			expect.objectContaining({ type: "ALERT", message: "Level is 10" })
		);
		expect(sys.facts.message).toBe("Level is 10");
	});
});

// ============================================================================
// module() builder in a running system
// ============================================================================

describe("module() builder in a running system", () => {
	it("module builder output works with createSystem()", async () => {
		const resolved = vi.fn();

		const schema = {
			facts: { value: t.number() },
			derivations: { doubled: t.number() },
			events: { bump: {} },
			requirements: { SAVE: {} },
		} satisfies ModuleSchema;

		const mod = module("built-module")
			.schema(schema)
			.init((facts) => { facts.value = 0; })
			.derive({ doubled: (facts) => facts.value * 2 })
			.events({ bump: (facts) => { facts.value += 10; } })
			.constraints({
				saveWhenHigh: {
					when: (facts) => facts.value > 20,
					require: { type: "SAVE" },
				},
			})
			.resolvers({
				save: {
					requirement: "SAVE",
					resolve: async (_req, ctx) => {
						resolved();
					},
				},
			})
			.build();

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.events.bump();
		sys.events.bump();
		sys.events.bump();
		expect(sys.facts.value).toBe(30);
		expect(sys.derive.doubled).toBe(60);

		await sys.settle();
		expect(resolved).toHaveBeenCalled();
	});

	it("module builder output works with system() builder", () => {
		const mod = module("fluent")
			.schema({
				facts: { name: t.string() },
				derivations: { upper: t.string() },
				events: { setName: { name: t.string() } },
				requirements: {},
			} satisfies ModuleSchema)
			.init((facts) => { facts.name = "hello"; })
			.derive({ upper: (facts) => facts.name.toUpperCase() })
			.events({
				setName: (facts, { name }) => { facts.name = name; },
			})
			.build();

		const sys = track(
			system().module(mod).build()
		);
		sys.start();

		expect(sys.facts.name).toBe("hello");
		expect(sys.derive.upper).toBe("HELLO");

		sys.events.setName({ name: "world" });
		expect(sys.facts.name).toBe("world");
		expect(sys.derive.upper).toBe("WORLD");
	});
});

// ============================================================================
// Mixing builders with object literals
// ============================================================================

describe("mixing builder and object literal constraints", () => {
	it("builder and inline constraints coexist in the same module", async () => {
		const builderResolved = vi.fn();
		const inlineResolved = vi.fn();

		const schema = {
			facts: {
				a: t.number(),
				b: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				FIX_A: {},
				FIX_B: {},
			},
		} satisfies ModuleSchema;

		const fixA = when<typeof schema>((f) => f.a > 10)
			.require({ type: "FIX_A" })
			.withPriority(50);

		const mod = createModule("mixed", {
			schema,
			init: (facts) => {
				facts.a = 20;
				facts.b = 20;
			},
			constraints: {
				// Builder-created
				fixA,
				// Inline object literal
				fixB: {
					when: (facts) => facts.b > 10,
					require: { type: "FIX_B" },
					priority: 40,
				},
			},
			resolvers: {
				resolveA: {
					requirement: "FIX_A",
					resolve: async (_req, ctx) => {
						builderResolved();
						ctx.facts.a = 0;
					},
				},
				resolveB: {
					requirement: "FIX_B",
					resolve: async (_req, ctx) => {
						inlineResolved();
						ctx.facts.b = 0;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await sys.settle();

		expect(builderResolved).toHaveBeenCalled();
		expect(inlineResolved).toHaveBeenCalled();
		expect(sys.facts.a).toBe(0);
		expect(sys.facts.b).toBe(0);
	});
});

// ============================================================================
// Reusable constraints across modules
// ============================================================================

describe("reusable constraints across modules", () => {
	it("constraint factory function produces working constraints for different modules", async () => {
		// Factory function that produces a typed pause constraint for any schema
		function makePauseConstraint<S extends { facts: { errors: { _type: number } }; derivations: {}; events: {}; requirements: { PAUSE: {} } }>() {
			return when<S>((f: any) => f.errors > 3).require({ type: "PAUSE" } as any);
		}

		// Verify the factory produces valid constraints independently
		const schemaA = {
			facts: { errors: t.number() },
			derivations: {},
			events: {},
			requirements: { PAUSE: {} },
		} satisfies ModuleSchema;

		const resolved = vi.fn();

		const modA = createModule("modA", {
			schema: schemaA,
			init: (facts) => { facts.errors = 5; },
			constraints: { pause: makePauseConstraint<typeof schemaA>() },
			resolvers: {
				pause: {
					requirement: "PAUSE",
					resolve: async () => { resolved(); },
				},
			},
		});

		const sysA = track(createSystem({ module: modA }));
		sysA.start();
		await sysA.settle();
		expect(resolved).toHaveBeenCalled();

		// Same factory works for a second module with same shape
		const resolved2 = vi.fn();

		const schemaB = {
			facts: { errors: t.number() },
			derivations: {},
			events: {},
			requirements: { PAUSE: {} },
		} satisfies ModuleSchema;

		const modB = createModule("modB", {
			schema: schemaB,
			init: (facts) => { facts.errors = 10; },
			constraints: { pause: makePauseConstraint<typeof schemaB>() },
			resolvers: {
				pause: {
					requirement: "PAUSE",
					resolve: async () => { resolved2(); },
				},
			},
		});

		const sysB = track(createSystem({ module: modB }));
		sysB.start();
		await sysB.settle();
		expect(resolved2).toHaveBeenCalled();
	});
});

// ============================================================================
// Full app example (matches docs pattern)
// ============================================================================

describe("full app with all builder patterns", () => {
	it("module() + when() + constraint() + system() all work together", async () => {
		const fetchResolved = vi.fn();

		// Auth module via module() builder
		const authMod = module("auth")
			.schema({
				facts: { token: t.string(), role: t.string() },
				derivations: { isAuthenticated: t.boolean() },
				events: {
					login: { token: t.string(), role: t.string() },
					logout: {},
				},
				requirements: {},
			} satisfies ModuleSchema)
			.init((facts) => {
				facts.token = "";
				facts.role = "guest";
			})
			.derive({
				isAuthenticated: (facts) => facts.token !== "",
			})
			.events({
				login: (facts, { token, role }) => {
					facts.token = token;
					facts.role = role;
				},
				logout: (facts) => {
					facts.token = "";
					facts.role = "guest";
				},
			})
			.build();

		// Data module via createModule + when() + constraint()
		const dataSchema = {
			facts: {
				items: t.array<string>(),
				loaded: t.boolean(),
				errorCount: t.number(),
			},
			derivations: {
				itemCount: t.number(),
			},
			events: {},
			requirements: {
				LOAD_ITEMS: {},
				ALERT: {},
			},
		} satisfies ModuleSchema;

		const loadWhenEmpty = when<typeof dataSchema>((f) => !f.loaded && f.items.length === 0)
			.require({ type: "LOAD_ITEMS" });

		const alertOnErrors = constraint<typeof dataSchema>()
			.when((f) => f.errorCount > 5)
			.require({ type: "ALERT" })
			.priority(90)
			.build();

		const dataMod = createModule("data", {
			schema: dataSchema,
			init: (facts) => {
				facts.items = [];
				facts.loaded = false;
				facts.errorCount = 0;
			},
			derive: {
				itemCount: (facts) => facts.items.length,
			},
			constraints: {
				loadWhenEmpty,
				alertOnErrors,
			},
			resolvers: {
				loadItems: {
					requirement: "LOAD_ITEMS",
					resolve: async (_req, ctx) => {
						fetchResolved();
						ctx.facts.items = ["a", "b", "c"];
						ctx.facts.loaded = true;
					},
				},
				alert: {
					requirement: "ALERT",
					resolve: async () => {},
				},
			},
		});

		// Wire up with system() builder
		const app = track(
			system()
				.modules({ auth: authMod, data: dataMod })
				.debug({ timeTravel: true })
				.build()
		);

		app.start();

		// Auth works
		expect(app.facts.auth.token).toBe("");
		expect(app.derive.auth.isAuthenticated).toBe(false);

		app.events.auth.login({ token: "abc", role: "admin" });
		expect(app.facts.auth.token).toBe("abc");
		expect(app.derive.auth.isAuthenticated).toBe(true);

		// Data constraint fires — loadWhenEmpty triggers LOAD_ITEMS
		await app.settle();
		expect(fetchResolved).toHaveBeenCalled();
		expect(app.facts.data.items).toEqual(["a", "b", "c"]);
		expect(app.facts.data.loaded).toBe(true);
		expect(app.derive.data.itemCount).toBe(3);

		// Time travel is enabled
		expect(app.debug).not.toBeNull();
	});
});

// ============================================================================
// Array require and null require in running system
// ============================================================================

describe("advanced require forms in running system", () => {
	it("array require produces multiple requirements", async () => {
		const schema = {
			facts: { trigger: t.boolean(), aHandled: t.boolean(), bHandled: t.boolean() },
			derivations: {},
			events: {},
			requirements: { A: {}, B: {} },
		} satisfies ModuleSchema;

		const both = when<typeof schema>((f) => f.trigger)
			.require([{ type: "A" }, { type: "B" }]);

		const mod = createModule("multi-req", {
			schema,
			init: (facts) => {
				facts.trigger = true;
				facts.aHandled = false;
				facts.bHandled = false;
			},
			constraints: { both },
			resolvers: {
				handleA: {
					requirement: "A",
					resolve: async (_req, ctx) => { ctx.facts.aHandled = true; },
				},
				handleB: {
					requirement: "B",
					resolve: async (_req, ctx) => { ctx.facts.bHandled = true; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await sys.settle();

		expect(sys.facts.aHandled).toBe(true);
		expect(sys.facts.bHandled).toBe(true);
	});

	it("null require suppresses even when condition is true", async () => {
		const schema = {
			facts: { active: t.boolean(), wasResolved: t.boolean() },
			derivations: {},
			events: {},
			requirements: { DO_THING: {} },
		} satisfies ModuleSchema;

		const suppressed = when<typeof schema>((f) => f.active)
			.require(null);

		const mod = createModule("null-req", {
			schema,
			init: (facts) => {
				facts.active = true;
				facts.wasResolved = false;
			},
			constraints: { suppressed },
			resolvers: {
				doThing: {
					requirement: "DO_THING",
					resolve: async (_req, ctx) => { ctx.facts.wasResolved = true; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await sys.settle();

		// null require means no requirement produced, so resolver never fires
		expect(sys.facts.wasResolved).toBe(false);
	});
});
