/**
 * Build-time embedding generation for the AI docs chatbot.
 *
 * Two-phase pipeline:
 *   Phase 1: Extract sections from Markdoc doc pages, chunk by paragraph
 *   Phase 2: Read generated API reference (from extract-api-docs.ts), chunk per symbol
 *
 * Then embeds all chunks via OpenAI text-embedding-3-small and writes
 * the result to public/embeddings.json.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/generate-embeddings.ts
 *
 * Or via package.json:
 *   pnpm build:api-docs && pnpm build:embeddings
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "fast-glob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceType = "guide" | "api-reference" | "blog";

interface EmbeddingEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    url: string;
    title: string;
    section: string;
    sourceType: SourceType;
    symbolName?: string;
    symbolKind?: string;
    module?: string;
  };
}

interface Section {
  title: string;
  hash: string | null;
  paragraphs: string[];
}

/** Matches the ApiDocEntry shape from extract-api-docs.ts */
interface ApiDocEntry {
  name: string;
  kind: string;
  module: string;
  file: string;
  signature?: string;
  description: string;
  params?: Array<{ name: string; type: string; description: string }>;
  returns?: { type: string; description: string };
  examples?: string[];
  tags?: Record<string, string>;
  methods?: Array<{
    name: string;
    signature: string;
    description: string;
    params?: Array<{ name: string; type: string; description: string }>;
    returns?: { type: string; description: string };
  }>;
}

// ---------------------------------------------------------------------------
// Markdoc AST Helpers
// ---------------------------------------------------------------------------

/** Simple counter-based slugify (good enough for hashes) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/** Extract text content from a Markdoc AST node */
function nodeToString(node: any): string {
  let str =
    node.type === "text" && typeof node.attributes?.content === "string"
      ? node.attributes.content
      : "";
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      str += nodeToString(child);
    }
  }
  return str;
}

/** Extract code block content from a Markdoc AST node */
function extractCodeBlocks(node: any, blocks: string[]): void {
  if (node.type === "fence" && typeof node.attributes?.content === "string") {
    const lang = node.attributes.language ?? "";
    blocks.push(`\`\`\`${lang}\n${node.attributes.content.trim()}\n\`\`\``);
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      extractCodeBlocks(child, blocks);
    }
  }
}

/**
 * Extract sections from a Markdoc AST.
 * Mirrors the logic in search.mjs but also captures code blocks.
 */
function extractSections(node: any, sections: Section[], isRoot = true): void {
  if (node.type === "heading" || node.type === "paragraph") {
    const content = nodeToString(node).trim();
    if (node.type === "heading" && (node.attributes?.level ?? 99) <= 2) {
      if (content) {
        const hash = node.attributes?.id ?? slugify(content);
        sections.push({ title: content, hash, paragraphs: [] });
      }
    } else {
      if (sections.length > 0 && content) {
        sections[sections.length - 1].paragraphs.push(content);
      }
    }
  } else if (node.type === "fence") {
    // Capture code blocks as part of the current section
    if (sections.length > 0 && typeof node.attributes?.content === "string") {
      const lang = node.attributes.language ?? "";
      const code = `\`\`\`${lang}\n${node.attributes.content.trim()}\n\`\`\``;
      sections[sections.length - 1].paragraphs.push(code);
    }
  } else if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      extractSections(child, sections, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

// OpenAI's tokenizer averages ~4 chars/token for English prose + code.
// We use this approximation to avoid pulling in a full tokenizer dependency.
// Bumped to 600 from 400 — code-heavy chunks are denser than prose.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_CHUNK_TOKENS = 600;
const MIN_CHUNK_TOKENS = 50;

interface Chunk {
  content: string;
  url: string;
  title: string;
  section: string;
  sourceType: SourceType;
  symbolName?: string;
  symbolKind?: string;
  module?: string;
}

/** Classify a page URL into a source type */
function classifySourceType(url: string): SourceType {
  if (url.startsWith("/blog/")) return "blog";
  if (url.startsWith("/docs/api/")) return "api-reference";

  return "guide";
}

function chunkSection(
  pageUrl: string,
  pageTitle: string,
  section: Section,
): Chunk[] {
  const sectionUrl = pageUrl + (section.hash ? `#${section.hash}` : "");
  const sectionTitle = section.title;
  const sourceType = classifySourceType(pageUrl);

  // Combine title + paragraphs
  const fullText = [sectionTitle, ...section.paragraphs].join("\n\n");
  const tokens = estimateTokens(fullText);

  // If it fits in one chunk, use it
  if (tokens <= MAX_CHUNK_TOKENS) {
    if (tokens < MIN_CHUNK_TOKENS) return []; // too small to be useful
    return [
      {
        content: fullText,
        url: sectionUrl,
        title: pageTitle,
        section: sectionTitle,
        sourceType,
      },
    ];
  }

  // Split into multiple chunks at paragraph boundaries
  const chunks: Chunk[] = [];
  let currentParagraphs: string[] = [sectionTitle];
  let currentTokens = estimateTokens(sectionTitle);

  for (const para of section.paragraphs) {
    const paraTokens = estimateTokens(para);

    if (
      currentTokens + paraTokens > MAX_CHUNK_TOKENS &&
      currentParagraphs.length > 1
    ) {
      chunks.push({
        content: currentParagraphs.join("\n\n"),
        url: sectionUrl,
        title: pageTitle,
        section: sectionTitle,
        sourceType,
      });
      // Start new chunk with section title for context
      currentParagraphs = [`${sectionTitle} (continued)`];
      currentTokens = estimateTokens(currentParagraphs[0]);
    }

    currentParagraphs.push(para);
    currentTokens += paraTokens;
  }

  // Flush remaining
  if (currentParagraphs.length > 1 && currentTokens >= MIN_CHUNK_TOKENS) {
    chunks.push({
      content: currentParagraphs.join("\n\n"),
      url: sectionUrl,
      title: pageTitle,
      section: sectionTitle,
      sourceType,
    });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Phase 2: API Reference Chunking
// ---------------------------------------------------------------------------

/**
 * Convert an ApiDocEntry to one or more embedding chunks.
 * Each symbol becomes one chunk with a context prefix.
 * If a symbol exceeds MAX_CHUNK_TOKENS, split at @example boundaries.
 */
function chunkAPIEntry(entry: ApiDocEntry): Chunk[] {
  const parts: string[] = [];

  // Context prefix for retrieval
  parts.push(`[Module] ${entry.module}`);
  parts.push(`[${entry.kind}] ${entry.name}`);
  parts.push("");

  if (entry.description) {
    parts.push(entry.description);
    parts.push("");
  }

  if (entry.signature) {
    parts.push("```typescript");
    parts.push(entry.signature);
    parts.push("```");
    parts.push("");
  }

  if (entry.params && entry.params.length > 0) {
    parts.push("Parameters:");
    for (const p of entry.params) {
      parts.push(`- ${p.name}: ${p.description}`);
    }
    parts.push("");
  }

  if (entry.returns) {
    parts.push(`Returns: ${entry.returns.description}`);
    parts.push("");
  }

  if (entry.methods && entry.methods.length > 0) {
    parts.push("Methods:");
    for (const m of entry.methods) {
      parts.push(`- ${m.name}: ${m.description}`);
    }
    parts.push("");
  }

  // Build base content (without examples)
  const baseContent = parts.join("\n");
  const baseTokens = estimateTokens(baseContent);

  // If base already exceeds limit, return as-is (truncated)
  if (
    baseTokens > MAX_CHUNK_TOKENS &&
    (!entry.examples || entry.examples.length === 0)
  ) {
    return [
      {
        content: baseContent.slice(0, MAX_CHUNK_TOKENS * 4),
        url: `/docs/api/core#${entry.name.toLowerCase()}`,
        title: `API: ${entry.name}`,
        section: entry.name,
        sourceType: "api-reference",
        symbolName: entry.name,
        symbolKind: entry.kind,
        module: entry.module,
      },
    ];
  }

  // Add examples
  const exampleParts: string[] = [];
  if (entry.examples && entry.examples.length > 0) {
    for (const ex of entry.examples) {
      if (ex.includes("```")) {
        exampleParts.push(ex);
      } else {
        exampleParts.push(`\`\`\`typescript\n${ex}\n\`\`\``);
      }
    }
  }

  const fullContent =
    exampleParts.length > 0
      ? baseContent + "\nExamples:\n\n" + exampleParts.join("\n\n")
      : baseContent;
  const fullTokens = estimateTokens(fullContent);

  // If it all fits, return one chunk
  if (fullTokens <= MAX_CHUNK_TOKENS) {
    return [
      {
        content: fullContent,
        url: `/docs/api/core#${entry.name.toLowerCase()}`,
        title: `API: ${entry.name}`,
        section: entry.name,
        sourceType: "api-reference",
        symbolName: entry.name,
        symbolKind: entry.kind,
        module: entry.module,
      },
    ];
  }

  // Split: base chunk + example chunks
  const chunks: Chunk[] = [
    {
      content: baseContent,
      url: `/docs/api/core#${entry.name.toLowerCase()}`,
      title: `API: ${entry.name}`,
      section: entry.name,
      sourceType: "api-reference",
      symbolName: entry.name,
      symbolKind: entry.kind,
      module: entry.module,
    },
  ];

  if (exampleParts.length > 0) {
    const exContent =
      `[Module] ${entry.module}\n[${entry.kind}] ${entry.name} – examples\n\n` +
      exampleParts.join("\n\n");
    chunks.push({
      content: exContent.slice(0, MAX_CHUNK_TOKENS * 4),
      url: `/docs/api/core#${entry.name.toLowerCase()}`,
      title: `API: ${entry.name} (examples)`,
      section: `${entry.name} examples`,
      sourceType: "api-reference",
      symbolName: entry.name,
      symbolKind: entry.kind,
      module: entry.module,
    });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Build-time Deduplication
// ---------------------------------------------------------------------------

/**
 * When a symbol appears in both generated API reference AND hand-written
 * /docs/api/* pages, keep only the generated version (it's canonical).
 */
function deduplicateChunks(chunks: Chunk[]): Chunk[] {
  // Collect symbol names from API reference chunks
  const apiSymbols = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.sourceType === "api-reference" && chunk.symbolName) {
      apiSymbols.add(chunk.symbolName.toLowerCase());
    }
  }

  // Filter out hand-written /docs/api/* chunks that duplicate a generated symbol
  return chunks.filter((chunk) => {
    // Keep all non-guide and non-api-url chunks
    if (chunk.sourceType !== "api-reference" || chunk.symbolName) return true;
    // This is a hand-written /docs/api/* chunk — check if its section
    // matches a generated symbol name
    const sectionLower = chunk.section
      .toLowerCase()
      .replace(/[()]/g, "")
      .trim();

    return !apiSymbols.has(sectionLower);
  });
}

// ---------------------------------------------------------------------------
// OpenAI Embedding
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
// OpenAI supports up to 2048 inputs per batch, but 100 keeps each request
// under ~100KB and limits retry blast radius if a batch fails.
const BATCH_SIZE = 100;

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain order
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Graceful skip when OPENAI_API_KEY is not available (CI, local dev)
  if (!OPENAI_API_KEY) {
    console.warn(
      "\n⚠ OPENAI_API_KEY not set — skipping embedding generation.\n" +
        "  The site will build without chatbot search.\n" +
        "  Set OPENAI_API_KEY to generate embeddings.\n",
    );

    return;
  }

  console.log("Generating embeddings for Directive docs...\n");

  // =========================================================================
  // Phase 1: Markdoc doc pages → paragraph chunks
  // =========================================================================

  const pagesDir = path.resolve(__dirname, "../src/app");
  const files = glob.sync("**/page.md", { cwd: pagesDir });
  console.log(`Phase 1: Found ${files.length} doc pages`);

  const Markdoc = await import("@markdoc/markdoc").then((m) => m.default ?? m);

  const allChunks: Chunk[] = [];

  for (const file of files) {
    const url =
      file === "page.md" ? "/" : `/${file.replace(/\/page\.md$/, "")}`;
    const md = fs.readFileSync(path.join(pagesDir, file), "utf8");
    const ast = Markdoc.parse(md);

    // Extract title from frontmatter
    const titleMatch =
      ast.attributes?.frontmatter?.match(/^title:\s*(.*?)\s*$/m);
    const pageTitle = titleMatch?.[1] ?? path.basename(path.dirname(file));

    const sections: Section[] = [
      { title: pageTitle, hash: null, paragraphs: [] },
    ];
    extractSections(ast, sections);

    for (const section of sections) {
      const chunks = chunkSection(url, pageTitle, section);
      allChunks.push(...chunks);
    }
  }

  console.log(`  → ${allChunks.length} doc chunks`);

  // =========================================================================
  // Phase 2: Generated API reference → function-level chunks
  // =========================================================================

  const apiRefPath = path.resolve(
    __dirname,
    "../docs/generated/api-reference.json",
  );

  if (fs.existsSync(apiRefPath)) {
    const apiEntries: ApiDocEntry[] = JSON.parse(
      fs.readFileSync(apiRefPath, "utf-8"),
    );

    let apiChunkCount = 0;
    for (const entry of apiEntries) {
      const chunks = chunkAPIEntry(entry);
      allChunks.push(...chunks);
      apiChunkCount += chunks.length;
    }

    console.log(
      `Phase 2: ${apiEntries.length} API entries → ${apiChunkCount} chunks`,
    );
  } else {
    console.log(
      "Phase 2: No api-reference.json found, skipping (run pnpm build:api-docs first)",
    );
  }

  // =========================================================================
  // Phase 3: Deduplication
  // =========================================================================

  const beforeDedup = allChunks.length;
  const dedupedChunks = deduplicateChunks(allChunks);
  const removed = beforeDedup - dedupedChunks.length;
  if (removed > 0) {
    console.log(`Dedup: removed ${removed} duplicate chunks`);
  }

  console.log(`\nTotal: ${dedupedChunks.length} chunks to embed\n`);

  if (dedupedChunks.length === 0) {
    console.error("No chunks extracted. Check that doc pages exist.");
    process.exit(1);
  }

  // =========================================================================
  // Embed in batches
  // =========================================================================

  const entries: EmbeddingEntry[] = [];
  const totalBatches = Math.ceil(dedupedChunks.length / BATCH_SIZE);

  for (let i = 0; i < dedupedChunks.length; i += BATCH_SIZE) {
    const batch = dedupedChunks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const pct = Math.round((batchNum / totalBatches) * 100);
    console.log(
      `Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks, ${pct}%)...`,
    );

    const embeddings = await embedBatch(batch.map((c) => c.content));

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      entries.push({
        id: `${chunk.url}-${i + j}`,
        content: chunk.content,
        embedding: embeddings[j],
        metadata: {
          url: chunk.url,
          title: chunk.title,
          section: chunk.section,
          sourceType: chunk.sourceType,
          ...(chunk.symbolName ? { symbolName: chunk.symbolName } : {}),
          ...(chunk.symbolKind ? { symbolKind: chunk.symbolKind } : {}),
          ...(chunk.module ? { module: chunk.module } : {}),
        },
      });
    }

    // Rate limit: small delay between batches
    if (i + BATCH_SIZE < dedupedChunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Write to public/embeddings.json
  const outPath = path.resolve(__dirname, "../public/embeddings.json");
  fs.writeFileSync(outPath, JSON.stringify(entries));

  const sizeMB = (
    Buffer.byteLength(JSON.stringify(entries)) /
    (1024 * 1024)
  ).toFixed(2);
  console.log(
    `\nWrote ${entries.length} embeddings to ${outPath} (${sizeMB} MB)`,
  );

  // Summary by source type
  const byType = new Map<string, number>();
  for (const e of entries) {
    const t = e.metadata.sourceType;
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  console.log("\nBy source type:");
  for (const [type, count] of [...byType.entries()].sort()) {
    console.log(`  ${type}: ${count}`);
  }
  console.log("Done!");
}

main().catch((err) => {
  console.error("Failed to generate embeddings:", err);
  process.exit(1);
});
