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
 * } from '@directive-run/ai';
 *
 * const enricher = createRAGEnricher({
 *   embedder: myEmbedder, // Provide your own EmbedderFn
 *   storage: createJSONFileStore({ filePath: './embeddings.json' }),
 * });
 *
 * const enrichedInput = await enricher.enrich('How do constraints work?', {
 *   prefix: 'User is viewing: /docs/constraints',
 *   history: [{ role: 'user', content: 'Hello' }],
 * });
 * ```
 */

import { cosineSimilarity } from "./guardrails/semantic-cache.js";
import type { EmbedderFn, Embedding } from "./guardrails/semantic-cache.js";

// ============================================================================
// Types
// ============================================================================

/** A document chunk with embedding and metadata */
export interface RAGChunk {
  id: string;
  content: string;
  embedding: Embedding;
  metadata: Record<string, unknown>;
}

/** Pluggable storage backend */
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

      cached = mapEntry ? raw.map(mapEntry) : (raw as unknown as RAGChunk[]);

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
