import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "no-single-line-if-return";

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "warning",
    category: "naming",
    title: "if (cond) return X; without braces",
    explanation:
      "Directive code uses braces on every if-return. Single-line return without braces is a common Directive style violation that hides further logic and bites refactors.",
    badExample: 'if (facts.phase === "ready") return "go";',
    goodExample: 'if (facts.phase === "ready") {\n  return "go";\n}',
    executable: true,
    fixable: true,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const ifStmt of sourceFile.getDescendantsOfKind(
      SyntaxKind.IfStatement,
    )) {
      const thenStmt = ifStmt.getThenStatement();
      if (thenStmt.getKind() === SyntaxKind.ReturnStatement) {
        const start = ifStmt.getStart();
        const { line, column } = sourceFile.getLineAndColumnAtPos(start);
        findings.push({
          ruleId: ID,
          severity: "warning",
          line,
          column,
          message: "Wrap the return in braces: `if (cond) { return X; }`",
          suggestion: "Add a block around the return statement.",
          findingId: makeFindingId(ID, line, column),
        });
      }
    }
    return findings;
  },

  fix(sourceFile, finding) {
    // Find the matching IfStatement at the finding's position.
    for (const ifStmt of sourceFile.getDescendantsOfKind(
      SyntaxKind.IfStatement,
    )) {
      const start = ifStmt.getStart();
      const { line, column } = sourceFile.getLineAndColumnAtPos(start);
      if (line !== finding.line || column !== finding.column) {
        continue;
      }
      const thenStmt = ifStmt.getThenStatement();
      if (thenStmt.getKind() !== SyntaxKind.ReturnStatement) {
        continue;
      }
      const returnText = thenStmt.getText();
      thenStmt.replaceWithText(`{\n  ${returnText}\n}`);
      break;
    }
    return { fixedSource: sourceFile.getFullText() };
  },
};
