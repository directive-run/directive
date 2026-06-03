import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "module-name-not-kebab";
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

function kebabize(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "warning",
    category: "naming",
    title: "Module name is not kebab-case",
    explanation:
      'Directive module names are kebab-case by convention. `createModule("trafficLight", …)` will work at runtime but breaks the namespace-key convention every other Directive surface assumes.',
    badExample: 'createModule("trafficLight", { schema, init });',
    goodExample: 'createModule("traffic-light", { schema, init });',
    executable: true,
    fixable: true,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      if (call.getExpression().getText() !== "createModule") {
        continue;
      }
      const firstArg = call.getArguments()[0];
      const lit = firstArg?.asKind(SyntaxKind.StringLiteral);
      if (!lit) {
        continue;
      }
      const value = lit.getLiteralValue();
      if (KEBAB_RE.test(value)) {
        continue;
      }
      const { line, column } = sourceFile.getLineAndColumnAtPos(lit.getStart());
      findings.push({
        ruleId: ID,
        severity: "warning",
        line,
        column,
        message: `Module name "${value}" is not kebab-case.`,
        suggestion: `Rename to "${kebabize(value)}".`,
        findingId: makeFindingId(ID, line, column),
      });
    }
    return findings;
  },

  fix(sourceFile, finding) {
    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      if (call.getExpression().getText() !== "createModule") {
        continue;
      }
      const firstArg = call.getArguments()[0];
      const lit = firstArg?.asKind(SyntaxKind.StringLiteral);
      if (!lit) {
        continue;
      }
      const { line, column } = sourceFile.getLineAndColumnAtPos(lit.getStart());
      if (line !== finding.line || column !== finding.column) {
        continue;
      }
      const value = lit.getLiteralValue();
      lit.setLiteralValue(kebabize(value));
      break;
    }
    return { fixedSource: sourceFile.getFullText() };
  },
};
