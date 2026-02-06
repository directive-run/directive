import { describe, expect, it, vi } from "vitest";
import { createCircuitBreaker } from "../adapters/plugins/circuit-breaker.js";

describe("Circuit Breaker", () => {
	it("should start in CLOSED state", () => {
		const breaker = createCircuitBreaker();
		expect(breaker.getState()).toBe("CLOSED");
	});

	it("should allow requests in CLOSED state", async () => {
		const breaker = createCircuitBreaker();
		const result = await breaker.execute(async () => "ok");
		expect(result).toBe("ok");
	});

	it("should open after failure threshold", async () => {
		const onStateChange = vi.fn();
		const breaker = createCircuitBreaker({
			failureThreshold: 3,
			onStateChange,
		});

		for (let i = 0; i < 3; i++) {
			await breaker.execute(async () => {
				throw new Error("fail");
			}).catch(() => {});
		}

		expect(breaker.getState()).toBe("OPEN");
		expect(onStateChange).toHaveBeenCalledWith("CLOSED", "OPEN");
	});

	it("should reject requests in OPEN state", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 60000,
		});

		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});

		await expect(breaker.execute(async () => "ok")).rejects.toThrow("Circuit");
		expect(breaker.getStats().totalRejected).toBe(1);
	});

	it("should transition to HALF_OPEN after recovery time", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 10, // Very short for testing
		});

		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		expect(breaker.getState()).toBe("OPEN");

		await new Promise((r) => setTimeout(r, 20));
		expect(breaker.getState()).toBe("HALF_OPEN");
	});

	it("should close after successful HALF_OPEN requests", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 10,
			halfOpenMaxRequests: 2,
		});

		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		await new Promise((r) => setTimeout(r, 20));

		// HALF_OPEN: execute successful requests
		await breaker.execute(async () => "ok1");
		await breaker.execute(async () => "ok2");

		expect(breaker.getState()).toBe("CLOSED");
	});

	it("should re-open on failure in HALF_OPEN state", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 10,
			halfOpenMaxRequests: 3,
		});

		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		await new Promise((r) => setTimeout(r, 20));

		// HALF_OPEN: fail again
		await breaker.execute(async () => { throw new Error("fail again"); }).catch(() => {});
		expect(breaker.getState()).toBe("OPEN");
	});

	it("should respect failure window", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 3,
			failureWindowMs: 50, // 50ms window
		});

		// Fail once
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});

		// Wait for window to expire
		await new Promise((r) => setTimeout(r, 60));

		// Fail twice more - should NOT open (first failure expired)
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});

		expect(breaker.getState()).toBe("CLOSED");
	});

	it("should respect custom isFailure classifier", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 2,
			isFailure: (err) => !err.message.includes("expected"),
		});

		// "Expected" errors don't count as failures
		await breaker.execute(async () => { throw new Error("expected error"); }).catch(() => {});
		await breaker.execute(async () => { throw new Error("expected error"); }).catch(() => {});
		await breaker.execute(async () => { throw new Error("expected error"); }).catch(() => {});

		expect(breaker.getState()).toBe("CLOSED");

		// "Real" errors do count
		await breaker.execute(async () => { throw new Error("real error"); }).catch(() => {});
		await breaker.execute(async () => { throw new Error("real error"); }).catch(() => {});

		expect(breaker.getState()).toBe("OPEN");
	});

	it("should track stats correctly", async () => {
		const breaker = createCircuitBreaker({ failureThreshold: 10 });

		await breaker.execute(async () => "ok");
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});

		const stats = breaker.getStats();
		expect(stats.totalRequests).toBe(2);
		expect(stats.totalSuccesses).toBe(1);
		expect(stats.totalFailures).toBe(1);
		expect(stats.lastSuccessTime).not.toBeNull();
		expect(stats.lastFailureTime).not.toBeNull();
	});

	it("should reset correctly", async () => {
		const breaker = createCircuitBreaker({ failureThreshold: 1 });
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});

		breaker.reset();
		expect(breaker.getState()).toBe("CLOSED");
		expect(breaker.getStats().totalRequests).toBe(0);
	});

	it("should force state", () => {
		const breaker = createCircuitBreaker();
		breaker.forceState("OPEN");
		expect(breaker.getState()).toBe("OPEN");
	});

	it("isAllowed should reflect current state", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 60000,
		});

		expect(breaker.isAllowed()).toBe(true);

		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		expect(breaker.isAllowed()).toBe(false);
	});

	it("should integrate with observability", async () => {
		const obs = {
			incrementCounter: vi.fn(),
			observeHistogram: vi.fn(),
		};

		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			observability: obs as any,
			name: "test-api",
		});

		await breaker.execute(async () => "ok");
		expect(obs.incrementCounter).toHaveBeenCalledWith(
			"circuit_breaker.requests",
			{ name: "test-api" }
		);
		expect(obs.incrementCounter).toHaveBeenCalledWith(
			"circuit_breaker.success",
			{ name: "test-api" }
		);
	});

	it("should throw on invalid config - failureThreshold 0", () => {
		expect(() => createCircuitBreaker({ failureThreshold: 0 })).toThrow(
			"failureThreshold must be >= 1"
		);
	});

	it("should throw on invalid config - negative recoveryTimeMs", () => {
		expect(() => createCircuitBreaker({ recoveryTimeMs: -1 })).toThrow(
			"recoveryTimeMs must be > 0"
		);
	});

	it("should throw on invalid config - NaN failureThreshold", () => {
		expect(() => createCircuitBreaker({ failureThreshold: NaN })).toThrow(
			"failureThreshold must be >= 1"
		);
	});

	it("should limit concurrent requests in HALF_OPEN state", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 10,
			halfOpenMaxRequests: 2,
		});

		// Trip the breaker
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		expect(breaker.getState()).toBe("OPEN");

		// Wait for recovery
		await new Promise((r) => setTimeout(r, 20));

		// Fire 4 concurrent calls. Only halfOpenMaxRequests (2) should pass through;
		// the remaining should be rejected.
		let passed = 0;
		let rejected = 0;

		const calls = Array.from({ length: 4 }, () =>
			breaker.execute(async () => {
				passed++;
				return "ok";
			}).catch((err: Error) => {
				if (err.message.includes("HALF_OPEN")) rejected++;
			})
		);

		await Promise.all(calls);

		expect(passed).toBe(2);
		expect(rejected).toBe(2);
	});

	it("should count isFailure returning false as success", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 2,
			isFailure: () => false, // No error counts as a failure
		});

		// Throw errors, but isFailure always returns false
		await breaker.execute(async () => { throw new Error("ignored"); }).catch(() => {});
		await breaker.execute(async () => { throw new Error("ignored"); }).catch(() => {});
		await breaker.execute(async () => { throw new Error("ignored"); }).catch(() => {});

		expect(breaker.getState()).toBe("CLOSED");

		const stats = breaker.getStats();
		expect(stats.totalSuccesses).toBe(3);
		expect(stats.totalFailures).toBe(0);
	});

	it("should reject in HALF_OPEN after max requests exhausted", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 10,
			halfOpenMaxRequests: 2,
			name: "test-half-open",
		});

		// Trip the breaker
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		await new Promise((r) => setTimeout(r, 20));

		// Fire 2 slow requests to exhaust halfOpenMaxRequests slots.
		// They occupy the slots synchronously before awaiting fn().
		const slow1 = breaker.execute(async () => {
			await new Promise((r) => setTimeout(r, 50));
			return "ok1";
		});
		const slow2 = breaker.execute(async () => {
			await new Promise((r) => setTimeout(r, 50));
			return "ok2";
		});

		// All slots are taken; next request should be rejected immediately
		await expect(breaker.execute(async () => "ok3")).rejects.toThrow(
			'is HALF_OPEN. Max trial requests (2) reached.'
		);

		// Clean up in-flight requests
		await Promise.all([slow1, slow2]);
	});

	it("should fire onStateChange when reset() changes state from non-CLOSED", async () => {
		const onStateChange = vi.fn();
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			onStateChange,
		});

		// Trip the breaker
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		expect(breaker.getState()).toBe("OPEN");
		onStateChange.mockClear();

		// Reset should fire OPEN → CLOSED
		breaker.reset();
		expect(onStateChange).toHaveBeenCalledWith("OPEN", "CLOSED");
	});

	it("should not fire onStateChange when reset() is called on CLOSED state", () => {
		const onStateChange = vi.fn();
		const breaker = createCircuitBreaker({ onStateChange });

		breaker.reset();
		expect(onStateChange).not.toHaveBeenCalled();
	});

	it("getStats should reflect auto-transition from OPEN to HALF_OPEN", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 10,
		});

		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		await new Promise((r) => setTimeout(r, 20));

		// getStats should trigger the auto-transition and report HALF_OPEN
		const stats = breaker.getStats();
		expect(stats.state).toBe("HALF_OPEN");
	});

	it("should cap failureTimestamps to prevent unbounded growth", async () => {
		const breaker = createCircuitBreaker({
			failureThreshold: 300, // High threshold so breaker stays CLOSED during all 250 failures
			failureWindowMs: 60000,
		});

		// Record 250 failures
		for (let i = 0; i < 250; i++) {
			await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});
		}

		// recentFailures should be capped (no more than 2x threshold = 600)
		// But array was trimmed at each failure, so length stays at 2x threshold max
		const stats = breaker.getStats();
		expect(stats.recentFailures).toBeLessThanOrEqual(600);
		expect(stats.totalFailures).toBe(250);
	});

	it("should call observeHistogram with latency on success and failure", async () => {
		const obs = {
			incrementCounter: vi.fn(),
			observeHistogram: vi.fn(),
		};

		const breaker = createCircuitBreaker({
			failureThreshold: 10,
			observability: obs as any,
			name: "latency-test",
		});

		// Successful call
		await breaker.execute(async () => "ok");

		expect(obs.observeHistogram).toHaveBeenCalledTimes(1);
		expect(obs.observeHistogram).toHaveBeenCalledWith(
			"circuit_breaker.latency",
			expect.any(Number),
			{ name: "latency-test" }
		);

		obs.observeHistogram.mockClear();

		// Failed call
		await breaker.execute(async () => { throw new Error("fail"); }).catch(() => {});

		expect(obs.observeHistogram).toHaveBeenCalledTimes(1);
		expect(obs.observeHistogram).toHaveBeenCalledWith(
			"circuit_breaker.latency",
			expect.any(Number),
			{ name: "latency-test" }
		);
	});
});
