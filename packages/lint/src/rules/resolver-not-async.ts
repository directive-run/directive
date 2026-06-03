import type { ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "resolver-not-async";

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

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "warning",
    category: "resolver",
    title: "Resolver `resolve` is not async",
    explanation:
      "Directive resolvers are expected to be async functions. A non-async resolver that returns a Promise still works at runtime but loses helpful stack traces and reads as imperative TS instead of Directive style.",
    badExample: `resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: (req, ctx) => doWork(req),
  },
}`,
    goodExample: `resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, ctx) => doWork(req),
  },
}`,
    executable: true,
    fixable: true,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const resolversObj of findResolversObjects(sourceFile)) {
      for (const prop of resolversObj.getProperties()) {
        const assign = prop.asKind(SyntaxKind.PropertyAssignment);
        const resolverObj = assign?.getInitializerIfKind(
          SyntaxKind.ObjectLiteralExpression,
        );
        if (!resolverObj) {
          continue;
        }
        const resolveProp = resolverObj.getProperty("resolve");
        const fn = resolveProp
          ?.asKind(SyntaxKind.PropertyAssignment)
          ?.getInitializerIfKind(SyntaxKind.ArrowFunction);
        if (!fn) {
          continue;
        }
        const isAsync = fn
          .getModifiers()
          .some((m) => m.getKind() === SyntaxKind.AsyncKeyword);
        if (!isAsync) {
          const start = fn.getStart();
          const { line, column } = sourceFile.getLineAndColumnAtPos(start);
          findings.push({
            ruleId: ID,
            severity: "warning",
            line,
            column,
            message: "Resolver `resolve` should be `async`.",
            suggestion: "Add the `async` keyword to the arrow function.",
            findingId: makeFindingId(ID, line, column),
          });
        }
      }
    }
    return findings;
  },

  fix(sourceFile, finding) {
    for (const resolversObj of findResolversObjects(sourceFile)) {
      for (const prop of resolversObj.getProperties()) {
        const assign = prop.asKind(SyntaxKind.PropertyAssignment);
        const resolverObj = assign?.getInitializerIfKind(
          SyntaxKind.ObjectLiteralExpression,
        );
        const resolveProp = resolverObj?.getProperty("resolve");
        const fn = resolveProp
          ?.asKind(SyntaxKind.PropertyAssignment)
          ?.getInitializerIfKind(SyntaxKind.ArrowFunction);
        if (!fn) {
          continue;
        }
        const { line, column } = sourceFile.getLineAndColumnAtPos(
          fn.getStart(),
        );
        if (line !== finding.line || column !== finding.column) {
          continue;
        }
        const isAsync = fn
          .getModifiers()
          .some((m) => m.getKind() === SyntaxKind.AsyncKeyword);
        if (!isAsync) {
          fn.setIsAsync(true);
        }
        return { fixedSource: sourceFile.getFullText() };
      }
    }
    return { fixedSource: sourceFile.getFullText() };
  },
};
