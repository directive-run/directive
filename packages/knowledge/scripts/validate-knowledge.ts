/**
 * Validate knowledge files — check backtick-quoted identifiers against API skeleton.
 *
 * Extracts all `identifier` references from core/ and ai/ knowledge files and checks
 * that each exists in the generated api-skeleton.md.
 *
 * Run: tsx scripts/validate-knowledge.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const CORE_DIR = join(PKG_ROOT, "core");
const AI_DIR = join(PKG_ROOT, "ai");
const API_SKELETON = join(PKG_ROOT, "api-skeleton.md");

// Known symbols that aren't in the API exports (language built-ins, etc.)
const KNOWN_EXCEPTIONS = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "null",
  "undefined",
  "void",
  "never",
  "unknown",
  "any",
  "true",
  "false",
  "Promise",
  "Map",
  "Set",
  "Record",
  "Date",
  "Error",
  "JSON",
  "Math",
  "console",
  "process",
  "fetch",
  "setTimeout",
  "setInterval",
  "require",
  "import",
  "export",
  "type",
  "interface",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "throw",
  "try",
  "catch",
  "finally",
  "new",
  "class",
  "extends",
  "implements",
  "this",
  "super",
  "typeof",
  "instanceof",
  "in",
  "of",
  "from",
  "as",
  "is",
  "readonly",
  "abstract",
  "static",
  "public",
  "private",
  "protected",
  "enum",
  "namespace",
  "declare",
  "module",
  "Node",
  "NodeJS",
  "RegExp",
  "Symbol",
  "ArrayBuffer",
  "Uint8Array",
  "AbortSignal",
  "AbortController",
  "Response",
  "Request",
  "Headers",
  "URL",
  "URLSearchParams",
  "EventEmitter",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "TextEncoder",
  "TextDecoder",
  // @directive-run/react symbols (not in core API skeleton)
  "useDirective",
  "useSystem",
  // @directive-run/ai symbols (not in core API skeleton)
  "createSSEResponse",
  "createOpenAIEmbedder",
  "createAnthropicEmbedder",
  "createAuditTrailPlugin",
  "createCompliancePlugin",
  "createMockRunner",
  "createTestOrchestrator",
  "createTestMultiAgentOrchestrator",
  "assertAgentCalled",
  "assertMultiAgentState",
  "createEvaluator",
  "createLLMJudge",
  "createEvaluationSuite",
  "createErrorSimulator",
  "createLatencySimulator",
]);

function getKnowledgeFiles(): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];

  for (const dir of [CORE_DIR, AI_DIR]) {
    try {
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        files.push({
          name: f,
          content: readFileSync(join(dir, f), "utf-8"),
        });
      }
    } catch {
      // directory may not exist yet
    }
  }

  return files;
}

function main() {
  const skeletonContent = readFileSync(API_SKELETON, "utf-8");

  // Extract all backtick-quoted identifiers from the skeleton
  const apiSymbols = new Set<string>();
  const symbolPattern = /`(\w+)`/g;
  let match;
  while ((match = symbolPattern.exec(skeletonContent)) !== null) {
    if (match[1]) {
      apiSymbols.add(match[1]);
    }
  }

  console.log(`API skeleton has ${apiSymbols.size} symbols`);

  // Check each knowledge file
  const files = getKnowledgeFiles();

  let totalRefs = 0;
  let missingRefs = 0;
  const missing: Array<{ file: string; symbol: string }> = [];

  for (const file of files) {
    // Extract identifier references that look like API symbols
    // (PascalCase or camelCase starting identifiers, not lowercase keywords)
    const refPattern = /`((?:create|use|with|assert|mock|estimate|validate|pipe|select|t\.|Module|System|Plugin|Constraint|Resolver|Requirement|Derivation|Effect|Schema|Facts|Engine|Orchestrator|Agent|Runner|Budget|Guardrail|Memory|Circuit)\w*)`/g;
    let ref;
    while ((ref = refPattern.exec(file.content)) !== null) {
      const symbol = ref[1];
      if (!symbol || KNOWN_EXCEPTIONS.has(symbol)) {
        continue;
      }

      totalRefs++;

      if (!apiSymbols.has(symbol)) {
        missingRefs++;
        missing.push({ file: file.name, symbol });
      }
    }
  }

  console.log(
    `Checked ${totalRefs} API symbol references across ${files.length} files`,
  );

  if (missing.length > 0) {
    console.warn(`\nWarning: ${missing.length} symbols not found in API skeleton:`);
    for (const { file, symbol } of missing) {
      console.warn(`  ${file}: \`${symbol}\``);
    }
    console.warn(
      "\nThese may be stale references. Run `pnpm --filter @directive-run/knowledge generate` to refresh.",
    );
    process.exitCode = 1;
  } else {
    console.log("All API symbol references are valid.");
  }
}

main();
