/**
 * Extract clean examples from ../../examples/ for AI rule templates.
 *
 * Process:
 * 1. Scan all example directories (dynamic discovery)
 * 2. Find the best source file for each example
 * 3. Strip DOM wiring (document.querySelector, addEventListener, innerHTML, etc.)
 * 4. Keep module definitions, system creation, key event dispatches
 * 5. Output clean TypeScript to examples/ directory
 *
 * Run: tsx scripts/extract-examples.ts
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_ROOT = join(__dirname, "..", "..", "..", "examples");
const OUTPUT_DIR = join(__dirname, "..", "examples");

// Examples to skip — must be a conscious decision with a comment
const EXCLUDED_EXAMPLES: string[] = [
  "schema-patterns", // Non-standard structure (files at root, not in src/)
  "eleven-up",       // React game, non-standard structure
];

interface ExampleSource {
  name: string;
  sourcePath: string;
  /** If true, the source file has no DOM wiring — copy as-is with header. */
  pure?: boolean;
}

// Patterns that indicate DOM wiring code
const DOM_PATTERNS = [
  /document\.(getElementById|querySelector|querySelectorAll|createElement)/,
  /^\s*document\s*$/,           // standalone `document` (start of chained call)
  /^\s*\.(getElementById|querySelector|querySelectorAll|createElement)\(/,  // continuation of chained document.xxx
  /\.innerHTML\s*[+=]/,
  /\.textContent\s*[+=]/,
  /\.classList\./,
  /\.style\./,
  /\.setAttribute\(/,
  /\.removeAttribute\(/,
  /(?<!window)\.addEventListener\(/,  // element.addEventListener (not window.addEventListener)
  /removeEventListener\(/,
  /\.appendChild\(/,
  /\.removeChild\(/,
  /\.insertBefore\(/,
  /\.replaceChild\(/,
  /\.parentElement/,
  /\.parentNode/,
  /\.nextSibling/,
  /\.previousSibling/,
  /\.children\b/,
  /\.childNodes/,
  /\.closest\(/,
  /\.scrollIntoView/,
  /\.focus\(\)/,
  /\.blur\(\)/,
  /window\.requestAnimationFrame/,
  /document\.body\./,
  /HTMLElement/,
  /as HTML\w+Element/,
  /\.offsetWidth/,
  /\.offsetHeight/,
  /\.getBoundingClientRect/,
];

// Patterns for DOM element declarations (const el = document.xxx)
const DOM_DECL_PATTERNS = [
  /^\s*const\s+\w+\s*=\s*document\./,
  /^\s*const\s+\w+El\s*=/,
  /^\s*const\s+\w+Element\s*=/,
  /^\s*const\s+\w+Container\s*=/,
  /^\s*const\s+\w+Btn\s*=/,
  /^\s*const\s+\w+Button\s*=/,
  /^\s*const\s+\w+Input\s*=/,
  /^\s*const\s+\w+Form\s*=/,
  /^\s*const\s+\w+Display\s*=/,
  /^\s*const\s+\w+Badge\s*=/,
  /^\s*const\s+\w+Fill\s*=/,
  /^\s*const\s+\w+Bar\s*=/,
  /^\s*const\s+\w+Text\s*=/,
  /^\s*const\s+\w+Label\s*=/,
  /^\s*const\s+\w+Slider\s*=/,
  /^\s*const\s+\w+Card\s*=/,
  /^\s*const\s+\w+Grid\s*=/,
  /^\s*const\s+\w+List\s*=/,
  /^\s*const\s+\w+Timeline\s*=/,
];

function isDomLine(line: string): boolean {
  return (
    DOM_PATTERNS.some((p) => p.test(line)) ||
    DOM_DECL_PATTERNS.some((p) => p.test(line))
  );
}

/**
 * Find the best source file for an example directory.
 * Priority:
 * 1. src/<name>.ts (dedicated module file, usually pure)
 * 2. src/module.ts (common convention)
 * 3. src/modules.ts (multi-module examples)
 * 4. src/main.ts (entry point, often has DOM wiring)
 *
 * For AI examples, also check:
 * 5. src/ai-orchestrator.ts
 */
function findSourceFile(exampleDir: string, name: string): { path: string; pure: boolean } | null {
  const srcDir = join(exampleDir, "src");
  if (!existsSync(srcDir)) {
    return null;
  }

  let files: string[];
  try {
    files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
  } catch {
    return null;
  }

  // Dedicated module file (usually pure — no DOM wiring)
  const dedicatedFile = `${name}.ts`;
  if (files.includes(dedicatedFile)) {
    return { path: `${name}/src/${dedicatedFile}`, pure: true };
  }

  // module.ts (common for single-module examples)
  if (files.includes("module.ts")) {
    return { path: `${name}/src/module.ts`, pure: true };
  }

  // modules.ts (multi-module examples)
  if (files.includes("modules.ts")) {
    return { path: `${name}/src/modules.ts`, pure: true };
  }

  // AI-specific files
  if (files.includes("ai-orchestrator.ts")) {
    return { path: `${name}/src/ai-orchestrator.ts`, pure: true };
  }

  if (files.includes("agents.ts")) {
    return { path: `${name}/src/agents.ts`, pure: true };
  }

  // Fallback: main.ts (has DOM wiring, needs stripping)
  if (files.includes("main.ts")) {
    return { path: `${name}/src/main.ts`, pure: false };
  }

  // Last resort: first .ts file
  if (files.length > 0) {
    return { path: `${name}/src/${files[0]}`, pure: false };
  }

  return null;
}

function discoverExamples(): ExampleSource[] {
  const sources: ExampleSource[] = [];
  const excluded: string[] = [];

  let dirs: string[];
  try {
    dirs = readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    console.warn(`Warning: ${EXAMPLES_ROOT} not found`);

    return [];
  }

  for (const name of dirs) {
    if (EXCLUDED_EXAMPLES.includes(name)) {
      excluded.push(name);
      continue;
    }

    const exampleDir = join(EXAMPLES_ROOT, name);
    const found = findSourceFile(exampleDir, name);

    if (found) {
      sources.push({
        name,
        sourcePath: found.path,
        pure: found.pure,
      });
    } else {
      console.warn(`  [SKIP] ${name}: no suitable source file found`);
    }
  }

  if (excluded.length > 0) {
    console.log(`  Excluded examples (${excluded.length}): ${excluded.join(", ")}`);
    console.log(`  (Review EXCLUDED_EXAMPLES in extract-examples.ts to update)`);
  }

  return sources;
}

function extractExample(source: ExampleSource): string {
  const fullPath = join(EXAMPLES_ROOT, source.sourcePath);

  if (!existsSync(fullPath)) {
    console.warn(`  Warning: ${fullPath} not found, skipping.`);

    return `// Source not found: ${source.sourcePath}\n`;
  }

  const raw = readFileSync(fullPath, "utf-8");

  if (source.pure) {
    return addHeader(source, raw);
  }

  // Strip DOM wiring: walk through the file and remove DOM sections
  const lines = raw.split("\n");
  const kept: string[] = [];
  let inDomBlock = false;
  let braceDepth = 0;
  let skipUntilBraceClose = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Skip empty lines at start
    if (kept.length === 0 && trimmed === "") {
      continue;
    }

    // Track brace depth for block skipping
    if (skipUntilBraceClose) {
      for (const ch of line) {
        if (ch === "{") {
          braceDepth++;
        }
        if (ch === "}") {
          braceDepth--;
        }
      }
      if (braceDepth <= 0) {
        skipUntilBraceClose = false;
        braceDepth = 0;
      }
      continue;
    }

    // Skip function declarations that are DOM render functions
    if (
      /^\s*(function\s+render|const\s+render\s*=|function\s+update|const\s+update\s*=)/.test(
        line,
      ) &&
      !line.includes("=>")
    ) {
      skipUntilBraceClose = true;
      braceDepth = 0;
      for (const ch of line) {
        if (ch === "{") {
          braceDepth++;
        }
        if (ch === "}") {
          braceDepth--;
        }
      }
      if (braceDepth <= 0) {
        skipUntilBraceClose = false;
      }
      continue;
    }

    // Skip individual DOM lines
    if (isDomLine(line)) {
      // If this is the start of a multi-line block, skip the whole block
      if (line.includes("{") && !line.includes("}")) {
        inDomBlock = true;
        braceDepth = 0;
        for (const ch of line) {
          if (ch === "{") {
            braceDepth++;
          }
          if (ch === "}") {
            braceDepth--;
          }
        }
      }
      continue;
    }

    if (inDomBlock) {
      for (const ch of line) {
        if (ch === "{") {
          braceDepth++;
        }
        if (ch === "}") {
          braceDepth--;
        }
      }
      if (braceDepth <= 0) {
        inDomBlock = false;
        braceDepth = 0;
      }
      continue;
    }

    // Skip lines that reference DOM-only variables
    if (/^\s*\w+(El|Element|Container|Btn|Button|Input|Form|Display|Badge|Fill|Bar|Slider|Card|Grid|List|Timeline)\b/.test(trimmed) && !trimmed.startsWith("//")) {
      continue;
    }

    // Skip setInterval/setTimeout that are clearly for DOM updates
    if (/^\s*(setInterval|setTimeout)\s*\(/.test(line)) {
      const nextLines = lines.slice(i, i + 5).join("");
      if (isDomLine(nextLines)) {
        continue;
      }
    }

    // Skip system.subscribe(() => render()) calls
    if (/system\.subscribe\s*\(\s*\(\)\s*=>\s*render/.test(line)) {
      continue;
    }

    // Skip data-ready attributes
    if (/data-\w+-ready/.test(line)) {
      continue;
    }

    kept.push(line);
  }

  // Clean up: remove consecutive blank lines (3+ -> 2)
  const cleaned: string[] = [];
  let blankCount = 0;
  for (const line of kept) {
    if (line.trim() === "") {
      blankCount++;
      if (blankCount <= 2) {
        cleaned.push(line);
      }
    } else {
      blankCount = 0;
      cleaned.push(line);
    }
  }

  // Remove trailing blank lines
  while (cleaned.length > 0 && cleaned[cleaned.length - 1]?.trim() === "") {
    cleaned.pop();
  }

  return addHeader(source, cleaned.join("\n") + "\n");
}

function addHeader(source: ExampleSource, content: string): string {
  const note = source.pure
    ? "// Pure module file — no DOM wiring"
    : "// Extracted for AI rules — DOM wiring stripped";

  return (
    `// Example: ${source.name}\n` +
    `// Source: examples/${source.sourcePath}\n` +
    `${note}\n\n` +
    content
  );
}

function main() {
  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sources = discoverExamples();
  let extracted = 0;
  let warnings = 0;

  for (const source of sources) {
    const result = extractExample(source);
    const outputPath = join(OUTPUT_DIR, `${source.name}.ts`);
    writeFileSync(outputPath, result, "utf-8");

    const lineCount = result.split("\n").length;
    if (result.includes("Source not found")) {
      warnings++;
      console.log(`  [WARN] ${source.name}: source not found`);
    } else {
      extracted++;
      console.log(`  ${source.name}: ${lineCount} lines`);
    }
  }

  console.log(
    `\nExtracted ${extracted} examples (${warnings} warnings)`,
  );
}

main();
