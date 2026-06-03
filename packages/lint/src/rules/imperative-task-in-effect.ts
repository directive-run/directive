import type { ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "imperative-task-in-effect";

const FORBIDDEN_CALLS = new Set([
  "setInterval",
  "setTimeout",
  "setImmediate",
  "addEventListener",
  "queueMicrotask",
  "requestAnimationFrame",
]);

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
    title: "Imperative timer or listener inside effect",
    explanation:
      "Effects in Directive are reactive responses to fact changes, not imperative schedulers. Calling setInterval / setTimeout / addEventListener inside an effect leaks across reconciliation cycles and is a constraint or resolver in disguise.",
    badExample: `effects: {
  ping: {
    run: (facts) => {
      setInterval(() => sendPing(), 1000);
    },
  },
}`,
    goodExample: `// Model the timing as a fact change:
// constraints: { tick: { when: (facts) => facts.now > facts.lastPing + 1000, require: { type: "PING" } } }`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const effectsObj of findEffectsObjects(sourceFile)) {
      for (const call of effectsObj.getDescendantsOfKind(
        SyntaxKind.CallExpression,
      )) {
        const callee = call.getExpression().getText();
        if (!FORBIDDEN_CALLS.has(callee)) {
          continue;
        }
        const { line, column } = sourceFile.getLineAndColumnAtPos(
          call.getStart(),
        );
        findings.push({
          ruleId: ID,
          severity: "error",
          line,
          column,
          message: `\`${callee}\` inside an effect — model timing as a fact + constraint instead.`,
          suggestion:
            "Replace the imperative timer with a constraint that emits a requirement on the relevant fact change.",
          findingId: makeFindingId(ID, line, column),
        });
      }
    }
    return findings;
  },
};
