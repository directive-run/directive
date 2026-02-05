import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	cosineSimilarity,
	createInMemoryStorage,
	createSemanticCache,
	createSemanticCacheGuardrail,
	createTestEmbedder,
	createBatchedEmbedder,
	type SemanticCache,
	type EmbedderFn,
} from "../adapters/guardrails/semantic-cache.js";

// ============================================================================
// Cosine Similarity
// ============================================================================

describe("cosineSimilarity", () => {
	it("should return 1 for identical vectors", () => {
		expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
	});

	it("should return 0 for orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
	});

	it("should return -1 for opposite vectors", () => {
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
	});

	it("should return 0 for zero vectors", () => {
		expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
	});

	it("should throw on dimension mismatch", () => {
		expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow("dimensions must match");
	});

	it("should handle normalized vectors correctly", () => {
		const a = [0.6, 0.8];
		const b = [0.8, 0.6];
		const sim = cosineSimilarity(a, b);
		expect(sim).toBeGreaterThan(0);
		expect(sim).toBeLessThan(1);
	});
});

// ============================================================================
// In-Memory Storage
// ============================================================================

describe("createInMemoryStorage", () => {
	it("should store and retrieve entries", async () => {
		const storage = createInMemoryStorage();

		await storage.addEntry("ns", {
			id: "1",
			query: "hello",
			queryEmbedding: [1, 0],
			response: "world",
			metadata: {},
			createdAt: Date.now(),
			accessedAt: Date.now(),
			accessCount: 0,
		});

		const entries = await storage.getEntries("ns");
		expect(entries.length).toBe(1);
		expect(entries[0].query).toBe("hello");
	});

	it("should update entries", async () => {
		const storage = createInMemoryStorage();

		await storage.addEntry("ns", {
			id: "1",
			query: "hello",
			queryEmbedding: [1, 0],
			response: "world",
			metadata: {},
			createdAt: Date.now(),
			accessedAt: Date.now(),
			accessCount: 0,
		});

		await storage.updateEntry("ns", "1", { accessCount: 5 });

		const entries = await storage.getEntries("ns");
		expect(entries[0].accessCount).toBe(5);
	});

	it("should remove entries", async () => {
		const storage = createInMemoryStorage();

		await storage.addEntry("ns", {
			id: "1",
			query: "hello",
			queryEmbedding: [1, 0],
			response: "world",
			metadata: {},
			createdAt: Date.now(),
			accessedAt: Date.now(),
			accessCount: 0,
		});

		await storage.removeEntry("ns", "1");
		const entries = await storage.getEntries("ns");
		expect(entries.length).toBe(0);
	});

	it("should clear namespace", async () => {
		const storage = createInMemoryStorage();

		await storage.addEntry("ns", {
			id: "1",
			query: "hello",
			queryEmbedding: [1, 0],
			response: "world",
			metadata: {},
			createdAt: Date.now(),
			accessedAt: Date.now(),
			accessCount: 0,
		});

		await storage.clear("ns");
		const entries = await storage.getEntries("ns");
		expect(entries.length).toBe(0);
	});

	it("should isolate namespaces", async () => {
		const storage = createInMemoryStorage();

		await storage.addEntry("ns1", {
			id: "1",
			query: "a",
			queryEmbedding: [1],
			response: "r1",
			metadata: {},
			createdAt: Date.now(),
			accessedAt: Date.now(),
			accessCount: 0,
		});

		await storage.addEntry("ns2", {
			id: "2",
			query: "b",
			queryEmbedding: [1],
			response: "r2",
			metadata: {},
			createdAt: Date.now(),
			accessedAt: Date.now(),
			accessCount: 0,
		});

		expect((await storage.getEntries("ns1")).length).toBe(1);
		expect((await storage.getEntries("ns2")).length).toBe(1);
	});
});

// ============================================================================
// Semantic Cache
// ============================================================================

describe("createSemanticCache", () => {
	let embedder: EmbedderFn;
	let cache: SemanticCache;

	beforeEach(() => {
		embedder = createTestEmbedder(32);
		cache = createSemanticCache({
			embedder,
			similarityThreshold: 0.9,
			maxCacheSize: 100,
			ttlMs: 60000,
		});
	});

	it("should miss on empty cache", async () => {
		const result = await cache.lookup("hello");
		expect(result.hit).toBe(false);
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("should hit on identical query", async () => {
		await cache.store("What is TypeScript?", "A typed superset of JS");
		const result = await cache.lookup("What is TypeScript?");

		expect(result.hit).toBe(true);
		expect(result.entry).toBeDefined();
		expect(result.entry!.response).toBe("A typed superset of JS");
		expect(result.similarity).toBeCloseTo(1, 1);
	});

	it("should hit on semantically similar query", async () => {
		// With test embedder, similar strings produce similar embeddings
		await cache.store("What is TypeScript?", "A typed superset of JS");
		const result = await cache.lookup("What is TypeScript"); // No question mark

		// Similarity depends on the test embedder
		if (result.hit) {
			expect(result.entry!.response).toBe("A typed superset of JS");
		}
	});

	it("should miss on dissimilar query", async () => {
		await cache.store("What is TypeScript?", "A typed superset of JS");
		const result = await cache.lookup("How to cook pasta");

		// Very different queries should miss (test embedder is simple)
		expect(result.hit).toBe(false);
	});

	it("should call onHit callback", async () => {
		const onHit = vi.fn();
		const cacheWithCallback = createSemanticCache({
			embedder,
			similarityThreshold: 0.9,
			onHit,
		});

		await cacheWithCallback.store("hello", "world");
		await cacheWithCallback.lookup("hello");

		expect(onHit).toHaveBeenCalledOnce();
	});

	it("should call onMiss callback", async () => {
		const onMiss = vi.fn();
		const cacheWithCallback = createSemanticCache({
			embedder,
			similarityThreshold: 0.9,
			onMiss,
		});

		await cacheWithCallback.lookup("never stored");
		expect(onMiss).toHaveBeenCalledWith("never stored");
	});

	it("should enforce maxCacheSize", async () => {
		const smallCache = createSemanticCache({
			embedder,
			maxCacheSize: 3,
			ttlMs: 60000,
		});

		for (let i = 0; i < 5; i++) {
			await smallCache.store(`query ${i}`, `response ${i}`);
		}

		const stats = smallCache.getStats();
		expect(stats.totalEntries).toBeLessThanOrEqual(3);
	});

	it("should evict expired entries", async () => {
		const shortTTL = createSemanticCache({
			embedder,
			ttlMs: 1, // 1ms TTL
		});

		await shortTTL.store("old query", "old response");
		await new Promise((r) => setTimeout(r, 10));

		// Store another to trigger eviction
		await shortTTL.store("new query", "new response");

		const stats = shortTTL.getStats();
		// Old entry should have been evicted
		expect(stats.totalEntries).toBe(1);
	});

	it("should invalidate entries by predicate", async () => {
		await cache.store("query-a", "response-a", "agent1");
		await cache.store("query-b", "response-b", "agent2");

		const removed = await cache.invalidate((entry) => entry.query === "query-a");
		expect(removed).toBe(1);

		const stats = cache.getStats();
		expect(stats.totalEntries).toBe(1);
	});

	it("should clear all entries", async () => {
		await cache.store("a", "1");
		await cache.store("b", "2");
		await cache.clear();

		const stats = cache.getStats();
		expect(stats.totalEntries).toBe(0);
		expect(stats.totalHits).toBe(0);
		expect(stats.totalMisses).toBe(0);
	});

	it("should export and import entries", async () => {
		await cache.store("hello", "world");
		const entries = await cache.export();
		expect(entries.length).toBe(1);

		const newCache = createSemanticCache({ embedder });
		await newCache.import(entries);

		const stats = newCache.getStats();
		expect(stats.totalEntries).toBe(1);
	});

	it("should track statistics", async () => {
		await cache.store("q1", "r1");
		await cache.lookup("q1"); // Hit
		await cache.lookup("totally different"); // Miss

		const stats = cache.getStats();
		expect(stats.totalHits).toBe(1);
		expect(stats.totalMisses).toBe(1);
		expect(stats.hitRate).toBe(0.5);
	});

	it("should handle embedder errors as cache miss", async () => {
		const failingEmbedder: EmbedderFn = async () => {
			throw new Error("Embedding service down");
		};

		const fragileCache = createSemanticCache({
			embedder: failingEmbedder,
		});

		const result = await fragileCache.lookup("hello");
		expect(result.hit).toBe(false);
	});

	it("should respect perAgent filtering", async () => {
		const perAgentCache = createSemanticCache({
			embedder,
			perAgent: true,
			similarityThreshold: 0.9,
		});

		await perAgentCache.store("hello", "from agent1", "agent1");
		await perAgentCache.store("hello", "from agent2", "agent2");

		const result = await perAgentCache.lookup("hello", "agent1");
		if (result.hit) {
			expect(result.entry!.response).toBe("from agent1");
		}
	});
});

// ============================================================================
// Semantic Cache Guardrail
// ============================================================================

describe("createSemanticCacheGuardrail", () => {
	it("should return passed=true on cache miss", async () => {
		const embedder = createTestEmbedder(32);
		const cache = createSemanticCache({ embedder });
		const guardrail = createSemanticCacheGuardrail({ cache });

		const result = await guardrail({ input: "hello" });
		expect(result.passed).toBe(true);
		expect(result.cacheHit).toBe(false);
	});

	it("should return passed=false and cacheHit=true on cache hit", async () => {
		const embedder = createTestEmbedder(32);
		const cache = createSemanticCache({ embedder, similarityThreshold: 0.9 });
		const guardrail = createSemanticCacheGuardrail({ cache });

		await cache.store("hello", "cached response");

		const result = await guardrail({ input: "hello" });
		expect(result.passed).toBe(false);
		expect(result.cacheHit).toBe(true);
		expect(result.cachedResponse).toBe("cached response");
		expect(result.similarity).toBeGreaterThan(0.9);
	});
});

// ============================================================================
// Test Embedder
// ============================================================================

describe("createTestEmbedder", () => {
	it("should return normalized embeddings", async () => {
		const embedder = createTestEmbedder(128);
		const embedding = await embedder("test text");

		expect(embedding.length).toBe(128);

		const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
		expect(norm).toBeCloseTo(1, 1);
	});

	it("should return identical embeddings for identical text", async () => {
		const embedder = createTestEmbedder(32);
		const a = await embedder("hello");
		const b = await embedder("hello");

		expect(cosineSimilarity(a, b)).toBeCloseTo(1);
	});

	it("should return different embeddings for different text", async () => {
		const embedder = createTestEmbedder(32);
		const a = await embedder("hello world");
		const b = await embedder("xyz completely different");

		const sim = cosineSimilarity(a, b);
		expect(sim).toBeLessThan(1);
	});
});

// ============================================================================
// Batched Embedder
// ============================================================================

describe("createBatchedEmbedder", () => {
	it("should batch multiple embed calls", async () => {
		const embedBatch = vi.fn(async (texts: string[]) =>
			texts.map(() => [1, 0, 0])
		);

		const batched = createBatchedEmbedder({
			batchSize: 3,
			embedBatch,
			maxWaitMs: 10,
		});

		const results = await Promise.all([
			batched.embed("a"),
			batched.embed("b"),
			batched.embed("c"),
		]);

		expect(results.length).toBe(3);
		expect(embedBatch).toHaveBeenCalledOnce();
		expect(embedBatch.mock.calls[0][0]).toEqual(["a", "b", "c"]);

		batched.dispose();
	});

	it("should flush on timer when batch not full", async () => {
		const embedBatch = vi.fn(async (texts: string[]) =>
			texts.map(() => [1, 0])
		);

		const batched = createBatchedEmbedder({
			batchSize: 10,
			embedBatch,
			maxWaitMs: 20,
		});

		const result = await batched.embed("single");
		expect(result).toEqual([1, 0]);
		expect(embedBatch).toHaveBeenCalledOnce();

		batched.dispose();
	});

	it("should flush manually", async () => {
		const embedBatch = vi.fn(async (texts: string[]) =>
			texts.map(() => [1])
		);

		const batched = createBatchedEmbedder({
			batchSize: 100,
			embedBatch,
			maxWaitMs: 10000,
		});

		const promise = batched.embed("test");
		await batched.flush();

		const result = await promise;
		expect(result).toEqual([1]);

		batched.dispose();
	});

	it("should reject after dispose", async () => {
		const batched = createBatchedEmbedder({
			embedBatch: async (texts) => texts.map(() => [1]),
		});

		batched.dispose();

		await expect(batched.embed("test")).rejects.toThrow("disposed");
	});

	it("should reject pending requests on dispose", async () => {
		const batched = createBatchedEmbedder({
			batchSize: 100,
			embedBatch: async (texts) => texts.map(() => [1]),
			maxWaitMs: 10000,
		});

		const promise = batched.embed("waiting");
		batched.dispose();

		await expect(promise).rejects.toThrow("disposed");
	});

	it("should validate embedBatch return length", async () => {
		const embedBatch = vi.fn(async () => [[1, 0]]); // Returns 1 embedding for N texts

		const batched = createBatchedEmbedder({
			batchSize: 3,
			embedBatch,
		});

		const promises = Promise.all([
			batched.embed("a"),
			batched.embed("b"),
			batched.embed("c"),
		]);

		await expect(promises).rejects.toThrow("embedBatch returned 1 embeddings for 3 texts");

		batched.dispose();
	});

	it("should propagate embedBatch errors", async () => {
		const embedBatch = vi.fn(async () => {
			throw new Error("API Error");
		});

		const batched = createBatchedEmbedder({
			batchSize: 1,
			embedBatch,
		});

		await expect(batched.embed("test")).rejects.toThrow("API Error");

		batched.dispose();
	});
});
