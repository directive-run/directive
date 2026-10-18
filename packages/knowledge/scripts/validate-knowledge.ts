/**
 * Validate knowledge files — check backtick-quoted identifiers against API skeleton.
 *
 * Extracts all `identifier` references from core/ and ai/ knowledge files and checks
 * that each exists in the generated api-skeleton.md.
 *
 * Run: tsx scripts/validate-knowledge.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../../scripts/lib/log";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const CORE_DIR = join(PKG_ROOT, "core");
const AI_DIR = join(PKG_ROOT, "ai");
const API_SKELETON = join(PKG_ROOT, "api-skeleton.md");
const PACKAGES_DIR = join(PKG_ROOT, "..");

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
  // React built-ins and illustrative identifiers used in examples
  "useEffect",
  "useState",
  "useContext",
  "userId",
  "userMessage",
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

/**
 * The skeleton only lists each package's root entry, so subpath exports
 * (testing utilities, React hooks, `t.*` builders) never appear in it. Derive
 * the rest from the workspace source itself: every declared name in a
 * package's non-test source, plus the members of the `t` schema builder.
 */
function collectSourceSymbols(): Set<string> {
  const symbols = new Set<string>();
  const declPattern =
    /\b(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_]\w*)/g;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") {
        continue;
      }

      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\./.test(entry)) {
        const text = readFileSync(full, "utf-8");
        for (const m of text.matchAll(declPattern)) {
          symbols.add(m[1] as string);
        }

        // Interface members and object keys (option names, test-system methods)
        for (const m of text.matchAll(
          /^[ \t]+(?:readonly )?([A-Za-z_]\w*)\??(?:\(|:|<)/gm,
        )) {
          symbols.add(m[1] as string);
        }

        const tBlock = text.match(/export const t = \{([\s\S]*?)\n\};/);
        if (tBlock) {
          for (const m of (tBlock[1] as string).matchAll(
            /^ {2}([A-Za-z_]\w*)\b/gm,
          )) {
            symbols.add(`t.${m[1]}`);
          }
        }
      }
    }
  };

  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, "src");
    try {
      walk(src);
    } catch {
      // package without a src dir
    }
  }

  return symbols;
}

/**
 * Lines that name a symbol in order to say it does not exist ("`t.map` does
 * not exist", "the hallucinated ones", "NOT `x`") are the knowledge base doing
 * its job, so they are not checked against the API.
 */
const NEGATION_PATTERN =
  /\b(?:do(?:es)? not exist|(?:do|does)n['\u2019]t exist|hallucinated|there is no|no separate|NOT|WRONG|never exist)\b|\(not\b/;

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
  const PHASE = "Validate Knowledge";
  log.header(PHASE);

  const skeletonContent = readFileSync(API_SKELETON, "utf-8");

  // Extract all backtick-quoted identifiers from the skeleton
  const apiSymbols = new Set<string>();
  const symbolPattern = /`(\w+)`/g;
  let match: RegExpExecArray | null;
  while ((match = symbolPattern.exec(skeletonContent)) !== null) {
    if (match[1]) {
      apiSymbols.add(match[1]);
    }
  }

  for (const sym of collectSourceSymbols()) {
    apiSymbols.add(sym);
  }

  log.reads(["api-skeleton.md", "packages/*/src"]);
  log.item(`${apiSymbols.size} symbols`);

  // Check each knowledge file
  const files = getKnowledgeFiles();
  log.step(`Checking ${files.length} knowledge files...`);

  let totalRefs = 0;
  let _missingRefs = 0;
  const missing: Array<{ file: string; symbol: string }> = [];
  const fileRefCounts: Record<string, number> = {};

  for (const file of files) {
    let fileRefs = 0;

    // Extract identifier references that look like API symbols
    // (PascalCase or camelCase starting identifiers, not lowercase keywords)
    const refPattern =
      /`((?:create|use|with|assert|mock|estimate|validate|pipe|select|t\.|Module|System|Plugin|Constraint|Resolver|Requirement|Derivation|Effect|Schema|Facts|Engine|Orchestrator|Agent|Runner|Budget|Guardrail|Memory|Circuit)\w*)`/g;
    let ref: RegExpExecArray | null;
    while ((ref = refPattern.exec(file.content)) !== null) {
      const symbol = ref[1];
      if (!symbol || KNOWN_EXCEPTIONS.has(symbol)) {
        continue;
      }

      const lineStart = file.content.lastIndexOf("\n", ref.index) + 1;
      const lineEnd = file.content.indexOf("\n", ref.index);
      const line = file.content.slice(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd,
      );
      if (NEGATION_PATTERN.test(line)) {
        continue;
      }

      totalRefs++;
      fileRefs++;

      if (!apiSymbols.has(symbol)) {
        _missingRefs++;
        missing.push({ file: file.name, symbol });
      }
    }

    fileRefCounts[file.name] = fileRefs;
  }

  for (const file of files) {
    const refs = fileRefCounts[file.name] ?? 0;
    const hasMissing = missing.some((m) => m.file === file.name);
    const status = hasMissing ? "has warnings" : "";
    log.item(file.name, `${refs} refs${status ? ` (${status})` : ""}`);
  }

  if (missing.length > 0) {
    log.warn(`${missing.length} symbols not found in API skeleton:`);
    for (const { file, symbol } of missing) {
      log.item(file, `\`${symbol}\``);
    }
    log.warn(
      "Run `pnpm --filter @directive-run/knowledge generate` to refresh",
    );
    process.exitCode = 1;
  } else {
    log.success(
      `${totalRefs} symbol references valid across ${files.length} files`,
    );
  }

  log.done(PHASE);
}

main();
