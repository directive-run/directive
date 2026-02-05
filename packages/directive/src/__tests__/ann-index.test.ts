import { describe, expect, it } from "vitest";
import {
	createBruteForceIndex,
	createVPTreeIndex,
} from "../adapters/guardrails/ann-index.js";
import { cosineSimilarity } from "../adapters/guardrails/semantic-cache.js";

// Helper: create a normalized random vector
function randomVector(dims: number): number[] {
	const vec = Array.from({ length: dims }, () => Math.random() - 0.5);
	const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
	return vec.map((v) => v / norm);
}

describe("Brute Force Index", () => {
	it("should add and search vectors", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0, 0]);
		index.add(1, [0, 1, 0]);
		index.add(2, [0, 0, 1]);

		const results = index.search([1, 0, 0], 1);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(0);
		expect(results[0].similarity).toBeCloseTo(1);
	});

	it("should return top-k results sorted by similarity", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);
		index.add(1, [0.9, 0.1]);
		index.add(2, [0, 1]);

		const results = index.search([1, 0], 2);
		expect(results.length).toBe(2);
		expect(results[0].id).toBe(0); // Most similar
		expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
	});

	it("should respect threshold", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);
		index.add(1, [0, 1]); // Orthogonal, similarity = 0

		const results = index.search([1, 0], 10, 0.5);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(0);
	});

	it("should remove vectors", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);
		index.add(1, [0, 1]);

		index.remove(0);
		expect(index.size()).toBe(1);

		const results = index.search([1, 0], 10);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(1);
	});

	it("should clear the index", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);
		index.add(1, [0, 1]);

		index.clear();
		expect(index.size()).toBe(0);
		expect(index.search([1, 0], 10).length).toBe(0);
	});

	it("should return empty results when searching an empty index", () => {
		const index = createBruteForceIndex();
		const results = index.search([1, 0, 0], 5);
		expect(results.length).toBe(0);
	});

	it("should return empty results when k=0", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);
		index.add(1, [0, 1]);

		const results = index.search([1, 0], 0);
		expect(results.length).toBe(0);
	});

	it("should throw on dimension mismatch", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);

		expect(() => index.add(1, [1, 0, 0])).toThrowError(
			/Dimension mismatch: expected 2, got 3/,
		);
	});

	it("should throw on query dimension mismatch in search", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);

		expect(() => index.search([1, 0, 0], 1)).toThrowError(
			/Query dimension mismatch: expected 2, got 3/,
		);
	});

	it("should overwrite duplicate IDs with the latest vector", () => {
		const index = createBruteForceIndex();
		index.add(0, [1, 0]);
		index.add(0, [0, 1]); // Same ID, different vector

		expect(index.size()).toBe(1);

		const results = index.search([0, 1], 1);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(0);
		expect(results[0].similarity).toBeCloseTo(1);
	});
});

describe("VP-Tree Index", () => {
	it("should add and search vectors after rebuild", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0, 0]);
		index.add(1, [0, 1, 0]);
		index.add(2, [0, 0, 1]);
		index.rebuild();

		const results = index.search([1, 0, 0], 1, 0.5);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(0);
		expect(results[0].similarity).toBeCloseTo(1);
	});

	it("should fall back to brute force when tree is stale", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0]);
		// Don't rebuild - should fall back to brute force
		const results = index.search([1, 0], 1);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(0);
	});

	it("should handle medium-sized collections", () => {
		const index = createVPTreeIndex();
		const dims = 16;
		const vectors: number[][] = [];

		for (let i = 0; i < 100; i++) {
			const vec = randomVector(dims);
			vectors.push(vec);
			index.add(i, vec);
		}
		index.rebuild();

		// Search for the closest to the first vector
		const results = index.search(vectors[0]!, 5);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].id).toBe(0); // Should find itself
		expect(results[0].similarity).toBeCloseTo(1);
	});

	it("should return results above threshold", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0, 0]);
		index.add(1, [0.99, 0.1, 0]); // Very similar to [1,0,0]
		index.add(2, [0, 0, 1]); // Orthogonal
		index.rebuild();

		const results = index.search([1, 0, 0], 10, 0.9);
		// Only the very similar vectors should appear
		for (const r of results) {
			expect(r.similarity).toBeGreaterThanOrEqual(0.9);
		}
	});

	it("should clear correctly", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0]);
		index.rebuild();
		index.clear();

		expect(index.size()).toBe(0);
		expect(index.search([1, 0], 10).length).toBe(0);
	});

	it("should track size", () => {
		const index = createVPTreeIndex();
		expect(index.size()).toBe(0);

		index.add(0, [1, 0]);
		index.add(1, [0, 1]);
		expect(index.size()).toBe(2);

		index.remove(0);
		expect(index.size()).toBe(1);
	});

	it("should throw on dimension mismatch", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0]);

		expect(() => index.add(1, [1, 0, 0])).toThrowError(
			/Dimension mismatch: expected 2, got 3/,
		);
	});

	it("should throw on query dimension mismatch in search", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0]);
		index.rebuild();

		expect(() => index.search([1, 0, 0], 1)).toThrowError(
			/Query dimension mismatch: expected 2, got 3/,
		);
	});

	it("should not return removed vectors after rebuild and search", () => {
		const index = createVPTreeIndex();
		index.add(0, [1, 0, 0]);
		index.add(1, [0, 1, 0]);
		index.add(2, [0, 0, 1]);
		index.rebuild();

		index.remove(0);
		index.rebuild();

		const results = index.search([1, 0, 0], 10);
		const ids = results.map((r) => r.id);
		expect(ids).not.toContain(0);
	});

	it("should produce deterministic results with the same random seed", () => {
		function createSeededRandom(seed: number) {
			// Simple LCG pseudo-random generator
			let state = seed;
			return () => {
				state = (state * 1664525 + 1013904223) % 2 ** 32;
				return (state >>> 0) / 2 ** 32;
			};
		}

		const vectors: Array<[number, number[]]> = [
			[0, [1, 0, 0, 0]],
			[1, [0, 1, 0, 0]],
			[2, [0, 0, 1, 0]],
			[3, [0, 0, 0, 1]],
			[4, [0.5, 0.5, 0.5, 0.5]],
		];

		const indexA = createVPTreeIndex({ random: createSeededRandom(42) });
		const indexB = createVPTreeIndex({ random: createSeededRandom(42) });

		for (const [id, vec] of vectors) {
			indexA.add(id, vec);
			indexB.add(id, vec);
		}

		indexA.rebuild();
		indexB.rebuild();

		const query = [0.6, 0.4, 0.1, 0.1];
		const resultsA = indexA.search(query, 3);
		const resultsB = indexB.search(query, 3);

		expect(resultsA.length).toBe(resultsB.length);
		for (let i = 0; i < resultsA.length; i++) {
			expect(resultsA[i].id).toBe(resultsB[i].id);
			expect(resultsA[i].similarity).toBeCloseTo(resultsB[i].similarity);
		}
	});

	it("should allow different dimensions after clear", () => {
		const index = createVPTreeIndex();

		// Add 2D vectors
		index.add(0, [1, 0]);
		index.add(1, [0, 1]);
		index.rebuild();

		// Clear resets dimension validation
		index.clear();

		// Now add 3D vectors - should not throw
		index.add(0, [1, 0, 0]);
		index.add(1, [0, 1, 0]);
		index.rebuild();

		const results = index.search([1, 0, 0], 1);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(0);
		expect(results[0].similarity).toBeCloseTo(1);
	});
});
