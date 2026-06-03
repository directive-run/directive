/**
 * Public types for `@directive-run/lint`.
 *
 * Kept separate from the runtime entry so consumers that only need
 * the *shape* of rules / findings (the MCP `list_review_rules`
 * tool, doc-generation pipelines, eval harnesses) can import the
 * types without pulling in the ts-morph runtime.
 */

/** Rule severity. */
export type Severity = "error" | "warning" | "info";

/** Rule category — matches the `reviewing-directive-code` skill taxonomy. */
export type RuleCategory =
  | "module"
  | "constraint"
  | "resolver"
  | "derivation"
  | "effect"
  | "naming"
  | "composition";

/**
 * Rule metadata. Always present, even on rules that don't have an
 * AST `check()` implemented yet — `list_review_rules` returns
 * metadata for every known rule whether or not `review_source` can
 * actually evaluate it.
 */
export interface RuleMetadata {
  id: string;
  severity: Severity;
  category: RuleCategory;
  title: string;
  explanation: string;
  badExample?: string;
  goodExample?: string;
  /** True when the rule has an AST `check()` implementation. */
  executable: boolean;
  /** True when the rule has a mechanical `fix()` implementation. */
  fixable: boolean;
}

/** One AST-level finding. */
export interface Finding {
  ruleId: string;
  severity: Severity;
  line: number;
  column: number;
  message: string;
  suggestion?: string;
  /**
   * Stable identifier for this specific finding — needed to feed
   * `fix_code` so it knows WHICH instance of the rule to fix.
   */
  findingId: string;
}

/** Result of `runRules`. */
export interface RunResult {
  findings: Finding[];
  findingsByRule: Record<string, Finding[]>;
  findingsBySeverity: Record<Severity, Finding[]>;
  summary: {
    error: number;
    warning: number;
    info: number;
    total: number;
  };
  /**
   * Rule IDs the caller asked for via `ruleFilter` that don't exist
   * in the registry. Empty array when the filter is omitted.
   */
  unknownRules: string[];
}

/** Result of `applyFix`. */
export interface FixResult {
  ok: boolean;
  diff?: string;
  fixedSource?: string;
  explanation?: string;
  reason?: string;
}

/** Options accepted by `runRules`. */
export interface RunOptions {
  fileName?: string;
  ruleFilter?: string[];
}
