/**
 * RAG Enricher — Composable retrieval-augmented generation pipeline.
 *
 * Embeds a query, searches a chunk store by cosine similarity, and assembles
 * an enriched input string (context + history + query) for any agent.
 *
 * @example
 * ```typescript
 * import {
 *   createRAGEnricher,
 *   createJSONFileStore,
 *   createOpenAIEmbedder,
 * } from 'directive/ai';
 *
 * const enricher = createRAGEnricher({
 *   embedder: createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
 *   storage: createJSONFileStore({ filePath: './embeddings.json' }),
 * });
 *
 * const enrichedInput = await enricher.enrich('How do constraints work?', {
 *   prefix: 'User is viewing: /docs/constraints',
 *   history: [{ role: 'user', content: 'Hello' }],
 * });
 * ```
 */

import { cosineSimilarity } from "../guardrails/semantic-cache.js";
import type { Embedding, EmbedderFn } from "../guardrails/semantic-cache.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A document chunk with its embedding vector and metadata.
 * This is the atomic unit stored and retrieved by the RAG pipeline.
 */
export interface RAGChunk {
  /** Unique identifier for this chunk (e.g., `"docs/constraints#when-clause"`) */
  id: string;
  /** Plain-text content of the chunk */
  content: string;
  /** Embedding vector (array of floats) for similarity search */
  embedding: Embedding;
  /** Arbitrary metadata (title, section, url, sourceType, symbolName, etc.) */
  metadata: Record<string, unknown>;
}

/**
 * Pluggable storage backend for RAG chunks.
 * Implement `getChunks()` for brute-force search, or add an optimized
 * `search()` method to bypass the full scan.
 */
export interface RAGStorage {
  getChunks(): Promise<RAGChunk[]>;
  size(): Promise<number>;
  /** Optional: optimized vector search (bypasses full getChunks scan) */
  search?(
    query: Embedding,
    topK: number,
    minSimilarity: number,
  ): Promise<Array<RAGChunk & { similarity: number }>>;
  /** Reload storage (clear cache, re-read from source) */
  reload?(): Promise<void>;
  /** Dispose of resources */
  dispose?(): void;
}

/**
 * Configuration for creating a RAG enricher.
 * At minimum, provide an `embedder` function and a `storage` backend.
 */
export interface RAGEnricherConfig {
  /** Function to generate query embeddings */
  embedder: EmbedderFn;
  /** Storage backend for document chunks */
  storage: RAGStorage;
  /** Number of top results to return (default: 5) */
  topK?: number;
  /** Minimum similarity score to include, clamped to [0, 1] (default: 0.3) */
  minSimilarity?: number;
  /** Custom chunk formatter */
  formatChunk?: (chunk: RAGChunk, similarity: number) => string;
  /** Custom context block formatter */
  formatContext?: (formattedChunks: string[], query: string) => string;
  /** Error callback — embedder/storage errors are non-fatal by default */
  onError?: (error: Error) => void;
}

/**
 * Per-call options for `enricher.enrich()`.
 * Override topK, add conversation history, or filter chunks.
 */
export interface RAGEnrichOptions {
  /** Prefix line (e.g. "User is viewing: /docs/constraints") */
  prefix?: string;
  /** Conversation history */
  history?: Array<{ role: string; content: string }>;
  /** Per-call topK override */
  topK?: number;
  /** Filter chunks before ranking (e.g. by metadata tag or section) */
  filter?: (chunk: RAGChunk) => boolean;
}

/**
 * A RAG enricher that retrieves relevant document chunks by cosine
 * similarity and assembles an enriched input string for an LLM agent.
 */
export interface RAGEnricher {
  /** Retrieve relevant chunks for a query */
  retrieve(
    query: string,
    topK?: number,
  ): Promise<Array<RAGChunk & { similarity: number }>>;
  /** Retrieve + format into an enriched input string */
  enrich(input: string, options?: RAGEnrichOptions): Promise<string>;
}

// ============================================================================
// Default Formatters
// ============================================================================

function defaultFormatChunk(chunk: RAGChunk, _similarity: number): string {
  const title = (chunk.metadata.title as string) ?? "";
  const section = (chunk.metadata.section as string) ?? "";
  const url = (chunk.metadata.url as string) ?? "";
  const header =
    title && section && url
      ? `[${title} — ${section}](${url})`
      : title
        ? title
        : chunk.id;
  return `${header}\n${chunk.content}`;
}

function defaultFormatContext(
  formattedChunks: string[],
  _query: string,
): string {
  if (formattedChunks.length === 0) return "";
  return `Relevant documentation context:\n\n${formattedChunks.join("\n\n")}`;
}

// ============================================================================
// Factory
// ============================================================================

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Create a RAG enricher that retrieves relevant document chunks and
 * assembles enriched input for an agent.
 *
 * @param config - Embedder function, storage backend, topK, minSimilarity, and formatters.
 * @returns A `RAGEnricher` with `retrieve()` and `enrich()` methods.
 */
export function createRAGEnricher(config: RAGEnricherConfig): RAGEnricher {
  const {
    embedder,
    storage,
    topK: defaultTopK = 5,
    minSimilarity: rawMinSimilarity = 0.3,
    formatChunk = defaultFormatChunk,
    formatContext = defaultFormatContext,
    onError,
  } = config;

  const minSimilarity = clamp(rawMinSimilarity, 0, 1);

  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "development" &&
    rawMinSimilarity !== minSimilarity
  ) {
    console.warn(
      `[Directive] RAG: minSimilarity ${rawMinSimilarity} clamped to ${minSimilarity} (valid range: 0-1)`,
    );
  }

  async function retrieve(
    query: string,
    topK?: number,
  ): Promise<Array<RAGChunk & { similarity: number }>> {
    const k = Math.max(1, Math.floor(topK ?? defaultTopK));

    // Use optimized search() if the storage backend provides it
    if (storage.search) {
      return storage.search(await embedder(query), k, minSimilarity);
    }

    const queryEmbedding = await embedder(query);
    const chunks = await storage.getChunks();

    const scored = chunks.map((chunk) => ({
      ...chunk,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.filter((c) => c.similarity >= minSimilarity).slice(0, k);
  }

  async function enrich(
    input: string,
    options: RAGEnrichOptions = {},
  ): Promise<string> {
    const { prefix, history, topK, filter } = options;

    let matches: Array<RAGChunk & { similarity: number }> = [];
    try {
      matches = await retrieve(input, topK);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }

    if (filter) {
      matches = matches.filter((m) => filter(m));
    }

    const formattedChunks = matches.map((m) => formatChunk(m, m.similarity));
    const contextBlock = formatContext(formattedChunks, input);

    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    if (contextBlock) parts.push(contextBlock);
    if (history && history.length > 0) {
      const historyBlock = history
        .map(
          (m) =>
            `${m.role.charAt(0).toUpperCase() + m.role.slice(1)}: ${m.content}`,
        )
        .join("\n\n");
      parts.push(`Previous conversation:\n${historyBlock}`);
    }
    parts.push(input);

    return parts.join("\n\n---\n\n");
  }

  return { retrieve, enrich };
}

// ============================================================================
// Built-in Storage: JSON File Store
// ============================================================================

/**
 * Options for the built-in JSON file storage backend.
 * Reads a JSON array of chunks from disk, caches in memory.
 */
export interface JSONFileStoreOptions {
  /** Absolute or relative path to the JSON embeddings file */
  filePath: string;
  /** Optional transform from raw JSON entries to RAGChunk */
  mapEntry?: (entry: Record<string, unknown>) => RAGChunk;
  /** Cache TTL in ms. 0 = cache forever (default) */
  ttlMs?: number;
}

/**
 * Create a RAGStorage backed by a JSON file (lazy-loaded, cached in memory).
 * Uses dynamic `import('node:fs')` for isomorphic safety.
 *
 * @param options - File path, optional entry mapper, and cache TTL.
 * @returns A `RAGStorage` implementation.
 *
 * @example
 * ```typescript
 * const store = createJSONFileStore({
 *   filePath: './public/embeddings.json',
 *   ttlMs: 60_000, // re-read file every minute
 * });
 * ```
 */
export function createJSONFileStore(options: JSONFileStoreOptions): RAGStorage {
  const { filePath, mapEntry, ttlMs = 0 } = options;
  let cached: RAGChunk[] | null = null;
  let cachedAt = 0;

  async function load(): Promise<RAGChunk[]> {
    if (cached && (ttlMs === 0 || Date.now() - cachedAt < ttlMs)) {
      return cached;
    }

    try {
      const fs = await import("node:fs");
      const data = await fs.promises.readFile(filePath, "utf-8");
      const raw = JSON.parse(data) as Record<string, unknown>[];

      cached = mapEntry
        ? raw.map(mapEntry)
        : (raw as unknown as RAGChunk[]);

      cachedAt = Date.now();
      return cached;
    } catch (err) {
      if (
        typeof process !== "undefined" &&
        process.env?.NODE_ENV === "development"
      ) {
        console.warn(
          `[Directive] JSONFileStore: failed to load ${filePath}:`,
          err,
        );
      }
      cached = [];
      cachedAt = Date.now();
      return cached;
    }
  }

  return {
    async getChunks() {
      return load();
    },
    async size() {
      const chunks = await load();
      return chunks.length;
    },
    async reload() {
      cached = null;
      cachedAt = 0;
      await load();
    },
    dispose() {
      cached = null;
      cachedAt = 0;
    },
  };
}

// ============================================================================
// Built-in Embedder: OpenAI
// ============================================================================

/**
 * Options for the built-in OpenAI embedder.
 */
export interface OpenAIEmbedderOptions {
  /** OpenAI API key */
  apiKey: string;
  /** Embedding model (default: "text-embedding-3-small") */
  model?: string;
  /** Output dimensions (default: 1536) */
  dimensions?: number;
  /** API base URL (default: "https://api.openai.com/v1") */
  baseURL?: string;
  /** Custom fetch implementation (default: globalThis.fetch) */
  fetch?: typeof globalThis.fetch;
}

/**
 * Create an EmbedderFn that calls the OpenAI embeddings API.
 *
 * @param options - API key, model, dimensions, base URL, and optional custom fetch.
 * @returns An async function that converts a text string into an embedding vector.
 *
 * @example
 * ```typescript
 * const embedder = createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
 * const embedding = await embedder('How do constraints work?');
 * ```
 */
export function createOpenAIEmbedder(
  options: OpenAIEmbedderOptions,
): EmbedderFn {
  const {
    apiKey,
    model = "text-embedding-3-small",
    dimensions = 1536,
    baseURL = "https://api.openai.com/v1",
    fetch: fetchFn = globalThis.fetch,
  } = options;

  return async (text: string): Promise<Embedding> => {
    const response = await fetchFn(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text, dimensions }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(
        `[Directive] OpenAI embedding failed: ${response.status}${errBody ? ` - ${errBody.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const entry = data.data[0];
    if (!entry) {
      throw new Error(
        "[Directive] OpenAI embedding response contained no data entries",
      );
    }

    return entry.embedding;
  };
}
