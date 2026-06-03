import type { ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "resolver-naming-mismatch";

function findResolversObjects(
  sourceFile: SourceFile,
): ObjectLiteralExpression[] {
  const out: ObjectLiteralExpression[] = [];
  for (const assign of sourceFile.getDescendantsOfKind(
    SyntaxKind.PropertyAssignment,
  )) {
    if (assign.getName() !== "resolvers") {
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

function expectedKeyForRequirement(reqType: string): string {
  // SCREAM_SNAKE -> camelCase. Strip leading/trailing underscores.
  return reqType
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "warning",
    category: "resolver",
    title: "Resolver key does not match its requirement",
    explanation:
      "Each resolver key should be the camelCase version of the requirement type it handles. Mismatched names work at runtime but make grep / dev-tools wrong, and is the #1 source of 'why isn't my resolver firing?' confusion.",
    badExample: `resolvers: {
  processItem: {
    requirement: "FETCH_USER",
    resolve: async (req, ctx) => fetchUser(req.id),
  },
}`,
    goodExample: `resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, ctx) => fetchUser(req.id),
  },
}`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const resolversObj of findResolversObjects(sourceFile)) {
      for (const prop of resolversObj.getProperties()) {
        const assign = prop.asKind(SyntaxKind.PropertyAssignment);
        const resolverObj = assign?.getInitializerIfKind(
          SyntaxKind.ObjectLiteralExpression,
        );
        if (!assign || !resolverObj) {
          continue;
        }
        const reqProp = resolverObj
          .getProperty("requirement")
          ?.asKind(SyntaxKind.PropertyAssignment);
        const reqLit = reqProp?.getInitializerIfKind(SyntaxKind.StringLiteral);
        if (!reqLit) {
          continue;
        }
        const reqType = reqLit.getLiteralValue();
        const expected = expectedKeyForRequirement(reqType);
        const actualKey = assign.getName();
        if (actualKey === expected) {
          continue;
        }
        const { line, column } = sourceFile.getLineAndColumnAtPos(
          assign.getStart(),
        );
        findings.push({
          ruleId: ID,
          severity: "warning",
          line,
          column,
          message: `Resolver key "${actualKey}" does not match requirement "${reqType}" — expected "${expected}".`,
          suggestion: `Rename the key to "${expected}".`,
          findingId: makeFindingId(ID, line, column),
        });
      }
    }
    return findings;
  },
};
