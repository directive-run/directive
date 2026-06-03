import type {
  Identifier,
  ObjectLiteralElementLike,
  ObjectLiteralExpression,
  SourceFile,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "derivation-uses-imported-state";

const ALLOWED_FREE_IDENTIFIERS = new Set([
  "facts",
  "derive",
  "derived",
  "undefined",
  "null",
  "true",
  "false",
  "this",
  "Object",
  "Array",
  "Math",
  "Date",
  "JSON",
  "Number",
  "String",
  "Boolean",
  "Promise",
  "Set",
  "Map",
  "Symbol",
  "BigInt",
  "Infinity",
  "NaN",
  "console",
]);

function findDeriveObjects(sourceFile: SourceFile): ObjectLiteralExpression[] {
  const out: ObjectLiteralExpression[] = [];
  for (const assign of sourceFile.getDescendantsOfKind(
    SyntaxKind.PropertyAssignment,
  )) {
    if (assign.getName() !== "derive") {
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
    category: "derivation",
    title: "Derivation reads from outside the facts proxy",
    explanation:
      "Derivations must be pure functions of facts (and optionally derived). Reading module-scoped variables, top-level imports, or process state breaks reactivity — the derivation will silently never re-fire when the outside value changes.",
    badExample: `let salesTax = 0.08; // mutable outside
const derived = { total: (facts) => facts.subtotal * (1 + salesTax) };`,
    goodExample: `const SALES_TAX = 0.08; // const literal is fine
const derived = { total: (facts) => facts.subtotal * (1 + SALES_TAX) };`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    for (const deriveObj of findDeriveObjects(sourceFile)) {
      for (const prop of deriveObj.getProperties()) {
        const finding = inspectDeriveProperty(sourceFile, prop);
        if (finding) {
          findings.push(finding);
        }
      }
    }
    return findings;
  },
};

function inspectDeriveProperty(
  sourceFile: SourceFile,
  prop: ObjectLiteralElementLike,
): Finding | undefined {
  const assign = prop.asKind(SyntaxKind.PropertyAssignment);
  const fn = assign?.getInitializerIfKind(SyntaxKind.ArrowFunction);
  if (!fn) {
    return undefined;
  }
  const params = fn.getParameters().map((p) => p.getName());
  for (const id of fn.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = id.getText();
    if (params.includes(name) || ALLOWED_FREE_IDENTIFIERS.has(name)) {
      continue;
    }
    if (isIdentifierAPropertyName(id)) {
      continue;
    }
    const { line, column } = sourceFile.getLineAndColumnAtPos(id.getStart());
    return {
      ruleId: ID,
      severity: "warning",
      line,
      column,
      message: `Derivation references \`${name}\` from outside the facts proxy — the derivation will not re-fire when it changes.`,
      findingId: makeFindingId(ID, line, column),
    };
  }
  return undefined;
}

function isIdentifierAPropertyName(id: Identifier): boolean {
  const parent = id.getParent();
  if (parent?.getKind() === SyntaxKind.PropertyAccessExpression) {
    const propAccess = parent.asKindOrThrow(
      SyntaxKind.PropertyAccessExpression,
    );
    if (propAccess.getNameNode().getStart() === id.getStart()) {
      return true;
    }
  }
  if (parent?.getKind() === SyntaxKind.PropertyAssignment) {
    const pa = parent.asKindOrThrow(SyntaxKind.PropertyAssignment);
    if (pa.getNameNode().getStart() === id.getStart()) {
      return true;
    }
  }
  return false;
}
