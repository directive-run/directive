import { describe, expect, it, vi } from "vitest";

import {
  cosineSimilarity,
  createBatchedEmbedder,
  createInMemoryStorage,
  createSemanticCache,
  createSemanticCacheGuardrail,
  createTestEmbedder,
} from "../../guardrails/semantic-cache.js";

import type {
  CacheEntry,
  Embedding,
  EmbedderFn,
} from "../../guardrails/semantic-cache.js";

// ============================================================================
// Helpers
// ============================================================================

/** Creates an embedder that returns predictable unit vectors for controlled similarity. */
function createFixedEmbedder(mapping: Record<string, Embedding>): EmbedderFn {
  return async (text: string) => {
    const vec = mapping[text];
    if (!vec) {
      throw new Error(`No embedding configured for: "${text}"`);
    }

    return vec;
  };
}

/** Normalized unit vector along axis `i` in `dims`-dimensional space. */
function unitVector(i: number, dims = 4): Embedding {
  const v = new Array(dims).fill(0);
  v[i] = 1;

  return v;
}

/** Build a minimal CacheEntry for import tests. */
function makeCacheEntry(
  overrides: Partial<CacheEntry> & { id: string; query: string; response: string; queryEmbedding: Embedding },
): CacheEntry {
  return {
    metadata: {},
    createdAt: Date.now(),
    accessedAt: Date.now(),
    accessCount: 0,
    ...overrides,
  };
}

// ============================================================================
// cosineSimilarity
// ============================================================================

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = [0.6, 0.8];

    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it("returns 0 for perpendicular vectors", () => {
    const a = [1, 0];
    const b = [0, 1];

    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];

    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrowError(
      /Vector dimensions must match/,
    );
  });

  it("returns 0 when either vector is zero", () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];

    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
  });
});

// ============================================================================
// createInMemoryStorage
// ============================================================================

describe("createInMemoryStorage", () => {
  it("getEntries returns empty array initially", async () => {
    const storage = createInMemoryStorage();
    const entries = await storage.getEntries("ns");

    expect(entries).toEqual([]);
  });

  it("addEntry + getEntries round-trip", async () => {
    const storage = createInMemoryStorage();
    const entry = makeCacheEntry({
      id: "e1",
      query: "hello",
      response: "world",
      queryEmbedding: [1, 0],
    });

    await storage.addEntry("ns", entry);
    const entries = await storage.getEntries("ns");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("e1");
    expect(entries[0]!.response).toBe("world");
  });

  it("updateEntry modifies existing entry", async () => {
    const storage = createInMemoryStorage();
    const entry = makeCacheEntry({
      id: "e1",
      query: "hello",
      response: "world",
      queryEmbedding: [1, 0],
      accessCount: 0,
    });

    await storage.addEntry("ns", entry);
    await storage.updateEntry("ns", "e1", { accessCount: 5 });

    const entries = await storage.getEntries("ns");

    expect(entries[0]!.accessCount).toBe(5);
  });

  it("removeEntry deletes entry", async () => {
    const storage = createInMemoryStorage();
    const entry = makeCacheEntry({
      id: "e1",
      query: "hello",
      response: "world",
      queryEmbedding: [1, 0],
    });

    await storage.addEntry("ns", entry);
    await storage.removeEntry("ns", "e1");

    const entries = await storage.getEntries("ns");

    expect(entries).toHaveLength(0);
  });

  it("clear removes all entries in namespace", async () => {
    const storage = createInMemoryStorage();
    await storage.addEntry(
      "ns",
      makeCacheEntry({ id: "e1", query: "a", response: "1", queryEmbedding: [1, 0] }),
    );
    await storage.addEntry(
      "ns",
      makeCacheEntry({ id: "e2", query: "b", response: "2", queryEmbedding: [0, 1] }),
    );

    // Entries in a different namespace should be unaffected
    await storage.addEntry(
      "other",
      makeCacheEntry({ id: "e3", query: "c", response: "3", queryEmbedding: [1, 1] }),
    );

    await storage.clear("ns");

    expect(await storage.getEntries("ns")).toHaveLength(0);
    expect(await storage.getEntries("other")).toHaveLength(1);
  });
});

// ============================================================================
// createSemanticCache
// ============================================================================

describe("createSemanticCache", () => {
  it("lookup returns miss for empty cache", async () => {
    const cache = createSemanticCache({
      embedder: createTestEmbedder(),
    });

    const result = await cache.lookup("anything");

    expect(result.hit).toBe(false);
    expect(result.entry).toBeUndefined();
  });

  it("store + lookup returns hit when above threshold", async () => {
    const embedder = createFixedEmbedder({
      "hello world": [1, 0, 0, 0],
      "hello there": [1, 0, 0, 0], // identical vector = similarity 1.0
    });

    const cache = createSemanticCache({
      embedder,
      similarityThreshold: 0.9,
    });

    await cache.store("hello world", "response-1");

    const result = await cache.lookup("hello there");

    expect(result.hit).toBe(true);
    expect(result.entry!.response).toBe("response-1");
    expect(result.similarity).toBeCloseTo(1.0);
  });

  it("lookup returns miss when below similarity threshold", async () => {
    const embedder = createFixedEmbedder({
      "hello world": unitVector(0),
      "goodbye world": unitVector(1), // perpendicular = similarity 0
    });

    const cache = createSemanticCache({
      embedder,
      similarityThreshold: 0.9,
    });

    await cache.store("hello world", "response-1");

    const result = await cache.lookup("goodbye world");

    expect(result.hit).toBe(false);
  });

  it("TTL expiration removes old entries on store", async () => {
    const now = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const embedder = createFixedEmbedder({
      "old query": unitVector(0),
      "new query": unitVector(1),
      "lookup query": unitVector(0), // same as old query
    });

    const cache = createSemanticCache({
      embedder,
      ttlMs: 5000,
      similarityThreshold: 0.9,
    });

    await cache.store("old query", "old-response");

    // Advance past TTL
    vi.spyOn(Date, "now").mockReturnValue(now + 6000);

    // Storing a new entry triggers eviction of expired entries
    await cache.store("new query", "new-response");

    const result = await cache.lookup("lookup query");

    expect(result.hit).toBe(false);

    vi.restoreAllMocks();
  });

  it("LRU eviction when exceeding maxCacheSize", async () => {
    // Use unit vectors so entries are orthogonal (no cross-hits)
    const embedder = createFixedEmbedder({
      q1: unitVector(0, 8),
      q2: unitVector(1, 8),
      q3: unitVector(2, 8),
      "lookup-q1": unitVector(0, 8),
      "lookup-q2": unitVector(1, 8),
    });

    const cache = createSemanticCache({
      embedder,
      maxCacheSize: 2,
      similarityThreshold: 0.9,
    });

    await cache.store("q1", "r1"); // oldest accessedAt
    await cache.store("q2", "r2");

    // Access q2 to make q1 the least-recently-accessed
    await cache.lookup("lookup-q2");

    // Adding q3 should evict q1 (LRU)
    await cache.store("q3", "r3");

    const result = await cache.lookup("lookup-q1");

    expect(result.hit).toBe(false);
  });

  it("onHit callback fires with entry and similarity", async () => {
    const onHit = vi.fn();
    const embedder = createFixedEmbedder({
      query: unitVector(0),
      "same query": unitVector(0),
    });

    const cache = createSemanticCache({
      embedder,
      similarityThreshold: 0.5,
      onHit,
    });

    await cache.store("query", "response");
    await cache.lookup("same query");

    expect(onHit).toHaveBeenCalledOnce();
    expect(onHit.mock.calls[0]![0].response).toBe("response");
    expect(onHit.mock.calls[0]![1]).toBeCloseTo(1.0);
  });

  it("onMiss callback fires with query", async () => {
    const onMiss = vi.fn();

    const cache = createSemanticCache({
      embedder: createTestEmbedder(),
      onMiss,
    });

    await cache.lookup("no match");

    expect(onMiss).toHaveBeenCalledWith("no match");
  });

  it("getStats returns correct hit/miss counts and hitRate", async () => {
    const embedder = createFixedEmbedder({
      stored: unitVector(0),
      hit: unitVector(0),
      miss: unitVector(1),
    });

    const cache = createSemanticCache({
      embedder,
      similarityThreshold: 0.9,
    });

    await cache.store("stored", "response");

    await cache.lookup("hit");  // hit
    await cache.lookup("miss"); // miss

    const stats = cache.getStats();

    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
    expect(stats.totalEntries).toBe(1);
  });

  it("clear resets all stats", async () => {
    const cache = createSemanticCache({
      embedder: createTestEmbedder(),
    });

    await cache.store("q", "r");
    await cache.lookup("q");

    await cache.clear();

    const stats = cache.getStats();

    expect(stats.totalEntries).toBe(0);
    expect(stats.totalHits).toBe(0);
    expect(stats.totalMisses).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.avgSimilarityOnHit).toBe(0);
    expect(stats.oldestEntry).toBeNull();
    expect(stats.newestEntry).toBeNull();
  });

  it("export returns all entries", async () => {
    const embedder = createFixedEmbedder({
      q1: unitVector(0),
      q2: unitVector(1),
    });

    const cache = createSemanticCache({ embedder });

    await cache.store("q1", "r1");
    await cache.store("q2", "r2");

    const exported = await cache.export();

    expect(exported).toHaveLength(2);
    expect(exported.map((e) => e.query).sort()).toEqual(["q1", "q2"]);
  });

  it("import adds entries and evicts if needed", async () => {
    const embedder = createFixedEmbedder({
      lookup: unitVector(0, 4),
    });

    const cache = createSemanticCache({
      embedder,
      maxCacheSize: 2,
      similarityThreshold: 0.9,
    });

    const entries: CacheEntry[] = [
      makeCacheEntry({ id: "i1", query: "a", response: "r1", queryEmbedding: unitVector(0, 4), accessedAt: 100 }),
      makeCacheEntry({ id: "i2", query: "b", response: "r2", queryEmbedding: unitVector(1, 4), accessedAt: 200 }),
      makeCacheEntry({ id: "i3", query: "c", response: "r3", queryEmbedding: unitVector(2, 4), accessedAt: 300 }),
    ];

    await cache.import(entries);

    // maxCacheSize=2, so the LRU entry (i1, accessedAt=100) should be evicted
    const exported = await cache.export();

    expect(exported).toHaveLength(2);
    expect(exported.find((e) => e.id === "i1")).toBeUndefined();
  });

  it("invalidate removes matching entries and returns count", async () => {
    const embedder = createFixedEmbedder({
      "agent-a query": unitVector(0),
      "agent-b query": unitVector(1),
    });

    const cache = createSemanticCache({ embedder, perAgent: true });

    await cache.store("agent-a query", "r1", "agent-a");
    await cache.store("agent-b query", "r2", "agent-b");

    const removed = await cache.invalidate((entry) => entry.agentName === "agent-a");

    expect(removed).toBe(1);

    const exported = await cache.export();

    expect(exported).toHaveLength(1);
    expect(exported[0]!.agentName).toBe("agent-b");
  });

  it("perAgent=true filters by agentName on lookup", async () => {
    const sharedVec = [0.7071, 0.7071, 0, 0]; // same vector for both

    const embedder = createFixedEmbedder({
      query: sharedVec,
      "same query": sharedVec,
    });

    const cache = createSemanticCache({
      embedder,
      similarityThreshold: 0.9,
      perAgent: true,
    });

    await cache.store("query", "agent-a response", "agent-a");

    // Looking up with a different agent name should miss
    const missResult = await cache.lookup("same query", "agent-b");

    expect(missResult.hit).toBe(false);

    // Looking up with the same agent name should hit
    const hitResult = await cache.lookup("same query", "agent-a");

    expect(hitResult.hit).toBe(true);
    expect(hitResult.entry!.response).toBe("agent-a response");
  });

  it("onError callback fires on embedder failure and returns cache miss", async () => {
    const onError = vi.fn();
    const failingEmbedder: EmbedderFn = async () => {
      throw new Error("Embedding API down");
    };

    const cache = createSemanticCache({
      embedder: failingEmbedder,
      onError,
    });

    const result = await cache.lookup("anything");

    expect(result.hit).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![0].message).toBe("Embedding API down");
  });
});

// ============================================================================
// createSemanticCacheGuardrail
// ============================================================================

describe("createSemanticCacheGuardrail", () => {
  it("returns passed=false with cacheHit=true on hit", async () => {
    const embedder = createFixedEmbedder({
      stored: unitVector(0),
      lookup: unitVector(0),
    });

    const cache = createSemanticCache({
      embedder,
      similarityThreshold: 0.9,
    });

    await cache.store("stored", "cached-response");

    const guardrail = createSemanticCacheGuardrail({ cache });
    const result = await guardrail({ input: "lookup" });

    expect(result.passed).toBe(false);
    expect(result.cacheHit).toBe(true);
    expect(result.cachedResponse).toBe("cached-response");
    expect(result.similarity).toBeCloseTo(1.0);
  });

  it("returns passed=true with cacheHit=false on miss", async () => {
    const cache = createSemanticCache({
      embedder: createTestEmbedder(),
    });

    const guardrail = createSemanticCacheGuardrail({ cache });
    const result = await guardrail({ input: "never seen before" });

    expect(result.passed).toBe(true);
    expect(result.cacheHit).toBe(false);
    expect(result.cachedResponse).toBeUndefined();
    expect(result.similarity).toBeUndefined();
  });
});

// ============================================================================
// createTestEmbedder
// ============================================================================

describe("createTestEmbedder", () => {
  it("returns normalized embedding of specified dimensions", async () => {
    const embedder = createTestEmbedder(64);
    const embedding = await embedder("test input");

    expect(embedding).toHaveLength(64);

    // Verify normalization: magnitude should be ~1
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it("same text returns same embedding", async () => {
    const embedder = createTestEmbedder();

    const a = await embedder("hello world");
    const b = await embedder("hello world");

    expect(a).toEqual(b);
  });
});

// ============================================================================
// createBatchedEmbedder
// ============================================================================

describe("createBatchedEmbedder", () => {
  it("batches multiple embed calls into single embedBatch call", async () => {
    const embedBatch = vi.fn(async (texts: string[]) =>
      texts.map((_, i) => unitVector(i, 4)),
    );

    const { embed } = createBatchedEmbedder({
      batchSize: 3,
      embedBatch,
      maxWaitMs: 10000, // large wait so only batchSize triggers
    });

    const p1 = embed("a");
    const p2 = embed("b");
    const p3 = embed("c"); // hits batchSize=3, triggers flush

    const results = await Promise.all([p1, p2, p3]);

    expect(embedBatch).toHaveBeenCalledOnce();
    expect(embedBatch).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(results).toHaveLength(3);
  });

  it("flush() sends pending batch immediately", async () => {
    const embedBatch = vi.fn(async (texts: string[]) =>
      texts.map(() => [1, 0]),
    );

    const { embed, flush } = createBatchedEmbedder({
      batchSize: 100, // high batchSize so it won't auto-flush
      embedBatch,
      maxWaitMs: 60000,
    });

    const p = embed("hello");

    // Not yet sent
    expect(embedBatch).not.toHaveBeenCalled();

    await flush();

    const result = await p;

    expect(embedBatch).toHaveBeenCalledOnce();
    expect(result).toEqual([1, 0]);
  });

  it("destroy() rejects pending requests", async () => {
    const embedBatch = vi.fn(async (texts: string[]) =>
      texts.map(() => [1]),
    );

    const { embed, destroy } = createBatchedEmbedder({
      batchSize: 100,
      embedBatch,
      maxWaitMs: 60000,
    });

    const p = embed("pending");

    destroy();

    await expect(p).rejects.toThrowError(/destroyed/i);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("throws on embed after destroy", async () => {
    const { embed, destroy } = createBatchedEmbedder({
      embedBatch: async (texts) => texts.map(() => [1]),
    });

    destroy();

    await expect(embed("after destroy")).rejects.toThrowError(/destroyed/i);
  });

  it("throws on batchSize < 1", () => {
    expect(() =>
      createBatchedEmbedder({
        batchSize: 0,
        embedBatch: async (texts) => texts.map(() => [1]),
      }),
    ).toThrowError(/batchSize must be >= 1/);
  });
});
