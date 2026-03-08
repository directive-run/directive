import { describe, expect, it, vi } from "vitest";
import {
  createJSONFileStore,
  createRAGEnricher,
  type RAGChunk,
  type RAGStorage,
} from "../rag.js";
import type { EmbedderFn } from "../guardrails/semantic-cache.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Unit vectors for controllable cosine similarity:
 *   cosine([1,0,0], [1,0,0]) = 1.0
 *   cosine([1,0,0], [0,1,0]) = 0.0
 *   cosine([1,0,0], [0.8,0.6,0]) = 0.8
 */
const VEC_X: number[] = [1, 0, 0];
const VEC_Y: number[] = [0, 1, 0];
const VEC_Z: number[] = [0, 0, 1];
const VEC_MID: number[] = [0.8, 0.6, 0]; // similarity to VEC_X = 0.8

function chunk(
  id: string,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown> = {},
): RAGChunk {
  return { id, content, embedding, metadata };
}

function createMockStorage(chunks: RAGChunk[]): RAGStorage {
  return {
    async getChunks() {
      return chunks;
    },
    async size() {
      return chunks.length;
    },
  };
}

/** Embedder that always returns VEC_X (perfect match with VEC_X chunks). */
function staticEmbedder(vec: number[] = VEC_X): EmbedderFn {
  return vi.fn(async () => vec);
}

// ============================================================================
// createRAGEnricher — retrieve
// ============================================================================

describe("createRAGEnricher — retrieve", () => {
  it("returns empty array when no chunks match minSimilarity", async () => {
    const storage = createMockStorage([
      chunk("a", "alpha", VEC_Y),
      chunk("b", "beta", VEC_Z),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
    });

    const results = await enricher.retrieve("query");

    expect(results).toEqual([]);
  });

  it("returns top-K chunks sorted by similarity descending", async () => {
    const storage = createMockStorage([
      chunk("low", "low", VEC_Y), // sim 0.0
      chunk("mid", "mid", VEC_MID), // sim 0.8
      chunk("high", "high", VEC_X), // sim 1.0
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      topK: 2,
      minSimilarity: 0.1,
    });

    const results = await enricher.retrieve("query");

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("high");
    expect(results[1]!.id).toBe("mid");
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
  });

  it("per-call topK override works", async () => {
    const storage = createMockStorage([
      chunk("a", "a", VEC_X),
      chunk("b", "b", VEC_MID),
      chunk("c", "c", [0.9, Math.sqrt(1 - 0.81), 0]),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      topK: 10,
      minSimilarity: 0.1,
    });

    const results = await enricher.retrieve("query", 1);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("a");
  });

  it("uses storage.search() if available (bypasses getChunks scan)", async () => {
    const searchFn = vi.fn(async () => [
      { ...chunk("s1", "from search", VEC_X), similarity: 0.99 },
    ]);
    const getChunksFn = vi.fn(async () => []);

    const storage: RAGStorage = {
      getChunks: getChunksFn,
      size: async () => 0,
      search: searchFn,
    };

    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      topK: 5,
      minSimilarity: 0.3,
    });

    const results = await enricher.retrieve("query");

    expect(searchFn).toHaveBeenCalledOnce();
    expect(getChunksFn).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("s1");
  });

  it("minSimilarity filters low-similarity chunks", async () => {
    const storage = createMockStorage([
      chunk("exact", "exact", VEC_X), // sim 1.0
      chunk("mid", "mid", VEC_MID), // sim 0.8
      chunk("ortho", "ortho", VEC_Y), // sim 0.0
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      topK: 10,
      minSimilarity: 0.9,
    });

    const results = await enricher.retrieve("query");

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("exact");
  });
});

// ============================================================================
// createRAGEnricher — enrich
// ============================================================================

describe("createRAGEnricher — enrich", () => {
  it("returns just the input when no chunks match", async () => {
    const storage = createMockStorage([
      chunk("a", "alpha", VEC_Y),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.9,
    });

    const result = await enricher.enrich("my question");

    expect(result).toBe("my question");
  });

  it('includes "Relevant documentation context:" block when chunks match', async () => {
    const storage = createMockStorage([
      chunk("doc1", "Answer content", VEC_X, { title: "Guide" }),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
    });

    const result = await enricher.enrich("my question");

    expect(result).toContain("Relevant documentation context:");
    expect(result).toContain("Answer content");
  });

  it("includes prefix before context block", async () => {
    const storage = createMockStorage([
      chunk("doc1", "content", VEC_X),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
    });

    const result = await enricher.enrich("question", {
      prefix: "User is viewing: /docs/api",
    });

    const prefixIndex = result.indexOf("User is viewing: /docs/api");
    const contextIndex = result.indexOf("Relevant documentation context:");

    expect(prefixIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeGreaterThan(prefixIndex);
  });

  it('includes history formatted as "Previous conversation:" section', async () => {
    const storage = createMockStorage([]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
    });

    const result = await enricher.enrich("follow-up", {
      history: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });

    expect(result).toContain("Previous conversation:");
    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hi there");
  });

  it('all parts separated by "\\n\\n---\\n\\n"', async () => {
    const storage = createMockStorage([
      chunk("doc1", "content", VEC_X),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
    });

    const result = await enricher.enrich("question", {
      prefix: "Prefix line",
      history: [{ role: "user", content: "Hi" }],
    });

    const parts = result.split("\n\n---\n\n");

    expect(parts).toHaveLength(4); // prefix, context, history, input
    expect(parts[0]).toBe("Prefix line");
    expect(parts[1]).toContain("Relevant documentation context:");
    expect(parts[2]).toContain("Previous conversation:");
    expect(parts[3]).toBe("question");
  });

  it("filter option filters chunks after retrieval", async () => {
    const storage = createMockStorage([
      chunk("keep", "keep content", VEC_X, { tag: "api" }),
      chunk("drop", "drop content", VEC_X, { tag: "internal" }),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
    });

    const result = await enricher.enrich("question", {
      filter: (c) => c.metadata.tag === "api",
    });

    expect(result).toContain("keep content");
    expect(result).not.toContain("drop content");
  });

  it("custom formatChunk is used for each chunk", async () => {
    const storage = createMockStorage([
      chunk("c1", "content1", VEC_X),
      chunk("c2", "content2", VEC_X),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
      formatChunk: (c, sim) => `CUSTOM[${c.id}|${sim.toFixed(1)}]`,
    });

    const result = await enricher.enrich("question");

    expect(result).toContain("CUSTOM[c1|1.0]");
    expect(result).toContain("CUSTOM[c2|1.0]");
  });

  it("custom formatContext overrides default context block", async () => {
    const storage = createMockStorage([
      chunk("c1", "content", VEC_X),
    ]);
    const enricher = createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage,
      minSimilarity: 0.5,
      formatContext: (chunks, query) =>
        `CTX(${chunks.length} chunks for "${query}")`,
    });

    const result = await enricher.enrich("my query");

    expect(result).toContain('CTX(1 chunks for "my query")');
    expect(result).not.toContain("Relevant documentation context:");
  });

  it("onError callback fires on embedder failure (returns input without context)", async () => {
    const onError = vi.fn();
    const failingEmbedder: EmbedderFn = async () => {
      throw new Error("Embedding service down");
    };
    const storage = createMockStorage([
      chunk("c1", "content", VEC_X),
    ]);
    const enricher = createRAGEnricher({
      embedder: failingEmbedder,
      storage,
      onError,
    });

    const result = await enricher.enrich("question");

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![0].message).toBe("Embedding service down");
    expect(result).toBe("question");
  });
});

// ============================================================================
// defaultFormatChunk (tested via enrich output)
// ============================================================================

describe("defaultFormatChunk (via enrich output)", () => {
  function enricherWithChunks(chunks: RAGChunk[]) {
    return createRAGEnricher({
      embedder: staticEmbedder(VEC_X),
      storage: createMockStorage(chunks),
      minSimilarity: 0.5,
    });
  }

  it("uses title + section + url when all metadata present", async () => {
    const enricher = enricherWithChunks([
      chunk("c1", "Body text", VEC_X, {
        title: "API Reference",
        section: "Authentication",
        url: "https://docs.example.com/auth",
      }),
    ]);

    const result = await enricher.enrich("question");

    expect(result).toContain(
      "[API Reference — Authentication](https://docs.example.com/auth)",
    );
    expect(result).toContain("Body text");
  });

  it("uses just title when only title present", async () => {
    const enricher = enricherWithChunks([
      chunk("c1", "Body text", VEC_X, { title: "Getting Started" }),
    ]);

    const result = await enricher.enrich("question");

    expect(result).toContain("Getting Started");
    expect(result).toContain("Body text");
    // Should NOT have the link format
    expect(result).not.toContain("[Getting Started");
  });

  it("falls back to chunk id when no title", async () => {
    const enricher = enricherWithChunks([
      chunk("chunk-42", "Body text", VEC_X),
    ]);

    const result = await enricher.enrich("question");

    expect(result).toContain("chunk-42");
    expect(result).toContain("Body text");
  });
});

// ============================================================================
// createJSONFileStore
// ============================================================================

describe("createJSONFileStore", () => {
  const sampleChunks: RAGChunk[] = [
    chunk("f1", "File content 1", [1, 0, 0]),
    chunk("f2", "File content 2", [0, 1, 0]),
  ];

  it("getChunks() loads from file", async () => {
    const mockReadFile = vi.fn(async () => JSON.stringify(sampleChunks));
    vi.doMock("node:fs", () => ({
      promises: { readFile: mockReadFile },
    }));

    const store = createJSONFileStore({ filePath: "/data/chunks.json" });
    const chunks = await store.getChunks();

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.id).toBe("f1");
    expect(chunks[1]!.id).toBe("f2");

    vi.doUnmock("node:fs");
  });

  it("size() returns chunk count", async () => {
    const mockReadFile = vi.fn(async () => JSON.stringify(sampleChunks));
    vi.doMock("node:fs", () => ({
      promises: { readFile: mockReadFile },
    }));

    const store = createJSONFileStore({ filePath: "/data/chunks.json" });
    const count = await store.size();

    expect(count).toBe(2);

    vi.doUnmock("node:fs");
  });

  it("reload() clears cache and re-reads", async () => {
    let callCount = 0;
    const batch1 = [chunk("a", "first", [1, 0, 0])];
    const batch2 = [chunk("a", "first", [1, 0, 0]), chunk("b", "second", [0, 1, 0])];

    const mockReadFile = vi.fn(async () => {
      callCount++;

      return JSON.stringify(callCount === 1 ? batch1 : batch2);
    });
    vi.doMock("node:fs", () => ({
      promises: { readFile: mockReadFile },
    }));

    const store = createJSONFileStore({ filePath: "/data/chunks.json" });

    const first = await store.getChunks();
    expect(first).toHaveLength(1);

    await store.reload!();
    const second = await store.getChunks();
    expect(second).toHaveLength(2);

    expect(mockReadFile).toHaveBeenCalledTimes(2);

    vi.doUnmock("node:fs");
  });

  it("dispose() clears cache", async () => {
    const mockReadFile = vi.fn(async () => JSON.stringify(sampleChunks));
    vi.doMock("node:fs", () => ({
      promises: { readFile: mockReadFile },
    }));

    const store = createJSONFileStore({ filePath: "/data/chunks.json" });

    // Load once
    await store.getChunks();
    expect(mockReadFile).toHaveBeenCalledTimes(1);

    // Dispose and reload — should trigger a fresh read
    store.dispose!();
    await store.getChunks();
    expect(mockReadFile).toHaveBeenCalledTimes(2);

    vi.doUnmock("node:fs");
  });
});
