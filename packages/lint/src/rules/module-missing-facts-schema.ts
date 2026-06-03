import type { CallExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "module-missing-facts-schema";

function findCreateModuleCalls(sourceFile: SourceFile) {
  const calls: CallExpression[] = [];
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    if (call.getExpression().getText() === "createModule") {
      calls.push(call);
    }
  }
  return calls;
}

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "error",
    category: "schema",
    title: "Flat schema — missing `facts` wrapper",
    explanation:
      "Every createModule schema must nest facts under `schema.facts`. Top-level keys without the wrapper produce a runtime error and is the #1 cause of new-module bug reports.",
    badExample: `createModule("x", {
  schema: { phase: t.string() },
});`,
    goodExample: `createModule("x", {
  schema: { facts: { phase: t.string() } },
});`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const call of findCreateModuleCalls(sourceFile)) {
      const configArg = call.getArguments()[1];
      if (!configArg || !configArg.asKind(SyntaxKind.ObjectLiteralExpression)) {
        continue;
      }
      const configObj = configArg.asKindOrThrow(
        SyntaxKind.ObjectLiteralExpression,
      );
      const schemaProp = configObj.getProperty("schema");
      if (!schemaProp) {
        continue;
      }
      const init = schemaProp
        .asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
      if (!init) {
        continue;
      }
      const factsProp = init.getProperty("facts");
      if (!factsProp) {
        const start = schemaProp.getStart();
        const { line, column } = sourceFile.getLineAndColumnAtPos(start);
        findings.push({
          ruleId: ID,
          severity: "error",
          line,
          column,
          message:
            "`schema` is missing a `facts` wrapper — top-level fact keys will not register.",
          suggestion: "Move every fact key under `schema.facts: { … }`.",
          findingId: makeFindingId(ID, line, column),
        });
      }
    }
    return findings;
  },
};
