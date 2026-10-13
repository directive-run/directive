import type { ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "effect-mutates-facts";

function findEffectsObjects(sourceFile: SourceFile): ObjectLiteralExpression[] {
  const out: ObjectLiteralExpression[] = [];
  for (const assign of sourceFile.getDescendantsOfKind(
    SyntaxKind.PropertyAssignment,
  )) {
    if (assign.getName() !== "effects") {
      continue;
    }
    const init = assign.getInitializerIfKind(
      SyntaxKind.ObjectLiteralExpression,
    );
    if (init) {
      out.push(init);
    }
  }
  return out;
}

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "error",
    category: "effect",
    title: "Effect mutates facts",
    explanation:
      "Effects are observers, not mutators. The facts an effect receives are read-only: a write throws in development and is ignored in production. Move the mutation into an event handler, a derivation, or a constraint + resolver; for data arriving from outside, use a source.",
    badExample: `effects: {
  bumpCount: {
    run: (facts) => {
      facts.count += 1;
    },
  },
}`,
    goodExample: `events: {
  bumpCount: (facts) => {
    facts.count += 1;
  },
}`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const effectsObj of findEffectsObjects(sourceFile)) {
      for (const assignNode of effectsObj.getDescendantsOfKind(
        SyntaxKind.BinaryExpression,
      )) {
        const op = assignNode.getOperatorToken().getKind();
        if (
          op !== SyntaxKind.EqualsToken &&
          op !== SyntaxKind.PlusEqualsToken &&
          op !== SyntaxKind.MinusEqualsToken &&
          op !== SyntaxKind.AsteriskEqualsToken
        ) {
          continue;
        }
        const lhsText = assignNode.getLeft().getText();
        if (/^(facts|ctx\.facts|context\.facts)\./.test(lhsText)) {
          const { line, column } = sourceFile.getLineAndColumnAtPos(
            assignNode.getStart(),
          );
          findings.push({
            ruleId: ID,
            severity: "error",
            line,
            column,
            message:
              "Effect handler mutates facts — effects must not write to facts. Move the write into an event or resolver.",
            findingId: makeFindingId(ID, line, column),
          });
        }
      }
    }
    return findings;
  },
};
