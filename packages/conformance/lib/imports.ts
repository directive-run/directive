/**
 * What a file imports, in a form two files can be compared by.
 *
 * Order and grouping do not matter (the formatter sorts imports after the
 * port), but every specifier and every name does: one entry per imported
 * binding, `specifier|kind name`.
 */

import { Node, type SourceFile, SyntaxKind } from "ts-morph";

export function importSignature(sf: SourceFile): string[] {
  const out: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const declType = imp.isTypeOnly();
    const def = imp.getDefaultImport();
    const ns = imp.getNamespaceImport();
    const named = imp.getNamedImports();
    if (!def && !ns && named.length === 0) {
      out.push(`${spec}|side-effect`);
    }
    if (def) {
      out.push(`${spec}|${declType ? "type " : ""}default as ${def.getText()}`);
    }
    if (ns) {
      out.push(`${spec}|${declType ? "type " : ""}* as ${ns.getText()}`);
    }
    for (const n of named) {
      const type = declType || n.isTypeOnly() ? "type " : "";
      const alias = n.getAliasNode()?.getText();
      out.push(`${spec}|${type}${n.getName()}${alias ? ` as ${alias}` : ""}`);
    }
  }

  return out.sort();
}

/** Every `import("…")` and `vi.mock("…")`/`vi.doMock("…")` specifier. */
export function dynamicSpecifiers(sf: SourceFile): string[] {
  const out: string[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isImport = callee.getKind() === SyntaxKind.ImportKeyword;
    const isMock =
      Node.isPropertyAccessExpression(callee) &&
      callee.getExpression().getText() === "vi" &&
      ["mock", "doMock", "unmock", "doUnmock", "importActual"].includes(
        callee.getName(),
      );
    if (!isImport && !isMock) {
      continue;
    }
    const arg = call.getArguments()[0];
    const kind = isImport ? "import" : (callee as Node).getText();
    out.push(
      arg &&
        (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))
        ? `${kind}:${arg.getLiteralText()}`
        : `${kind}:<computed ${arg?.getText() ?? "nothing"}>`,
    );
  }

  return out.sort();
}

/**
 * Whether a ported test may import `spec`: the test runner, Node built-ins,
 * the engine helper, or exactly one of core's published entry points.
 */
export function allowedSpecifier(
  spec: string,
  coreSpecifiers: Set<string>,
  engineHelper: string,
  kind: "static" | "import" | "mock",
): boolean {
  if (kind === "mock") {
    // Production tests mock core's dev flag by name; nothing is imported.
    return spec === "#is-development";
  }

  return (
    spec === "vitest" ||
    spec.startsWith("node:") ||
    (kind === "static" && spec === engineHelper) ||
    coreSpecifiers.has(spec)
  );
}
