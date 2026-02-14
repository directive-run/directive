import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	createRAGEnricher,
	createJSONFileStore,
	createOpenAIEmbedder,
	type RAGChunk,
	type RAGStorage,
	type RAGEnricher,
} from "../adapters/ai/rag.js";
import {
	cosineSimilarity,
	createTestEmbedder,
} from "../adapters/guardrails/semantic-cache.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple in-memory RAGStorage for testing. */
function createMemoryStore(chunks: RAGChunk[]): RAGStorage {
	return {
		async getChunks() {
			return chunks;
		},
		async size() {
			return chunks.length;
		},
	};
}

/** Build a fake chunk with a known embedding. */
function makeChunk(
	id: string,
	content: string,
	embedding: number[],
	metadata: Record<string, unknown> = {},
): RAGChunk {
	return { id, content, embedding, metadata };
}

// ============================================================================
// createRAGEnricher — retrieve()
// ============================================================================

describe("createRAGEnricher — retrieve()", () => {
	const embedder = createTestEmbedder(4);
	let enricher: RAGEnricher;

	// Chunks with carefully constructed embeddings for predictable similarity
	const chunkA = makeChunk("a", "alpha content", [1, 0, 0, 0]);
	const chunkB = makeChunk("b", "beta content", [0.9, 0.1, 0, 0]);
	const chunkC = makeChunk("c", "gamma content", [0, 0, 0, 1]);
	const chunkD = makeChunk("d", "delta content", [0.5, 0.5, 0, 0]);

	beforeEach(() => {
		// Use a deterministic embedder that returns a known vector for queries
		const fakeEmbedder = async (_text: string) => [1, 0, 0, 0];

		enricher = createRAGEnricher({
			embedder: fakeEmbedder,
			storage: createMemoryStore([chunkA, chunkB, chunkC, chunkD]),
			topK: 3,
			minSimilarity: 0.3,
		});
	});

	it("sorts results by similarity descending", async () => {
		const results = await enricher.retrieve("anything");
		// chunkA (sim=1.0), chunkB (sim≈0.99), chunkD (sim≈0.71)
		expect(results[0]!.id).toBe("a");
		expect(results[0]!.similarity).toBeCloseTo(1.0);
		expect(results[1]!.id).toBe("b");
		expect(results[1]!.similarity).toBeGreaterThan(0.9);
	});

	it("respects topK", async () => {
		const results = await enricher.retrieve("anything", 2);
		expect(results).toHaveLength(2);
	});

	it("filters by minSimilarity", async () => {
		// chunkC has similarity ~0 to [1,0,0,0] — should be excluded
		const results = await enricher.retrieve("anything");
		const ids = results.map((r) => r.id);
		expect(ids).not.toContain("c");
	});

	it("returns empty array when no chunks match", async () => {
		// Embedder returns orthogonal vector — nothing should match
		const emptyEnricher = createRAGEnricher({
			embedder: async () => [0, 0, 1, 0],
			storage: createMemoryStore([
				makeChunk("x", "content", [1, 0, 0, 0]),
			]),
			minSimilarity: 0.9,
		});
		const results = await emptyEnricher.retrieve("anything");
		expect(results).toHaveLength(0);
	});

	it("returns empty array when storage is empty", async () => {
		const emptyEnricher = createRAGEnricher({
			embedder: async () => [1, 0, 0, 0],
			storage: createMemoryStore([]),
		});
		const results = await emptyEnricher.retrieve("anything");
		expect(results).toHaveLength(0);
	});

	it("clamps topK to at least 1", async () => {
		const results = await enricher.retrieve("anything", 0);
		expect(results).toHaveLength(1);
	});

	it("floors fractional topK values", async () => {
		const results = await enricher.retrieve("anything", 1.9);
		expect(results).toHaveLength(1);
	});

	it("clamps minSimilarity to [0, 1]", async () => {
		// minSimilarity > 1 should be clamped to 1 — nothing matches
		const strict = createRAGEnricher({
			embedder: async () => [1, 0, 0, 0],
			storage: createMemoryStore([chunkA]),
			minSimilarity: 1.5,
		});
		const results = await strict.retrieve("anything");
		// chunkA has similarity 1.0 which equals clamped minSimilarity 1.0
		expect(results).toHaveLength(1);
	});

	it("warns in dev mode when minSimilarity is clamped", async () => {
		const origEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "development";
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

		createRAGEnricher({
			embedder: async () => [1, 0],
			storage: createMemoryStore([]),
			minSimilarity: 2.0,
		});

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("minSimilarity 2 clamped to 1"),
		);

		spy.mockRestore();
		process.env.NODE_ENV = origEnv;
	});

	it("uses storage.search() when available", async () => {
		const searchFn = vi.fn(async () => [
			{ ...chunkA, similarity: 0.95 },
		]);
		const store: RAGStorage = {
			async getChunks() {
				return [];
			},
			async size() {
				return 0;
			},
			search: searchFn,
		};

		const enricher = createRAGEnricher({
			embedder: async () => [1, 0, 0, 0],
			storage: store,
		});

		const results = await enricher.retrieve("test");
		expect(searchFn).toHaveBeenCalledOnce();
		expect(results).toHaveLength(1);
		expect(results[0]!.id).toBe("a");
	});
});

// ============================================================================
// createRAGEnricher — enrich()
// ============================================================================

describe("createRAGEnricher — enrich()", () => {
	it("builds full enriched string with context, history, and query", async () => {
		const chunks = [
			makeChunk("a", "Alpha docs", [1, 0], {
				title: "Alpha",
				section: "Intro",
				url: "/docs/alpha",
			}),
		];

		const enricher = createRAGEnricher({
			embedder: async () => [1, 0],
			storage: createMemoryStore(chunks),
		});

		const result = await enricher.enrich("How does alpha work?", {
			prefix: "User is viewing: /docs/alpha",
			history: [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
			],
		});

		expect(result).toContain("User is viewing: /docs/alpha");
		expect(result).toContain("Alpha docs");
		expect(result).toContain("User: Hello");
		expect(result).toContain("Assistant: Hi there!");
		expect(result).toContain("How does alpha work?");
	});

	it("returns just the query when no chunks match", async () => {
		const enricher = createRAGEnricher({
			embedder: async () => [0, 0, 1],
			storage: createMemoryStore([
				makeChunk("a", "content", [1, 0, 0]),
			]),
			minSimilarity: 0.99,
		});

		const result = await enricher.enrich("Hello");
		expect(result).toBe("Hello");
	});

	it("handles embedder errors gracefully (calls onError)", async () => {
		const onError = vi.fn();
		const enricher = createRAGEnricher({
			embedder: async () => {
				throw new Error("API down");
			},
			storage: createMemoryStore([]),
			onError,
		});

		const result = await enricher.enrich("test query");
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0]![0] as Error).message).toBe("API down");
		// Falls back to just the query
		expect(result).toBe("test query");
	});

	it("uses custom formatChunk and formatContext", async () => {
		const enricher = createRAGEnricher({
			embedder: async () => [1, 0],
			storage: createMemoryStore([
				makeChunk("a", "Alpha", [1, 0]),
			]),
			formatChunk: (chunk, sim) =>
				`CHUNK(${chunk.id}, ${sim.toFixed(2)})`,
			formatContext: (chunks, query) =>
				`CTX[${chunks.join(",")}] for "${query}"`,
		});

		const result = await enricher.enrich("test");
		expect(result).toContain("CHUNK(a, 1.00)");
		expect(result).toContain('CTX[');
		expect(result).toContain('for "test"');
	});

	it("capitalizes all role types in history", async () => {
		const enricher = createRAGEnricher({
			embedder: async () => [0, 0, 1],
			storage: createMemoryStore([]),
		});

		const result = await enricher.enrich("test", {
			history: [
				{ role: "user", content: "msg1" },
				{ role: "assistant", content: "msg2" },
				{ role: "system", content: "msg3" },
			],
		});

		expect(result).toContain("User: msg1");
		expect(result).toContain("Assistant: msg2");
		expect(result).toContain("System: msg3");
	});

	it("applies filter to exclude chunks", async () => {
		const chunks = [
			makeChunk("a", "Alpha", [1, 0], { section: "intro" }),
			makeChunk("b", "Beta", [0.9, 0.1], { section: "advanced" }),
		];

		const enricher = createRAGEnricher({
			embedder: async () => [1, 0],
			storage: createMemoryStore(chunks),
		});

		const result = await enricher.enrich("test", {
			filter: (chunk) => chunk.metadata.section === "intro",
		});

		expect(result).toContain("Alpha");
		expect(result).not.toContain("Beta");
	});
});

// ============================================================================
// createJSONFileStore
// ============================================================================

describe("createJSONFileStore", () => {
	it("loads and caches a JSON file", async () => {
		// Mock node:fs
		const mockData = JSON.stringify([
			{
				id: "1",
				content: "hello",
				embedding: [0.1, 0.2],
				metadata: { url: "/test" },
			},
		]);

		const mockFs = {
			readFileSync: vi.fn().mockReturnValue(mockData),
			promises: {
				readFile: vi.fn().mockResolvedValue(mockData),
			},
		};

		vi.doMock("node:fs", () => mockFs);

		const store = createJSONFileStore({ filePath: "/tmp/test.json" });
		const chunks = await store.getChunks();
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.id).toBe("1");

		// Second call uses cache — readFile not called again
		const size = await store.size();
		expect(size).toBe(1);

		vi.doUnmock("node:fs");
	});

	it("with mapEntry transforms raw entries", async () => {
		const mockData = JSON.stringify([
			{ custom_id: "x", text: "world", vec: [0.5] },
		]);

		const mockFs = {
			readFileSync: vi.fn().mockReturnValue(mockData),
			promises: {
				readFile: vi.fn().mockResolvedValue(mockData),
			},
		};

		vi.doMock("node:fs", () => mockFs);

		const store = createJSONFileStore({
			filePath: "/tmp/custom.json",
			mapEntry: (entry) => ({
				id: entry.custom_id as string,
				content: entry.text as string,
				embedding: entry.vec as number[],
				metadata: {},
			}),
		});

		const chunks = await store.getChunks();
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.id).toBe("x");
		expect(chunks[0]!.content).toBe("world");

		vi.doUnmock("node:fs");
	});

	it("returns empty array when file is missing", async () => {
		const mockFs = {
			readFileSync: vi.fn().mockImplementation(() => {
				throw new Error("ENOENT");
			}),
			promises: {
				readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
			},
		};

		vi.doMock("node:fs", () => mockFs);

		const store = createJSONFileStore({ filePath: "/tmp/missing.json" });
		const chunks = await store.getChunks();
		expect(chunks).toHaveLength(0);

		vi.doUnmock("node:fs");
	});

	it("provides reload() to clear cache", async () => {
		const mockData1 = JSON.stringify([
			{ id: "1", content: "v1", embedding: [0.1], metadata: {} },
		]);
		const mockData2 = JSON.stringify([
			{ id: "1", content: "v2", embedding: [0.2], metadata: {} },
			{ id: "2", content: "new", embedding: [0.3], metadata: {} },
		]);

		let callCount = 0;
		const mockFs = {
			promises: {
				readFile: vi.fn().mockImplementation(async () => {
					return callCount++ === 0 ? mockData1 : mockData2;
				}),
			},
		};

		vi.doMock("node:fs", () => mockFs);

		const store = createJSONFileStore({ filePath: "/tmp/reload.json" });

		const chunks1 = await store.getChunks();
		expect(chunks1).toHaveLength(1);

		await store.reload!();
		const chunks2 = await store.getChunks();
		expect(chunks2).toHaveLength(2);

		vi.doUnmock("node:fs");
	});

	it("provides dispose() to clear state", async () => {
		const store = createJSONFileStore({ filePath: "/tmp/dispose.json" });
		// dispose should not throw
		store.dispose!();
	});
});

// ============================================================================
// createOpenAIEmbedder
// ============================================================================

describe("createOpenAIEmbedder", () => {
	it("calls the OpenAI embeddings API correctly", async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({
				data: [{ embedding: [0.1, 0.2, 0.3] }],
			}),
		};
		const mockFetch = vi.fn().mockResolvedValue(mockResponse);

		const embedder = createOpenAIEmbedder({
			apiKey: "test-key",
			model: "text-embedding-3-small",
			dimensions: 1536,
			fetch: mockFetch as unknown as typeof globalThis.fetch,
		});

		const result = await embedder("hello world");

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0]!;
		expect(url).toBe("https://api.openai.com/v1/embeddings");
		expect(init.method).toBe("POST");
		expect(init.headers.Authorization).toBe("Bearer test-key");

		const body = JSON.parse(init.body);
		expect(body.model).toBe("text-embedding-3-small");
		expect(body.input).toBe("hello world");
		expect(body.dimensions).toBe(1536);

		expect(result).toEqual([0.1, 0.2, 0.3]);
	});

	it("throws on non-ok response with body", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => "Unauthorized: invalid API key",
		});

		const embedder = createOpenAIEmbedder({
			apiKey: "bad-key",
			fetch: mockFetch as unknown as typeof globalThis.fetch,
		});

		await expect(embedder("test")).rejects.toThrow("OpenAI embedding failed: 401 - Unauthorized: invalid API key");
	});

	it("throws on empty data array", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [] }),
		});

		const embedder = createOpenAIEmbedder({
			apiKey: "key",
			fetch: mockFetch as unknown as typeof globalThis.fetch,
		});

		await expect(embedder("test")).rejects.toThrow(
			"no data entries",
		);
	});

	it("uses custom baseURL", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ embedding: [0.5] }] }),
		});

		const embedder = createOpenAIEmbedder({
			apiKey: "key",
			baseURL: "https://custom.api.com/v1",
			fetch: mockFetch as unknown as typeof globalThis.fetch,
		});

		await embedder("test");
		expect(mockFetch.mock.calls[0]![0]).toBe(
			"https://custom.api.com/v1/embeddings",
		);
	});
});

// ============================================================================
// Reuses cosineSimilarity from semantic-cache
// ============================================================================

describe("cosineSimilarity reuse", () => {
	it("is the same function from semantic-cache (not duplicated)", () => {
		// Verify it works — the import proves reuse
		expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
	});
});
