/**
 * Approximate Nearest Neighbor (ANN) Index for Semantic Cache
 *
 * Provides pluggable vector search backends for efficient similarity lookups.
 * Includes a brute-force exact search and a VP-tree (Vantage Point Tree) for
 * fast approximate nearest neighbor queries.
 *
 * @example
 * ```typescript
 * import { createSemanticCache } from '@directive-run/ai';
 * import { createVPTreeIndex } from '@directive-run/ai';
 *
 * const index = createVPTreeIndex();
 *
 * const cache = createSemanticCache({
 *   embedder: myEmbedder,
 *   annIndex: index,
 * });
 * ```
 */

import type { Embedding } from "./semantic-cache.js";
import { cosineSimilarity } from "./semantic-cache.js";

// ============================================================================
// Types
// ============================================================================

/** Search result from an ANN index */
export interface ANNSearchResult {
  /** ID of the matched item */
  id: number;
  /** Similarity score (0-1, higher is more similar) */
  similarity: number;
}

/** ANN Index interface - pluggable vector search backend */
export interface ANNIndex {
  /** Add a vector to the index */
  add(id: number, embedding: Embedding): void;
  /** Remove a vector from the index */
  remove(id: number): void;
  /** Search for the k nearest neighbors */
  search(query: Embedding, k: number, threshold?: number): ANNSearchResult[];
  /** Rebuild the index (call after batch additions) */
  rebuild(): void;
  /** Get the number of indexed vectors */
  size(): number;
  /** Clear the index */
  clear(): void;
  /** Check if the index needs to be rebuilt (e.g., after additions/removals) */
  needsRebuild(): boolean;
}

// ============================================================================
// Brute Force Index (Exact Search)
// ============================================================================

/**
 * Create a brute-force exact search index.
 *
 * O(n) search, O(1) add/remove. Best for small collections (< 10,000 vectors).
 *
 * @example
 * ```typescript
 * const index = createBruteForceIndex();
 * index.add(0, [0.1, 0.2, 0.3]);
 * index.add(1, [0.4, 0.5, 0.6]);
 *
 * const results = index.search([0.1, 0.2, 0.3], 1);
 * // [{ id: 0, similarity: 1.0 }]
 * ```
 */
export function createBruteForceIndex(): ANNIndex {
  const vectors = new Map<number, Embedding>();
  let expectedDimension: number | null = null;

  function validateDimension(embedding: Embedding): void {
    if (expectedDimension === null) {
      expectedDimension = embedding.length;
    } else if (embedding.length !== expectedDimension) {
      throw new Error(
        `[Directive ANNIndex] Dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
      );
    }
  }

  return {
    add(id: number, embedding: Embedding): void {
      validateDimension(embedding);
      vectors.set(id, embedding);
    },

    remove(id: number): void {
      vectors.delete(id);
    },

    search(query: Embedding, k: number, threshold = 0): ANNSearchResult[] {
      if (expectedDimension !== null && query.length !== expectedDimension) {
        throw new Error(
          `[Directive ANNIndex] Query dimension mismatch: expected ${expectedDimension}, got ${query.length}`,
        );
      }
      const results: ANNSearchResult[] = [];

      for (const [id, embedding] of vectors) {
        const similarity = cosineSimilarity(query, embedding);
        if (similarity >= threshold) {
          results.push({ id, similarity });
        }
      }

      // Sort by similarity descending, take top k
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, k);
    },

    rebuild(): void {
      // No-op for brute force
    },

    size(): number {
      return vectors.size;
    },

    clear(): void {
      vectors.clear();
      expectedDimension = null;
    },

    needsRebuild(): boolean {
      return false; // Brute force doesn't need rebuilding
    },
  };
}

// ============================================================================
// VP-Tree Index (Approximate Search)
// ============================================================================

interface VPNode {
  id: number;
  embedding: Embedding;
  mu: number; // Median distance
  left: VPNode | null;
  right: VPNode | null;
}

function cosineDistance(a: Embedding, b: Embedding): number {
  return 1 - cosineSimilarity(a, b);
}

/** VP-Tree index configuration */
export interface VPTreeIndexConfig {
  /** Optional random number generator for deterministic builds. Returns a number in [0, 1). */
  random?: () => number;
}

function buildVPTree(
  items: Array<{ id: number; embedding: Embedding }>,
  random: () => number,
): VPNode | null {
  if (items.length === 0) return null;

  // Pick a random vantage point
  const vpIdx = Math.floor(random() * items.length);
  const vp = items[vpIdx]!;
  const rest = items.filter((_, i) => i !== vpIdx);

  if (rest.length === 0) {
    return {
      id: vp.id,
      embedding: vp.embedding,
      mu: 0,
      left: null,
      right: null,
    };
  }

  // Calculate distances from vantage point
  const distances = rest.map((item) => ({
    item,
    distance: cosineDistance(vp.embedding, item.embedding),
  }));

  // Find median distance
  distances.sort((a, b) => a.distance - b.distance);
  const medianIdx = Math.floor(distances.length / 2);
  const mu = distances[medianIdx]!.distance;

  const leftItems = distances.slice(0, medianIdx).map((d) => d.item);
  const rightItems = distances.slice(medianIdx).map((d) => d.item);

  return {
    id: vp.id,
    embedding: vp.embedding,
    mu,
    left: buildVPTree(leftItems, random),
    right: buildVPTree(rightItems, random),
  };
}

function searchVPTree(
  node: VPNode | null,
  query: Embedding,
  k: number,
  threshold: number,
  results: ANNSearchResult[],
  maxDist: { value: number },
): void {
  if (!node) return;

  const dist = cosineDistance(query, node.embedding);
  const similarity = 1 - dist;

  if (similarity >= threshold) {
    results.push({ id: node.id, similarity });
    results.sort((a, b) => b.similarity - a.similarity);

    if (results.length > k) {
      results.pop();
    }

    if (results.length === k) {
      maxDist.value = 1 - results[results.length - 1]!.similarity;
    }
  }

  // Determine which subtrees to search
  if (dist < node.mu) {
    // Query is inside the ball: search left (inside) first
    searchVPTree(node.left, query, k, threshold, results, maxDist);
    // Only search right if the distance boundary overlaps
    if (dist + maxDist.value >= node.mu) {
      searchVPTree(node.right, query, k, threshold, results, maxDist);
    }
  } else {
    // Query is outside the ball: search right (outside) first
    searchVPTree(node.right, query, k, threshold, results, maxDist);
    // Only search left if the distance boundary overlaps
    if (dist - maxDist.value <= node.mu) {
      searchVPTree(node.left, query, k, threshold, results, maxDist);
    }
  }
}

/**
 * Create a VP-Tree (Vantage Point Tree) index for efficient approximate nearest neighbor search.
 *
 * O(log n) search on average, requires rebuild after batch additions.
 * Best for medium collections (1,000 - 100,000 vectors).
 *
 * @example
 * ```typescript
 * const index = createVPTreeIndex();
 *
 * // Add vectors
 * for (let i = 0; i < embeddings.length; i++) {
 *   index.add(i, embeddings[i]);
 * }
 *
 * // Build the tree
 * index.rebuild();
 *
 * // Search
 * const results = index.search(queryEmbedding, 5, 0.9);
 * ```
 */
export function createVPTreeIndex(vpConfig: VPTreeIndexConfig = {}): ANNIndex {
  const { random = Math.random } = vpConfig;
  const items = new Map<number, Embedding>();
  let root: VPNode | null = null;
  let needsRebuild = false;
  let expectedDimension: number | null = null;

  function validateDimension(embedding: Embedding): void {
    if (expectedDimension === null) {
      expectedDimension = embedding.length;
    } else if (embedding.length !== expectedDimension) {
      throw new Error(
        `[Directive ANNIndex] Dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
      );
    }
  }

  return {
    add(id: number, embedding: Embedding): void {
      validateDimension(embedding);
      items.set(id, embedding);
      needsRebuild = true;
    },

    remove(id: number): void {
      items.delete(id);
      needsRebuild = true;
    },

    search(query: Embedding, k: number, threshold = 0): ANNSearchResult[] {
      if (expectedDimension !== null && query.length !== expectedDimension) {
        throw new Error(
          `[Directive ANNIndex] Query dimension mismatch: expected ${expectedDimension}, got ${query.length}`,
        );
      }
      if (needsRebuild || !root) {
        // Fall back to brute force if tree is stale
        const results: ANNSearchResult[] = [];
        for (const [id, embedding] of items) {
          const similarity = cosineSimilarity(query, embedding);
          if (similarity >= threshold) {
            results.push({ id, similarity });
          }
        }
        results.sort((a, b) => b.similarity - a.similarity);
        return results.slice(0, k);
      }

      const results: ANNSearchResult[] = [];
      const maxDist = { value: Number.POSITIVE_INFINITY };
      searchVPTree(root, query, k, threshold, results, maxDist);
      return results;
    },

    rebuild(): void {
      const itemArray = Array.from(items.entries()).map(([id, embedding]) => ({
        id,
        embedding,
      }));
      root = buildVPTree(itemArray, random);
      needsRebuild = false;
    },

    size(): number {
      return items.size;
    },

    clear(): void {
      items.clear();
      root = null;
      needsRebuild = false;
      expectedDimension = null;
    },

    needsRebuild(): boolean {
      return needsRebuild;
    },
  };
}
