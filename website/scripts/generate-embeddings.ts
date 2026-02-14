/**
 * Build-time embedding generation for the AI docs chatbot.
 *
 * Extracts sections from all Markdoc doc pages, chunks them into
 * 200-400 token pieces, embeds via OpenAI text-embedding-3-small,
 * and writes the result to public/embeddings.json.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/generate-embeddings.ts
 *
 * Or via package.json script:
 *   pnpm build:embeddings
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { glob } from 'fast-glob'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmbeddingEntry {
  id: string
  content: string
  embedding: number[]
  metadata: { url: string; title: string; section: string }
}

interface Section {
  title: string
  hash: string | null
  paragraphs: string[]
}

// ---------------------------------------------------------------------------
// Markdoc AST Helpers
// ---------------------------------------------------------------------------
// We walk the Markdoc AST directly rather than converting to HTML first.
// This gives us clean text + code blocks without HTML artifacts, producing
// higher-quality embeddings at lower token cost.

/** Simple counter-based slugify (good enough for hashes) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/** Extract text content from a Markdoc AST node */
function toString(node: any): string {
  let str =
    node.type === 'text' && typeof node.attributes?.content === 'string'
      ? node.attributes.content
      : ''
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      str += toString(child)
    }
  }
  return str
}

/** Extract code block content from a Markdoc AST node */
function extractCodeBlocks(node: any, blocks: string[]): void {
  if (node.type === 'fence' && typeof node.attributes?.content === 'string') {
    const lang = node.attributes.language ?? ''
    blocks.push(`\`\`\`${lang}\n${node.attributes.content.trim()}\n\`\`\``)
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      extractCodeBlocks(child, blocks)
    }
  }
}

/**
 * Extract sections from a Markdoc AST.
 * Mirrors the logic in search.mjs but also captures code blocks.
 */
function extractSections(node: any, sections: Section[], isRoot = true): void {
  if (node.type === 'heading' || node.type === 'paragraph') {
    const content = toString(node).trim()
    if (node.type === 'heading' && (node.attributes?.level ?? 99) <= 2) {
      if (content) {
        const hash = node.attributes?.id ?? slugify(content)
        sections.push({ title: content, hash, paragraphs: [] })
      }
    } else {
      if (sections.length > 0 && content) {
        sections[sections.length - 1].paragraphs.push(content)
      }
    }
  } else if (node.type === 'fence') {
    // Capture code blocks as part of the current section
    if (sections.length > 0 && typeof node.attributes?.content === 'string') {
      const lang = node.attributes.language ?? ''
      const code = `\`\`\`${lang}\n${node.attributes.content.trim()}\n\`\`\``
      sections[sections.length - 1].paragraphs.push(code)
    }
  } else if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      extractSections(child, sections, false)
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

// OpenAI's tokenizer averages ~4 chars/token for English prose + code.
// We use this approximation to avoid pulling in a full tokenizer dependency.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const MAX_CHUNK_TOKENS = 400
const MIN_CHUNK_TOKENS = 50

interface Chunk {
  content: string
  url: string
  title: string
  section: string
}

function chunkSection(
  pageUrl: string,
  pageTitle: string,
  section: Section,
): Chunk[] {
  const sectionUrl = pageUrl + (section.hash ? `#${section.hash}` : '')
  const sectionTitle = section.title

  // Combine title + paragraphs
  const fullText = [sectionTitle, ...section.paragraphs].join('\n\n')
  const tokens = estimateTokens(fullText)

  // If it fits in one chunk, use it
  if (tokens <= MAX_CHUNK_TOKENS) {
    if (tokens < MIN_CHUNK_TOKENS) return [] // too small to be useful
    return [
      {
        content: fullText,
        url: sectionUrl,
        title: pageTitle,
        section: sectionTitle,
      },
    ]
  }

  // Split into multiple chunks at paragraph boundaries
  const chunks: Chunk[] = []
  let currentParagraphs: string[] = [sectionTitle]
  let currentTokens = estimateTokens(sectionTitle)

  for (const para of section.paragraphs) {
    const paraTokens = estimateTokens(para)

    if (currentTokens + paraTokens > MAX_CHUNK_TOKENS && currentParagraphs.length > 1) {
      chunks.push({
        content: currentParagraphs.join('\n\n'),
        url: sectionUrl,
        title: pageTitle,
        section: sectionTitle,
      })
      // Start new chunk with section title for context
      currentParagraphs = [`${sectionTitle} (continued)`]
      currentTokens = estimateTokens(currentParagraphs[0])
    }

    currentParagraphs.push(para)
    currentTokens += paraTokens
  }

  // Flush remaining
  if (currentParagraphs.length > 1 && currentTokens >= MIN_CHUNK_TOKENS) {
    chunks.push({
      content: currentParagraphs.join('\n\n'),
      url: sectionUrl,
      title: pageTitle,
      section: sectionTitle,
    })
  }

  return chunks
}

// ---------------------------------------------------------------------------
// OpenAI Embedding
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
// OpenAI supports up to 2048 inputs per batch, but 100 keeps each request
// under ~100KB and limits retry blast radius if a batch fails.
const BATCH_SIZE = 100

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required')
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>
  }

  // Sort by index to maintain order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Generating embeddings for Directive docs...\n')

  // 1. Find all page.md files
  const pagesDir = path.resolve(__dirname, '../src/app')
  const files = glob.sync('**/page.md', { cwd: pagesDir })
  console.log(`Found ${files.length} doc pages`)

  // 2. Parse and extract sections using a lightweight Markdoc parse
  // We use dynamic import for @markdoc/markdoc since it's ESM
  const Markdoc = await import('@markdoc/markdoc').then((m) => m.default ?? m)

  const allChunks: Chunk[] = []

  for (const file of files) {
    const url = file === 'page.md' ? '/' : `/${file.replace(/\/page\.md$/, '')}`
    const md = fs.readFileSync(path.join(pagesDir, file), 'utf8')
    const ast = Markdoc.parse(md)

    // Extract title from frontmatter
    const titleMatch = ast.attributes?.frontmatter?.match(
      /^title:\s*(.*?)\s*$/m,
    )
    const pageTitle = titleMatch?.[1] ?? path.basename(path.dirname(file))

    const sections: Section[] = [{ title: pageTitle, hash: null, paragraphs: [] }]
    extractSections(ast, sections)

    for (const section of sections) {
      const chunks = chunkSection(url, pageTitle, section)
      allChunks.push(...chunks)
    }
  }

  console.log(`Extracted ${allChunks.length} chunks\n`)

  if (allChunks.length === 0) {
    console.error('No chunks extracted. Check that doc pages exist.')
    process.exit(1)
  }

  // 3. Embed in batches
  const entries: EmbeddingEntry[] = []
  const totalBatches = Math.ceil(allChunks.length / BATCH_SIZE)

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const pct = Math.round((batchNum / totalBatches) * 100)
    console.log(
      `Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks, ${pct}%)...`,
    )

    const embeddings = await embedBatch(batch.map((c) => c.content))

    for (let j = 0; j < batch.length; j++) {
      entries.push({
        id: `${batch[j].url}-${j}`,
        content: batch[j].content,
        embedding: embeddings[j],
        metadata: {
          url: batch[j].url,
          title: batch[j].title,
          section: batch[j].section,
        },
      })
    }

    // Rate limit: small delay between batches
    if (i + BATCH_SIZE < allChunks.length) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  // 4. Write to public/embeddings.json
  const outPath = path.resolve(__dirname, '../public/embeddings.json')
  fs.writeFileSync(outPath, JSON.stringify(entries))

  const sizeMB = (Buffer.byteLength(JSON.stringify(entries)) / (1024 * 1024)).toFixed(2)
  console.log(`\nWrote ${entries.length} embeddings to ${outPath} (${sizeMB} MB)`)
  console.log('Done!')
}

main().catch((err) => {
  console.error('Failed to generate embeddings:', err)
  process.exit(1)
})
