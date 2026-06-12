/**
 * Pure regex-based extractor for `derive:` / `derivations:` block keys
 * across a payload of source files. Mirrors the lightweight pattern the
 * docs site's DevTools panel uses for static-structure parsing.
 *
 * `system.derive` is a Proxy with no `ownKeys` trap, so the worker
 * can't enumerate derivations from inside the sandbox. Instead, the
 * host pre-scans source files for the declared keys and forwards them
 * to the worker, which then reads `system.derive[key]` for each.
 *
 * Best-effort: a module that builds derivation keys dynamically (e.g.
 * `derive: Object.fromEntries(keys.map(k => [k, fn]))`) won't be
 * extracted. That's acceptable for the stated goal of "transcript
 * reflects what the module declared."
 */

import type { PlaygroundFile } from "./types.js";

/**
 * Find the matching `}` for the `{` at `openBrace`. Returns the index
 * of the close brace, or -1 if unbalanced.
 */
function findMatchingClose(source: string, openBrace: number): number {
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Pull top-level `key:` segments out of a brace-balanced block. Keys
 * are found between `,` or `\n` or the block start at brace depth 0
 * AND paren depth 0. Works for both multi-line and compact `{ a: 1,
 * b: 2 }` forms.
 */
function collectTopLevelKeys(block: string): string[] {
  const keys: string[] = [];
  let segStart = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  const flushSegment = (end: number) => {
    const seg = block.slice(segStart, end).trim();
    segStart = end + 1;
    if (!seg) return;
    // Tolerate leading quotes for `"foo":` quoted keys.
    const m = seg.match(/^['"]?(\w+)['"]?\s*:/);
    if (m) keys.push(m[1]!);
  };

  for (let j = 0; j < block.length; j++) {
    const ch = block[j];
    if (ch === "{") braceDepth += 1;
    else if (ch === "}") braceDepth -= 1;
    else if (ch === "(") parenDepth += 1;
    else if (ch === ")") parenDepth -= 1;
    else if (ch === "[") bracketDepth += 1;
    else if (ch === "]") bracketDepth -= 1;
    else if (
      (ch === "," || ch === "\n") &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0
    ) {
      flushSegment(j);
    }
  }
  // Final segment (no trailing comma/newline).
  flushSegment(block.length);
  return keys;
}

function extractTopLevelKeys(source: string, sectionName: string): string[] {
  const headerRe = new RegExp(`\\b${sectionName}\\s*:\\s*\\{`);
  const headerMatch = source.match(headerRe);
  if (!headerMatch || headerMatch.index === undefined) {
    return [];
  }
  const openBrace = source.indexOf("{", headerMatch.index);
  if (openBrace === -1) {
    return [];
  }
  const closeBrace = findMatchingClose(source, openBrace);
  if (closeBrace === -1) {
    return [];
  }
  return collectTopLevelKeys(source.slice(openBrace + 1, closeBrace));
}

/**
 * Collect the union of derivation key names declared across all files
 * in the payload. Looks at both `derive:` (module config block) and
 * `derivations:` (schema block). De-duplicates.
 */
export function extractDerivationKeys(files: PlaygroundFile[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    for (const k of extractTopLevelKeys(file.source, "derive")) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    for (const k of extractTopLevelKeys(file.source, "derivations")) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}
