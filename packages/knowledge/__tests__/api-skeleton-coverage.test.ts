/**
 * The skeleton has to describe the code in this repository, not a copy of the
 * code from some earlier release.
 *
 * `api-skeleton.md` is generated from `api-reference.json`, which this
 * repository does not contain. The release fetches it from *the newest release
 * that carries the asset* — which, at the moment a release is being cut, is the
 * release before it. So the skeleton published alongside a version describes
 * the version before it, and nothing has ever compared the two.
 *
 * Locally the same gap opens a different way: the generator reads the file out
 * of a sibling `directive-docs` checkout, and that checkout is pinned to
 * whatever version of core it depends on. A checkout ten minors behind produces
 * a skeleton ten minors behind, cheerfully, exit zero.
 *
 * Neither path is detectable by reading the output — a stale skeleton is a
 * well-formed skeleton. This compares it against the one artifact that is
 * always current: the type declarations this repository just built. Every
 * public export has to appear as an entry.
 *
 * The gaps that exist today are listed rather than fixed. Fixing them means
 * changing what the extractor emits, and that lives in the docs repository.
 * Listing them makes the set a ratchet: it can shrink without touching this
 * file, and it cannot grow.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const SKELETON = join(HERE, "..", "api-skeleton.md");

/**
 * Public exports named in an `export { ... }` block, including re-exports
 * written `internalName as PublicName` — the public name is what a reader looks
 * up, and it is the only one the skeleton would ever carry.
 */
const EXPORT_BLOCK = /export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/g;

function publicExports(dtsPath: string): string[] {
  const source = readFileSync(dtsPath, "utf-8");
  const names = new Set<string>();

  for (const block of source.matchAll(EXPORT_BLOCK)) {
    for (const entry of block[1]!.split(",")) {
      const spec = entry.trim().replace(/^type\s+/, "");
      if (!spec) {
        continue;
      }
      const aliased = spec.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const name = aliased ? aliased[1]! : spec;
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") {
        names.add(name);
      }
    }
  }

  return [...names];
}

/**
 * Exports with no entry in the skeleton as of 2026-08-13, at core 1.27.0.
 *
 * Not an approval — a record of what the extractor does not emit today. Most
 * are types re-exported from a subpath (the audit ledger, the predicate
 * translators, the AI transports) plus a handful of surprising ones: `System`
 * and `doctor` are as public as anything in the library.
 *
 * The test fails if a name leaves this list without being documented, so the
 * list cannot quietly outlive the gap it describes.
 */
const KNOWN_GAPS: Readonly<Record<"core" | "ai", readonly string[]>> = {
  core: [
    // New in this release. The skeleton is generated from the api-reference.json
    // the newest release carries, so an export cannot appear in it until a
    // release has published one that contains it. Remove both lines after the
    // next release: the stale-entry check below will insist.
    "DefinitionKind",
    "DynamicDefinitionKind",
    "AuditEntry",
    "AuditEntryKind",
    "AuditLedger",
    "AuditLedgerOptions",
    "AuditLedgerSink",
    "CheckAgainstResult",
    "ConstraintDiff",
    "Contradiction",
    "ContradictionType",
    "DiffRulesOptions",
    "PredicateToMongoOptions",
    "PredicateToPostgrestOptions",
    "PredicateToSqlOptions",
    "PredicateToSqlResult",
    "PredictMissingChange",
    "PredictResult",
    "QueryFilter",
    "ReplayUnderOptions",
    "RulesDiffReport",
    "SchemaValidationError",
    "SchemaValidationOptions",
    "SourceDef",
    "SourceDefinition",
    "SweepReport",
    "SweepUnderOptions",
    "System",
    "TimerFactOpts",
    "TypedDerivationsDefinition",
    "doctor",
  ],
  ai: [
    // Absent from the PUBLISHED api-reference.json since 1.29.1, where a
    // constant inserted between this factory's doc comment and the function
    // orphaned the comment — and the extractor emits an entry only for an
    // exported function it can find documentation for. The comment is
    // reattached in source, but the skeleton is generated from the asset the
    // newest release carries, so it stays absent until a release republishes
    // it. Remove this line then: the stale-entry check below will insist.
    "createFactPIIGuardrail",
    "BatchQueue",
    "BatchQueueConfig",
    "BudgetConfig",
    "BudgetExceededDetails",
    "ConstraintRouterConfig",
    "FactPIIGuardrailOptions",
    "FallbackConfig",
    "GoalCheckpointConfig",
    "JSONFileStoreOptions",
    "MermaidDirection",
    "MermaidNodeShapes",
    "MermaidOptions",
    "PredicateFromIntentDiagnostics",
    "PredicateFromIntentOptions",
    "PredicateFromIntentProvenance",
    "PredicateFromIntentWithProvenanceResult",
    "PredicateToolSpec",
    "PredicateToolSpecOptions",
    "ProviderStats",
    "RAGEnrichOptions",
    "RAGEnricher",
    "RAGEnricherConfig",
    "SSEEvent",
    "SSETransport",
    "SSETransportConfig",
    "SafeParseResult",
    "SourcesOtelOptions",
    "StructuredOutputConfig",
    "parseHttpStatus",
    "predicateToolSpec",
  ],
};

const PACKAGES = [
  { key: "core" as const, dts: join(REPO, "packages/core/dist/index.d.ts") },
  { key: "ai" as const, dts: join(REPO, "packages/ai/dist/index.d.ts") },
];

describe("api-skeleton describes the code in this repository", () => {
  for (const { key, dts } of PACKAGES) {
    describe(`@directive-run/${key}`, () => {
      it("documents every public export", () => {
        if (!existsSync(dts)) {
          // The declarations are a build output. Without them there is nothing
          // to compare against, and a silent pass here is the same failure
          // this file exists to catch.
          throw new Error(
            `[knowledge] ${dts} not found — run \`pnpm --filter @directive-run/${key} build\` before this test.`,
          );
        }

        const skeleton = readFileSync(SKELETON, "utf-8");
        const documented = (name: string) =>
          new RegExp(`\`${name}\``).test(skeleton);

        const undocumented = publicExports(dts)
          .filter((name) => !documented(name))
          .filter((name) => !KNOWN_GAPS[key].includes(name))
          .sort();

        expect(
          undocumented,
          `${undocumented.length} public export(s) of @directive-run/${key} have no entry in api-skeleton.md.\n\n` +
            "The usual cause is a stale api-reference.json: the release fetches it from the\n" +
            "release before the one being cut, and locally the generator reads it from a\n" +
            "sibling directive-docs checkout pinned to an older core.\n\n" +
            "Regenerate against a current api-reference.json:\n" +
            "  pnpm --filter @directive-run/knowledge generate\n\n" +
            "If the export is genuinely not meant to be documented, add it to KNOWN_GAPS\n" +
            "in this file with a reason.",
        ).toEqual([]);
      });

      it("has no stale entries in its known-gap list", () => {
        const skeleton = readFileSync(SKELETON, "utf-8");
        const nowDocumented = KNOWN_GAPS[key].filter((name) =>
          new RegExp(`\`${name}\``).test(skeleton),
        );

        expect(
          nowDocumented,
          "These names are listed as undocumented but now have entries. Remove them " +
            "from KNOWN_GAPS — a list that outlives the gap it describes stops being " +
            "a record of debt and starts being a place where new gaps hide.",
        ).toEqual([]);
      });
    });
  }
});
