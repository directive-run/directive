/**
 * Rule-author types. ts-morph imports live here so individual rule
 * files don't each have to re-declare the AST types they touch.
 */

import type { SourceFile } from "ts-morph";
import type { Finding, RuleMetadata } from "../types.js";

export type { SourceFile };

export interface ExecutableRule {
  metadata: RuleMetadata;
  check(sourceFile: SourceFile): Finding[];
  fix?(sourceFile: SourceFile, finding: Finding): { fixedSource: string };
}

/** Build a stable findingId from rule id + position. */
export function makeFindingId(
  ruleId: string,
  line: number,
  column: number,
): string {
  return `${ruleId}@${line}:${column}`;
}
