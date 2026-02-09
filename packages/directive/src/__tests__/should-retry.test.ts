/**
 * shouldRetry Tests
 *
 * Verify that the shouldRetry predicate on RetryPolicy controls
 * whether a failed resolver attempt is retried.
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t } from "../index.js";

describe("shouldRetry", () => {
	it("should stop retrying when shouldRetry returns false", async () => {
		let attempts = 0;

		const schema = {
			facts: {
				trigger: t.boolean(),
				result: t.string(),
			},
			derivations: {},
			events: {},
			requirements: {
				DO_THING: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("should-retry-test", {
			schema,
			init: (facts) => {
				facts.trigger = true;
				facts.result = "";
			},
			derive: {},
			constraints: {
				needsThing: {
					when: (facts) => facts.trigger && !facts.result,
					require: { type: "DO_THING" },
				},
			},
			resolvers: {
				doThing: {
					requirement: "DO_THING",
					retry: {
						attempts: 5,
						backoff: "none",
						initialDelay: 1,
						// Only retry on "transient" errors, not "permanent" ones
						shouldRetry: (error) => error.message === "transient",
					},
					resolve: async (_req, ctx) => {
						attempts++;
						if (attempts <= 2) {
							throw new Error("transient");
						}
						// Third attempt throws a permanent error — should NOT retry
						throw new Error("permanent");
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();
		system.stop();

		// Should have tried 3 times: 2 transient (retried) + 1 permanent (stopped)
		expect(attempts).toBe(3);
	});

	it("should retry all attempts when shouldRetry always returns true", async () => {
		let attempts = 0;

		const schema = {
			facts: {
				trigger: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				ALWAYS_RETRY: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("always-retry-test", {
			schema,
			init: (facts) => {
				facts.trigger = true;
			},
			derive: {},
			constraints: {
				needsRetry: {
					when: (facts) => facts.trigger,
					require: { type: "ALWAYS_RETRY" },
				},
			},
			resolvers: {
				alwaysRetry: {
					requirement: "ALWAYS_RETRY",
					retry: {
						attempts: 4,
						backoff: "none",
						initialDelay: 1,
						shouldRetry: () => true,
					},
					resolve: async (_req, ctx) => {
						attempts++;
						if (attempts < 4) {
							throw new Error("keep going");
						}
						// Succeed on last attempt
						ctx.facts.trigger = false;
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();
		system.stop();

		expect(attempts).toBe(4);
	});

	it("should stop on first failure when shouldRetry always returns false", async () => {
		let attempts = 0;

		const schema = {
			facts: {
				trigger: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				NEVER_RETRY: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("never-retry-test", {
			schema,
			init: (facts) => {
				facts.trigger = true;
			},
			derive: {},
			constraints: {
				needsNeverRetry: {
					when: (facts) => facts.trigger,
					require: { type: "NEVER_RETRY" },
				},
			},
			resolvers: {
				neverRetry: {
					requirement: "NEVER_RETRY",
					retry: {
						attempts: 5,
						backoff: "none",
						initialDelay: 1,
						shouldRetry: () => false,
					},
					resolve: async () => {
						attempts++;
						throw new Error("fail");
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();
		system.stop();

		// Only 1 attempt — shouldRetry returned false immediately
		expect(attempts).toBe(1);
	});

	it("should pass correct error and attempt number to shouldRetry", async () => {
		const shouldRetrySpy = vi.fn().mockReturnValue(true);
		let callCount = 0;

		const schema = {
			facts: {
				trigger: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				SPY_RETRY: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("spy-retry-test", {
			schema,
			init: (facts) => {
				facts.trigger = true;
			},
			derive: {},
			constraints: {
				needsSpyRetry: {
					when: (facts) => facts.trigger,
					require: { type: "SPY_RETRY" },
				},
			},
			resolvers: {
				spyRetry: {
					requirement: "SPY_RETRY",
					retry: {
						attempts: 3,
						backoff: "none",
						initialDelay: 1,
						shouldRetry: shouldRetrySpy,
					},
					resolve: async (_req, ctx) => {
						callCount++;
						if (callCount < 3) {
							throw new Error(`error-${callCount}`);
						}
						ctx.facts.trigger = false;
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();
		system.stop();

		// shouldRetry called twice (after attempt 1 and 2, not after success)
		expect(shouldRetrySpy).toHaveBeenCalledTimes(2);
		expect(shouldRetrySpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: "error-1" }), 1);
		expect(shouldRetrySpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: "error-2" }), 2);
	});

	it("should retry without shouldRetry (default behavior unchanged)", async () => {
		let attempts = 0;

		const schema = {
			facts: {
				trigger: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				DEFAULT_RETRY: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("default-retry-test", {
			schema,
			init: (facts) => {
				facts.trigger = true;
			},
			derive: {},
			constraints: {
				needsDefault: {
					when: (facts) => facts.trigger,
					require: { type: "DEFAULT_RETRY" },
				},
			},
			resolvers: {
				defaultRetry: {
					requirement: "DEFAULT_RETRY",
					retry: {
						attempts: 3,
						backoff: "none",
						initialDelay: 1,
					},
					resolve: async (_req, ctx) => {
						attempts++;
						if (attempts < 3) {
							throw new Error("fail");
						}
						ctx.facts.trigger = false;
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();
		system.stop();

		// All 3 attempts used (default: no shouldRetry, retries all errors)
		expect(attempts).toBe(3);
	});
});
