import type {
  ObjectLiteralElementLike,
  ObjectLiteralExpression,
  SourceFile,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "constraint-without-when-or-require";

function findConstraintsObjects(
  sourceFile: SourceFile,
): ObjectLiteralExpression[] {
  const out: ObjectLiteralExpression[] = [];
  for (const assign of sourceFile.getDescendantsOfKind(
    SyntaxKind.PropertyAssignment,
  )) {
    if (assign.getName() !== "constraints") {
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
    category: "constraint",
    title: "Constraint missing `when` or `require`",
    explanation:
      "Every constraint needs both `when` (the predicate) and `require` (the requirement to emit). Constraints missing either silently never fire and are the second most common bug in fresh module code.",
    badExample: `constraints: {
  needsData: { when: (facts) => facts.x },
}`,
    goodExample: `constraints: {
  needsData: {
    when: (facts) => facts.x,
    require: { type: "FETCH" },
  },
}`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const constraintsObj of findConstraintsObjects(sourceFile)) {
      for (const prop of constraintsObj.getProperties()) {
        const f = inspectConstraintProperty(sourceFile, prop);
        if (f) {
          findings.push(f);
        }
      }
    }
    return findings;
  },
};

function inspectConstraintProperty(
  sourceFile: SourceFile,
  prop: ObjectLiteralElementLike,
): Finding | undefined {
  const assign = prop.asKind(SyntaxKind.PropertyAssignment);
  const constraintObj = assign?.getInitializerIfKind(
    SyntaxKind.ObjectLiteralExpression,
  );
  if (!assign || !constraintObj) {
    return undefined;
  }
  const hasWhen = constraintObj.getProperty("when") !== undefined;
  const hasRequire = constraintObj.getProperty("require") !== undefined;
  if (hasWhen && hasRequire) {
    return undefined;
  }
  const { line, column } = sourceFile.getLineAndColumnAtPos(assign.getStart());
  const missing = [hasWhen ? null : "when", hasRequire ? null : "require"]
    .filter(Boolean)
    .join(" and ");
  return {
    ruleId: ID,
    severity: "error",
    line,
    column,
    message: `Constraint "${assign.getName()}" is missing ${missing}.`,
    suggestion: "Add both `when` and `require` to every constraint entry.",
    findingId: makeFindingId(ID, line, column),
  };
}
