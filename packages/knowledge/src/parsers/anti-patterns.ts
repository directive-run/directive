/**
 * Parser for `packages/knowledge/core/anti-patterns.md` → structured
 * `AntiPattern[]` data. Lazy + cached so the cost is paid once per
 * process at first call.
 *
 * The source markdown is organized as numbered sections (`## N. Title`)
 * each containing a TypeScript code block with `// WRONG` and
 * `// CORRECT` examples. Some sections include prose between the
 * heading and the code block — captured as `explanation`.
 *
 * IDs are kebab-cased slugs derived from the heading text; stable
 * across releases as long as the heading isn't renamed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

export type AntiPatternSeverity = "error" | "warning" | "info";
export type AntiPatternCategory =
  | "module"
  | "schema"
  | "constraint"
  | "resolver"
  | "derivation"
  | "effect"
  | "naming"
  | "react"
  | "composition";

export interface AntiPattern {
  /** Stable slug, derived from the heading text. */
  id: string;
  /** Section number in the source markdown (1..N). */
  number: number;
  /** Human-readable title (the heading text minus the number prefix). */
  title: string;
  /** Default severity. Heuristic; tunable per-rule later. */
  severity: AntiPatternSeverity;
  /** Heuristic category from title keywords. */
  category: AntiPatternCategory;
  /** Body prose between heading and the first code block (often empty). */
  explanation: string;
  /** The `// WRONG` example, if present. */
  badExample?: string;
  /** The `// CORRECT` example, if present. */
  goodExample?: string;
}

let cache: ReadonlyArray<AntiPattern> | null = null;

function resolveSourcePath(): string {
  const candidates = [
    join(PKG_ROOT, "core", "anti-patterns.md"),
    join(PKG_ROOT, "..", "core", "anti-patterns.md"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0] ?? "";
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function categorize(title: string): AntiPatternCategory {
  const lower = title.toLowerCase();
  if (/schema|builder/.test(lower)) {
    return "schema";
  }
  if (/constraint|cross-?module|require/.test(lower)) {
    return "constraint";
  }
  if (/resolver|settle|start/.test(lower)) {
    return "resolver";
  }
  if (/deriv|passthrough/.test(lower)) {
    return "derivation";
  }
  if (/effect/.test(lower)) {
    return "effect";
  }
  if (/usedirective|react|hook/.test(lower)) {
    return "react";
  }
  if (/import|bracket|deep import|name|context|abbreviat/.test(lower)) {
    return "naming";
  }
  if (/init|module|config/.test(lower)) {
    return "module";
  }
  return "module";
}

function severityFor(title: string): AntiPatternSeverity {
  const lower = title.toLowerCase();
  if (/nonexistent|missing|no error|deep import|async logic/.test(lower)) {
    return "error";
  }
  return "warning";
}

interface Section {
  number: number;
  title: string;
  body: string;
}

function splitSections(md: string): Section[] {
  const lines = md.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  const heading = /^##\s+(\d+)\.\s+(.+?)\s*$/;
  for (const line of lines) {
    const match = heading.exec(line);
    if (match?.[1] && match?.[2]) {
      if (current) {
        sections.push(current);
      }
      current = {
        number: Number(match[1]),
        title: match[2],
        body: "",
      };
      continue;
    }
    if (current) {
      // Stop at the first non-numbered ## section (e.g. "Quick Reference Checklist")
      if (/^##\s+\D/.test(line)) {
        sections.push(current);
        current = null;
        break;
      }
      current.body += `${line}\n`;
    }
  }
  if (current) {
    sections.push(current);
  }
  return sections;
}

function extractExamples(body: string): {
  explanation: string;
  badExample?: string;
  goodExample?: string;
} {
  const codeBlock = body.match(/```typescript\n([\s\S]*?)```/);
  const explanationLines: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) {
      break;
    }
    explanationLines.push(line);
  }
  const explanation = explanationLines.join("\n").trim();

  if (!codeBlock?.[1]) {
    return { explanation };
  }

  const code = codeBlock[1];
  // Split on the WRONG/CORRECT comment markers.
  const wrongMatch = code.match(
    /\/\/\s*WRONG[^\n]*\n([\s\S]*?)(?:\/\/\s*CORRECT|$)/,
  );
  const correctMatch = code.match(/\/\/\s*CORRECT[^\n]*\n([\s\S]*)/);

  return {
    explanation,
    badExample: wrongMatch?.[1]?.trim() ?? undefined,
    goodExample: correctMatch?.[1]?.trim() ?? undefined,
  };
}

function loadAntiPatterns(): ReadonlyArray<AntiPattern> {
  if (cache) {
    return cache;
  }

  const sourcePath = resolveSourcePath();
  let md: string;
  try {
    md = readFileSync(sourcePath, "utf-8");
  } catch {
    cache = Object.freeze([]);
    return cache;
  }

  const sections = splitSections(md);
  const out: AntiPattern[] = sections.map((section) => {
    const { explanation, badExample, goodExample } = extractExamples(
      section.body,
    );
    return {
      id: slugify(section.title),
      number: section.number,
      title: section.title,
      severity: severityFor(section.title),
      category: categorize(section.title),
      explanation,
      badExample,
      goodExample,
    };
  });

  cache = Object.freeze(out);
  return cache;
}

/** Return every parsed anti-pattern, stable order, frozen. */
export function getAntiPatterns(): ReadonlyArray<AntiPattern> {
  return loadAntiPatterns();
}

/** Look up one anti-pattern by its slug id. */
export function getAntiPatternById(id: string): AntiPattern | undefined {
  return loadAntiPatterns().find((ap) => ap.id === id);
}

/** Clear the in-memory cache. Test / watch-mode helper. */
export function clearAntiPatternCache(): void {
  cache = null;
}
