/**
 * `@directive-run/lint` — ts-morph-based static analysis for
 * Directive code. The package surface stays small and stable:
 *
 *   - getRules() / getRuleById() — metadata for every known rule,
 *     whether or not it has an executable `check()`.
 *   - runRules(source, opts) — actually run the executable rules
 *     against a source string. Loads ts-morph lazily; throws a
 *     structured error if ts-morph isn't installed.
 *   - applyFix(source, finding) — apply a mechanical fix for one
 *     finding. Same lazy-load contract.
 *
 * Consumed by `@directive-run/mcp` (`review_source`, `fix_code`,
 * `list_review_rules`, `get_review_rule` tools) and by the future
 * `directive doctor lint` CLI subcommand.
 *
 * The package ships ts-morph as `optionalDependencies` so the
 * read-only consumers (just listing rule metadata) don't pay the
 * ~25 MB install cost. `runRules` / `applyFix` throw with a clear
 * remediation message when ts-morph is missing.
 */

import type { SourceFile } from "ts-morph";
import { getAllRuleMetadata, getRuleMetadataById } from "./registry.js";
import type {
  Finding,
  FixResult,
  RuleMetadata,
  RunOptions,
  RunResult,
  Severity,
} from "./types.js";

export type {
  Finding,
  FixResult,
  RuleCategory,
  RuleMetadata,
  RunOptions,
  RunResult,
  Severity,
} from "./types.js";

const TS_MORPH_MISSING =
  "ts-morph is not installed. @directive-run/lint declares it as an optionalDependencies. " +
  "Install it explicitly to enable runRules / applyFix: `npm install ts-morph`.";

/**
 * Return metadata for every known rule. Stable order. Includes
 * rules whose `executable` flag is false — those rules can still
 * be listed and referenced by ID, they just won't fire under
 * `runRules`.
 */
export function getRules(): readonly RuleMetadata[] {
  return getAllRuleMetadata();
}

/** Return metadata for one rule by ID, or `undefined`. */
export function getRuleById(id: string): RuleMetadata | undefined {
  return getRuleMetadataById(id);
}

/** Empty run result — used when there are no executable rules to run. */
function emptyRunResult(unknownRules: string[] = []): RunResult {
  return {
    findings: [],
    findingsByRule: {},
    findingsBySeverity: { error: [], warning: [], info: [] } as Record<
      Severity,
      Finding[]
    >,
    summary: { error: 0, warning: 0, info: 0, total: 0 },
    unknownRules,
  };
}

function partitionFindings(
  findings: Finding[],
): Pick<RunResult, "findingsByRule" | "findingsBySeverity" | "summary"> {
  const findingsByRule: Record<string, Finding[]> = {};
  const findingsBySeverity: Record<Severity, Finding[]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const f of findings) {
    const bucket = findingsByRule[f.ruleId] ?? [];
    bucket.push(f);
    findingsByRule[f.ruleId] = bucket;
    findingsBySeverity[f.severity].push(f);
  }
  return {
    findingsByRule,
    findingsBySeverity,
    summary: {
      error: findingsBySeverity.error.length,
      warning: findingsBySeverity.warning.length,
      info: findingsBySeverity.info.length,
      total: findings.length,
    },
  };
}

/**
 * Run every executable rule (or a filtered subset) against the
 * provided source string. Loads ts-morph lazily. Caller is
 * responsible for input bounds (the MCP server applies its own
 * caps before delegating here).
 */
export async function runRules(
  source: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const { getExecutableRules } = await import("./rules.js");
  const allRules = getExecutableRules();

  const filter = options.ruleFilter;
  const unknownRules: string[] = [];
  let activeRules = allRules;
  if (filter && filter.length > 0) {
    const registry = new Set(allRules.map((r) => r.metadata.id));
    for (const id of filter) {
      if (!registry.has(id)) {
        unknownRules.push(id);
      }
    }
    const allow = new Set(filter);
    activeRules = allRules.filter((r) => allow.has(r.metadata.id));
  }

  if (activeRules.length === 0) {
    return emptyRunResult(unknownRules);
  }

  const sourceFile = (await parseSource(
    source,
    options.fileName,
  )) as SourceFile;
  const findings: Finding[] = [];
  for (const rule of activeRules) {
    try {
      findings.push(...rule.check(sourceFile));
    } catch (err) {
      findings.push({
        ruleId: rule.metadata.id,
        severity: "info",
        line: 1,
        column: 1,
        message: `rule errored: ${truncate((err as Error).message, 200)}`,
        findingId: `${rule.metadata.id}@error`,
      });
    }
  }

  return {
    findings,
    ...partitionFindings(findings),
    unknownRules,
  };
}

/**
 * Apply a mechanical fix for one finding. Returns `{ ok: false, reason }`
 * if the rule is not fixable or no longer matches.
 */
export async function applyFix(
  source: string,
  finding: Finding,
): Promise<FixResult> {
  const { getExecutableRuleById } = await import("./rules.js");
  const rule = getExecutableRuleById(finding.ruleId);
  if (!rule) {
    return { ok: false, reason: `unknown rule: ${finding.ruleId}` };
  }
  if (!rule.fix) {
    return { ok: false, reason: `rule ${finding.ruleId} is not fixable` };
  }
  const sourceFile = (await parseSource(source)) as SourceFile;
  const { fixedSource } = rule.fix(sourceFile, finding);
  return {
    ok: true,
    diff: buildUnifiedDiff(source, fixedSource),
    fixedSource,
    explanation: rule.metadata.explanation,
  };
}

async function parseSource(
  source: string,
  fileName?: string,
): Promise<unknown> {
  let tsMorph: typeof import("ts-morph");
  try {
    tsMorph = await import("ts-morph");
  } catch {
    throw new Error(TS_MORPH_MISSING);
  }
  const project = new tsMorph.Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      jsx: tsMorph.ts.JsxEmit.ReactJSX,
      target: tsMorph.ts.ScriptTarget.ES2022,
      module: tsMorph.ts.ModuleKind.ESNext,
    },
  });
  const safeFileName = sanitizeFileName(fileName);
  return project.createSourceFile(safeFileName, source, { overwrite: true });
}

function sanitizeFileName(fileName?: string): string {
  if (!fileName) {
    return "input.ts";
  }
  if (!/^[\w./-]{1,128}$/.test(fileName)) {
    return "input.ts";
  }
  return fileName;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}…`;
}

/**
 * Tiny unified-diff builder. Sufficient for fix_code's needs (small
 * source files; one rule's change at a time). Not a general-purpose
 * differ.
 */
function buildUnifiedDiff(before: string, after: string): string {
  if (before === after) {
    return "";
  }
  const a = before.split("\n");
  const b = after.split("\n");
  const lines: string[] = [
    "--- before",
    "+++ after",
    `@@ -1,${a.length} +1,${b.length} @@`,
  ];
  // Naive line-by-line LCS-free diff. Tolerable for small fix outputs.
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) {
      lines.push(` ${av ?? ""}`);
    } else {
      if (av !== undefined) {
        lines.push(`-${av}`);
      }
      if (bv !== undefined) {
        lines.push(`+${bv}`);
      }
    }
  }
  return lines.join("\n");
}
