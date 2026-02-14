/**
 * Semantic Caching Guardrail
 *
 * Caches agent responses based on semantic similarity to reduce redundant LLM calls.
 * Uses vector embeddings to find semantically similar previous queries.
 *
 * @example
 * ```typescript
 * import { createSemanticCacheGuardrail } from '@directive-run/ai';
 *
 * const cacheGuardrail = createSemanticCacheGuardrail({
 *   embedder: async (text) => {
 *     // Use your embedding model (OpenAI, local model, etc.)
 *     return await getEmbedding(text);
 *   },
 *   similarityThreshold: 0.95,
 *   maxCacheSize: 1000,
 *   ttlMs: 3600000, // 1 hour
 * });
 *
 * const orchestrator = createAgentOrchestrator({
 *   guardrails: {
 *     input: [cacheGuardrail],
 *   },
 *   runner: run,
 * });
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/** Vector embedding (array of numbers) */
export type Embedding = number[];

/** Function to generate embeddings for text */
export type EmbedderFn = (text: string) => Promise<Embedding>;

/** Cached response entry */
export interface CacheEntry {
  id: string;
  query: string;
  queryEmbedding: Embedding;
  response: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  agentName?: string;
}

/** Cache lookup result */
export interface CacheLookupResult {
  hit: boolean;
  entry?: CacheEntry;
  similarity?: number;
  latencyMs: number;
}

/** Semantic cache configuration */
export interface SemanticCacheConfig {
  /** Function to generate embeddings */
  embedder: EmbedderFn;
  /** Similarity threshold (0.0 to 1.0) for cache hits */
  similarityThreshold?: number;
  /** Maximum number of entries to cache */
  maxCacheSize?: number;
  /** Time-to-live in milliseconds for cache entries */
  ttlMs?: number;
  /** Cache namespace for multi-tenant scenarios */
  namespace?: string;
  /** Custom storage backend (defaults to in-memory) */
  storage?: SemanticCacheStorage;
  /** Callback when cache hit occurs */
  onHit?: (entry: CacheEntry, similarity: number) => void;
  /** Callback when cache miss occurs */
  onMiss?: (query: string) => void;
  /** Callback when cache lookup encounters an error */
  onError?: (error: Error) => void;
  /** Whether to include agent name in cache key */
  perAgent?: boolean;
}

/** Storage interface for cache backends */
export interface SemanticCacheStorage {
  /** Get all entries for a namespace */
  getEntries(namespace: string): Promise<CacheEntry[]>;
  /** Add an entry to the cache */
  addEntry(namespace: string, entry: CacheEntry): Promise<void>;
  /** Update an entry (e.g., access count) */
  updateEntry(namespace: string, id: string, updates: Partial<CacheEntry>): Promise<void>;
  /** Remove an entry */
  removeEntry(namespace: string, id: string): Promise<void>;
  /** Clear all entries in a namespace */
  clear(namespace: string): Promise<void>;
}

/** Semantic cache instance */
export interface SemanticCache {
  /** Look up a query in the cache */
  lookup(query: string, agentName?: string): Promise<CacheLookupResult>;
  /** Store a response in the cache */
  store(query: string, response: string, agentName?: string, metadata?: Record<string, unknown>): Promise<void>;
  /** Invalidate cache entries matching a predicate */
  invalidate(predicate: (entry: CacheEntry) => boolean): Promise<number>;
  /** Clear all cache entries */
  clear(): Promise<void>;
  /** Get cache statistics */
  getStats(): CacheStats;
  /** Export cache entries (for persistence) */
  export(): Promise<CacheEntry[]>;
  /** Import cache entries (from persistence) */
  import(entries: CacheEntry[]): Promise<void>;
}

/** Cache statistics */
export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  avgSimilarityOnHit: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

// ============================================================================
// Vector Math Utilities
// ============================================================================

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!; // Safe: i is within bounds
    const bi = b[i]!; // Safe: dimensions match and i is within bounds
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Find the most similar entries to a query embedding.
 */
function findSimilar(
  queryEmbedding: Embedding,
  entries: CacheEntry[],
  threshold: number,
  agentName?: string
): { entry: CacheEntry; similarity: number } | null {
  let bestMatch: { entry: CacheEntry; similarity: number } | null = null;

  for (const entry of entries) {
    // Filter by agent if specified
    if (agentName && entry.agentName && entry.agentName !== agentName) {
      continue;
    }

    const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);

    if (similarity >= threshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { entry, similarity };
      }
    }
  }

  return bestMatch;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * Create an in-memory cache storage backend.
 */
export function createInMemoryStorage(): SemanticCacheStorage {
  const storage = new Map<string, Map<string, CacheEntry>>();

  function getNamespace(namespace: string): Map<string, CacheEntry> {
    let ns = storage.get(namespace);
    if (!ns) {
      ns = new Map();
      storage.set(namespace, ns);
    }
    return ns;
  }

  return {
    async getEntries(namespace: string): Promise<CacheEntry[]> {
      return Array.from(getNamespace(namespace).values());
    },

    async addEntry(namespace: string, entry: CacheEntry): Promise<void> {
      getNamespace(namespace).set(entry.id, entry);
    },

    async updateEntry(namespace: string, id: string, updates: Partial<CacheEntry>): Promise<void> {
      const ns = getNamespace(namespace);
      const entry = ns.get(id);
      if (entry) {
        ns.set(id, { ...entry, ...updates });
      }
    },

    async removeEntry(namespace: string, id: string): Promise<void> {
      getNamespace(namespace).delete(id);
    },

    async clear(namespace: string): Promise<void> {
      storage.delete(namespace);
    },
  };
}

// ============================================================================
// Semantic Cache Factory
// ============================================================================

/**
 * Create a semantic cache instance.
 *
 * @example
 * ```typescript
 * const cache = createSemanticCache({
 *   embedder: async (text) => {
 *     const response = await openai.embeddings.create({
 *       model: 'text-embedding-3-small',
 *       input: text,
 *     });
 *     return response.data[0].embedding;
 *   },
 *   similarityThreshold: 0.92,
 *   maxCacheSize: 500,
 *   ttlMs: 3600000, // 1 hour
 * });
 *
 * // Check cache before calling agent
 * const result = await cache.lookup(userQuery);
 * if (result.hit) {
 *   return result.entry!.response;
 * }
 *
 * // Call agent and cache response
 * const response = await runAgent(userQuery);
 * await cache.store(userQuery, response);
 * ```
 */
export function createSemanticCache(config: SemanticCacheConfig): SemanticCache {
  const {
    embedder,
    similarityThreshold = 0.9,
    maxCacheSize = 1000,
    ttlMs = 3600000, // 1 hour default
    namespace = "default",
    storage = createInMemoryStorage(),
    onHit,
    onMiss,
    onError,
    perAgent = false,
  } = config;

  // Statistics
  let stats: CacheStats = {
    totalEntries: 0,
    totalHits: 0,
    totalMisses: 0,
    hitRate: 0,
    avgSimilarityOnHit: 0,
    oldestEntry: null,
    newestEntry: null,
  };

  let totalSimilaritySum = 0;

  function updateStats(entries: CacheEntry[]): void {
    stats.totalEntries = entries.length;
    stats.hitRate =
      stats.totalHits + stats.totalMisses > 0
        ? stats.totalHits / (stats.totalHits + stats.totalMisses)
        : 0;
    stats.avgSimilarityOnHit =
      stats.totalHits > 0 ? totalSimilaritySum / stats.totalHits : 0;

    if (entries.length > 0) {
      const times = entries.map((e) => e.createdAt);
      stats.oldestEntry = Math.min(...times);
      stats.newestEntry = Math.max(...times);
    } else {
      stats.oldestEntry = null;
      stats.newestEntry = null;
    }
  }

  async function evictExpiredAndExcess(): Promise<void> {
    const entries = await storage.getEntries(namespace);
    const now = Date.now();

    // Remove expired entries
    for (const entry of entries) {
      if (now - entry.createdAt > ttlMs) {
        await storage.removeEntry(namespace, entry.id);
      }
    }

    // Get fresh list after expiration
    const remainingEntries = await storage.getEntries(namespace);

    // Remove oldest entries if over max size (LRU based on accessedAt)
    if (remainingEntries.length > maxCacheSize) {
      const sorted = remainingEntries.sort((a, b) => a.accessedAt - b.accessedAt);
      const toRemove = sorted.slice(0, remainingEntries.length - maxCacheSize);
      for (const entry of toRemove) {
        await storage.removeEntry(namespace, entry.id);
      }
    }
  }

  return {
    async lookup(query: string, agentName?: string): Promise<CacheLookupResult> {
      const start = Date.now();

      try {
        // Generate embedding for query
        const queryEmbedding = await embedder(query);

        // Get all entries
        const entries = await storage.getEntries(namespace);

        // Find similar entry
        const match = findSimilar(
          queryEmbedding,
          entries,
          similarityThreshold,
          perAgent ? agentName : undefined
        );

        if (match) {
          // Update access stats
          await storage.updateEntry(namespace, match.entry.id, {
            accessedAt: Date.now(),
            accessCount: match.entry.accessCount + 1,
          });

          stats.totalHits++;
          totalSimilaritySum += match.similarity;
          updateStats(entries);

          onHit?.(match.entry, match.similarity);

          return {
            hit: true,
            entry: match.entry,
            similarity: match.similarity,
            latencyMs: Date.now() - start,
          };
        }

        stats.totalMisses++;
        updateStats(entries);

        onMiss?.(query);

        return {
          hit: false,
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        // On error, treat as cache miss
        stats.totalMisses++;
        onError?.(error instanceof Error ? error : new Error(String(error)));
        return {
          hit: false,
          latencyMs: Date.now() - start,
        };
      }
    },

    async store(
      query: string,
      response: string,
      agentName?: string,
      metadata: Record<string, unknown> = {}
    ): Promise<void> {
      // Generate embedding
      const queryEmbedding = await embedder(query);

      const entry: CacheEntry = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        query,
        queryEmbedding,
        response,
        metadata,
        createdAt: Date.now(),
        accessedAt: Date.now(),
        accessCount: 0,
        agentName: perAgent ? agentName : undefined,
      };

      await storage.addEntry(namespace, entry);

      // Evict if necessary
      await evictExpiredAndExcess();

      const entries = await storage.getEntries(namespace);
      updateStats(entries);
    },

    async invalidate(predicate: (entry: CacheEntry) => boolean): Promise<number> {
      const entries = await storage.getEntries(namespace);
      let removed = 0;

      for (const entry of entries) {
        if (predicate(entry)) {
          await storage.removeEntry(namespace, entry.id);
          removed++;
        }
      }

      const remainingEntries = await storage.getEntries(namespace);
      updateStats(remainingEntries);

      return removed;
    },

    async clear(): Promise<void> {
      await storage.clear(namespace);
      stats = {
        totalEntries: 0,
        totalHits: 0,
        totalMisses: 0,
        hitRate: 0,
        avgSimilarityOnHit: 0,
        oldestEntry: null,
        newestEntry: null,
      };
      totalSimilaritySum = 0;
    },

    getStats(): CacheStats {
      return { ...stats };
    },

    async export(): Promise<CacheEntry[]> {
      return storage.getEntries(namespace);
    },

    async import(entries: CacheEntry[]): Promise<void> {
      for (const entry of entries) {
        await storage.addEntry(namespace, entry);
      }
      await evictExpiredAndExcess();
      const allEntries = await storage.getEntries(namespace);
      updateStats(allEntries);
    },
  };
}

// ============================================================================
// Guardrail Integration
// ============================================================================

/** Input guardrail data for semantic cache */
export interface SemanticCacheGuardrailData {
  input: string;
  agentName?: string;
}

/**
 * Result of semantic cache guardrail.
 *
 * **Important semantics:**
 * - `passed: false` + `cacheHit: true` = Short-circuit with cached response (not an error!)
 * - `passed: true` + `cacheHit: false` = No cache hit, proceed with agent call
 *
 * The `passed: false` follows guardrail convention where "not passing" stops the flow,
 * but in this case stopping is desirable (returning cached data is good).
 */
export interface SemanticCacheGuardrailResult {
  /**
   * Whether to proceed with the agent call.
   * `false` means short-circuit with cached response (this is good, not an error).
   * `true` means no cache hit, proceed with agent.
   */
  passed: boolean;
  /** Indicates whether this was a cache hit */
  cacheHit: boolean;
  /** Reason for the result */
  reason?: string;
  /** The cached response (only present on cache hit) */
  cachedResponse?: string;
  /** Similarity score (0-1) of the cache hit */
  similarity?: number;
}

/**
 * Create a semantic caching input guardrail.
 *
 * **How it works:**
 * - On cache HIT: Returns `{ passed: false, cacheHit: true, cachedResponse: "..." }`
 *   The orchestrator should detect `cacheHit: true` and return the cached response.
 * - On cache MISS: Returns `{ passed: true, cacheHit: false }`
 *   Proceed with normal agent execution.
 *
 * **Important:** `passed: false` with `cacheHit: true` is SUCCESS, not failure.
 * The guardrail "short-circuits" the flow to return cached data efficiently.
 *
 * @example
 * ```typescript
 * const cacheGuardrail = createSemanticCacheGuardrail({
 *   cache: mySemanticCache,
 * });
 *
 * const orchestrator = createAgentOrchestrator({
 *   guardrails: {
 *     input: [
 *       {
 *         name: 'semantic-cache',
 *         fn: cacheGuardrail,
 *       },
 *     ],
 *   },
 *   runner: run,
 * });
 *
 * // In your orchestrator wrapper, check for cache hits:
 * const guardrailResult = await cacheGuardrail({ input: userQuery });
 * if (guardrailResult.cacheHit) {
 *   return guardrailResult.cachedResponse; // Fast path!
 * }
 * // Otherwise proceed with agent call...
 * ```
 */
export function createSemanticCacheGuardrail(config: {
  cache: SemanticCache;
}): (data: SemanticCacheGuardrailData) => Promise<SemanticCacheGuardrailResult> {
  const { cache } = config;

  return async (data: SemanticCacheGuardrailData): Promise<SemanticCacheGuardrailResult> => {
    const result = await cache.lookup(data.input, data.agentName);

    if (result.hit && result.entry) {
      return {
        passed: false, // Short-circuit: don't proceed to agent
        cacheHit: true,
        reason: `Cache hit (similarity: ${(result.similarity! * 100).toFixed(1)}%)`,
        cachedResponse: result.entry.response,
        similarity: result.similarity,
      };
    }

    return {
      passed: true, // No cache hit, proceed with agent call
      cacheHit: false,
    };
  };
}

// ============================================================================
// Embedding Utilities
// ============================================================================

/**
 * Create a simple hash-based "embedder" for testing.
 * NOT suitable for production - use a real embedding model.
 */
export function createTestEmbedder(dimensions = 128): EmbedderFn {
  return async (text: string): Promise<Embedding> => {
    const embedding = new Array(dimensions).fill(0);

    // Simple hash-based embedding for testing
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i % dimensions] += charCode / 256;
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  };
}

/** Batched embedder instance with dispose capability */
export interface BatchedEmbedder {
  /** Embed a single text (batched internally) */
  embed: EmbedderFn;
  /** Flush any pending batch immediately */
  flush(): Promise<void>;
  /** Dispose of the embedder, clearing timers and rejecting pending requests */
  dispose(): void;
}

/**
 * Create a batched embedder that groups multiple texts into single API calls.
 *
 * **BREAKING CHANGE:** Previously returned `EmbedderFn` directly. Now returns
 * a `BatchedEmbedder` object with `embed`, `flush`, and `dispose` methods.
 *
 * To migrate: `const embed = createBatchedEmbedder(...)` becomes
 * `const { embed } = createBatchedEmbedder(...)`.
 *
 * @example
 * ```typescript
 * const batchedEmbedder = createBatchedEmbedder({
 *   batchSize: 20,
 *   embedBatch: async (texts) => {
 *     const response = await openai.embeddings.create({
 *       model: 'text-embedding-3-small',
 *       input: texts,
 *     });
 *     return response.data.map(d => d.embedding);
 *   },
 *   maxWaitMs: 50,
 * });
 *
 * // Use the embedder
 * const embedding = await batchedEmbedder.embed("Hello world");
 *
 * // Clean up when done
 * batchedEmbedder.dispose();
 * ```
 */
export function createBatchedEmbedder(config: {
  batchSize?: number;
  embedBatch: (texts: string[]) => Promise<Embedding[]>;
  maxWaitMs?: number;
}): BatchedEmbedder {
  const { batchSize = 20, embedBatch, maxWaitMs = 50 } = config;

  if (batchSize < 1 || !Number.isFinite(batchSize)) {
    throw new Error(`[Directive SemanticCache] batchSize must be >= 1, got ${batchSize}`);
  }

  let pendingBatch: Array<{
    text: string;
    resolve: (embedding: Embedding) => void;
    reject: (error: Error) => void;
  }> = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let isDisposed = false;

  async function flushBatch(): Promise<void> {
    if (pendingBatch.length === 0) return;

    const batch = pendingBatch;
    pendingBatch = [];

    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }

    try {
      const texts = batch.map((item) => item.text);
      const embeddings = await embedBatch(texts);

      if (embeddings.length !== batch.length) {
        throw new Error(
          `[Directive SemanticCache] embedBatch returned ${embeddings.length} embeddings for ${batch.length} texts. ` +
          `The embedBatch function must return exactly one embedding per input text.`
        );
      }

      for (let i = 0; i < batch.length; i++) {
        batch[i]!.resolve(embeddings[i]!);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      for (const item of batch) {
        item.reject(err);
      }
    }
  }

  return {
    async embed(text: string): Promise<Embedding> {
      if (isDisposed) {
        throw new Error("BatchedEmbedder has been disposed");
      }

      return new Promise((resolve, reject) => {
        pendingBatch.push({ text, resolve, reject });

        if (pendingBatch.length >= batchSize) {
          flushBatch();
        } else if (!batchTimer) {
          batchTimer = setTimeout(flushBatch, maxWaitMs);
        }
      });
    },

    async flush(): Promise<void> {
      await flushBatch();
    },

    dispose(): void {
      isDisposed = true;

      // Clear timer
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }

      // Reject pending requests
      const batch = pendingBatch;
      pendingBatch = [];
      const err = new Error("BatchedEmbedder disposed");
      for (const item of batch) {
        item.reject(err);
      }
    },
  };
}
