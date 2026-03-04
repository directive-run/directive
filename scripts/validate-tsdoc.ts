/**
 * Validate TSDoc conformance on public exports from core and ai packages.
 *
 * Uses @microsoft/tsdoc parser + ts-morph to check:
 * - All exported functions have @param for each parameter
 * - All exported functions have @returns
 * - No malformed TSDoc tags
 * - @internal items are not re-exported from index.ts
 * - @example present on create* factory functions
 *
 * Run: npx tsx scripts/validate-tsdoc.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { TSDocParser, type ParserMessage } from "@microsoft/tsdoc";
import {
  type FunctionDeclaration,
  type JSDoc,
  Project,
  type SourceFile,
  SyntaxKind,
  type VariableStatement,
} from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface ValidationError {
  file: string;
  line: number;
  symbol: string;
  message: string;
  severity: "error" | "warning";
}

const errors: ValidationError[] = [];

function rel(filePath: string): string {
  return path.relative(ROOT, filePath);
}

function addError(
  file: string,
  line: number,
  symbol: string,
  message: string,
  severity: "error" | "warning" = "error",
): void {
  errors.push({ file: rel(file), line, symbol, message, severity });
}

// ============================================================================
// TSDoc Parser Validation
// ============================================================================

const tsdocParser = new TSDocParser();

function validateTSDocSyntax(
  comment: string,
  filePath: string,
  line: number,
  symbol: string,
): void {
  const result = tsdocParser.parseString(comment);

  for (const msg of result.log.messages) {
    // Skip informational messages
    if (msg.toString().includes("tsdoc-undefined-tag")) {
      continue;
    }

    const severity = isTSDocError(msg) ? "error" : "warning";
    addError(filePath, line, symbol, `TSDoc: ${msg.toString()}`, severity);
  }
}

function isTSDocError(msg: ParserMessage): boolean {
  return msg.messageId.startsWith("tsdoc-") && !msg.messageId.includes("undefined-tag");
}

// ============================================================================
// Export Analysis
// ============================================================================

function getJSDocComment(jsDocs: JSDoc[]): string | null {
  if (jsDocs.length === 0) {
    return null;
  }

  return jsDocs[jsDocs.length - 1]!.getFullText();
}

function hasTag(jsDocs: JSDoc[], tagName: string): boolean {
  for (const doc of jsDocs) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === tagName) {
        return true;
      }
    }
  }

  return false;
}

function getParamNames(jsDocs: JSDoc[]): Set<string> {
  const names = new Set<string>();
  for (const doc of jsDocs) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === "@param") {
        const text = tag.getCommentText()?.trim() ?? "";
        // Extract param name from "@param name - description" or "@param name description"
        const match = text.match(/^(\w[\w.]*)/);
        if (match?.[1]) {
          names.add(match[1]);
        }
      }
    }
  }

  return names;
}

function validateFunctionExport(
  name: string,
  decl: FunctionDeclaration,
  filePath: string,
): void {
  const jsDocs = decl.getJsDocs();
  const line = decl.getStartLineNumber();

  // Must have a doc comment
  if (jsDocs.length === 0) {
    addError(filePath, line, name, "Missing TSDoc comment");

    return;
  }

  const comment = getJSDocComment(jsDocs);
  if (comment) {
    validateTSDocSyntax(comment, filePath, line, name);
  }

  // Skip @internal items for param/returns checks
  if (hasTag(jsDocs, "@internal")) {
    return;
  }

  // Check @param for each parameter
  const params = decl.getParameters();
  const documentedParams = getParamNames(jsDocs);

  for (const param of params) {
    const paramName = param.getName();
    // Skip destructured params (they start with { or have dots)
    if (paramName.startsWith("{") || paramName.startsWith("[")) {
      continue;
    }

    if (!documentedParams.has(paramName)) {
      addError(filePath, line, name, `Missing @param for "${paramName}"`, "warning");
    }
  }

  // Check @returns
  if (!hasTag(jsDocs, "@returns") && !hasTag(jsDocs, "@return")) {
    const returnType = decl.getReturnType().getText();
    if (returnType !== "void" && returnType !== "undefined") {
      addError(filePath, line, name, "Missing @returns", "warning");
    }
  }

  // Check @example on create* factory functions
  if (name.startsWith("create") && !hasTag(jsDocs, "@example")) {
    addError(
      filePath,
      line,
      name,
      "Factory function missing @example",
      "warning",
    );
  }
}

function validateVariableExport(
  name: string,
  stmt: VariableStatement,
  filePath: string,
): void {
  const jsDocs = stmt.getJsDocs();
  const line = stmt.getStartLineNumber();

  if (jsDocs.length === 0) {
    addError(filePath, line, name, "Missing TSDoc comment", "warning");

    return;
  }

  const comment = getJSDocComment(jsDocs);
  if (comment) {
    validateTSDocSyntax(comment, filePath, line, name);
  }
}

// ============================================================================
// Index.ts @internal Leak Check
// ============================================================================

function checkInternalLeaks(sourceFile: SourceFile): void {
  const filePath = sourceFile.getFilePath();

  // Look through all export declarations
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      const symbol = namedExport.getSymbol();
      if (!symbol) {
        continue;
      }

      // Resolve to the original declaration
      const declarations = symbol.getDeclarations();
      for (const decl of declarations) {
        const jsDocs =
          "getJsDocs" in decl
            ? (decl as { getJsDocs(): JSDoc[] }).getJsDocs()
            : [];
        if (hasTag(jsDocs, "@internal")) {
          addError(
            filePath,
            namedExport.getStartLineNumber(),
            namedExport.getName(),
            "@internal symbol is re-exported from index.ts",
          );
        }
      }
    }
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.base.json"),
    skipAddingFilesFromTsConfig: true,
  });

  // Add entry points
  const entryPoints = [
    path.join(ROOT, "packages/core/src/index.ts"),
    path.join(ROOT, "packages/ai/src/index.ts"),
  ];

  for (const entry of entryPoints) {
    project.addSourceFileAtPath(entry);
  }

  // Add source files from both packages
  const sourceGlobs = [
    path.join(ROOT, "packages/core/src/**/*.ts"),
    path.join(ROOT, "packages/ai/src/**/*.ts"),
  ];

  for (const glob of sourceGlobs) {
    project.addSourceFilesAtPaths(glob);
  }

  // Resolve dependencies
  project.resolveSourceFileDependencies();

  // Check @internal leaks from index files
  for (const entry of entryPoints) {
    const sf = project.getSourceFile(entry);
    if (sf) {
      checkInternalLeaks(sf);
    }
  }

  // Validate exported functions in source files (not test files)
  const sourceFiles = project.getSourceFiles().filter((sf) => {
    const fp = sf.getFilePath();

    return (
      !fp.includes("__tests__") &&
      !fp.includes(".test.") &&
      !fp.includes(".spec.") &&
      !fp.endsWith("index.ts") &&
      (fp.includes("packages/core/src/") || fp.includes("packages/ai/src/"))
    );
  });

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath();

    // Check exported functions
    for (const fn of sf.getFunctions()) {
      if (!fn.isExported()) {
        continue;
      }

      validateFunctionExport(fn.getName() ?? "<anonymous>", fn, filePath);
    }

    // Check exported variable statements (arrow functions, const objects)
    for (const stmt of sf.getVariableStatements()) {
      if (!stmt.isExported()) {
        continue;
      }

      for (const decl of stmt.getDeclarations()) {
        validateVariableExport(decl.getName(), stmt, filePath);
      }
    }
  }

  // Report results
  const errorCount = errors.filter((e) => e.severity === "error").length;
  const warningCount = errors.filter((e) => e.severity === "warning").length;

  if (errors.length > 0) {
    console.log("\nTSDoc Validation Results\n");

    // Group by file
    const byFile = new Map<string, ValidationError[]>();
    for (const err of errors) {
      const existing = byFile.get(err.file) ?? [];
      existing.push(err);
      byFile.set(err.file, existing);
    }

    for (const [file, fileErrors] of byFile) {
      console.log(`${file}:`);
      for (const err of fileErrors) {
        const prefix = err.severity === "error" ? "ERROR" : "WARN ";
        console.log(`  ${prefix} L${err.line} ${err.symbol}: ${err.message}`);
      }
      console.log();
    }

    console.log(
      `${errorCount} error(s), ${warningCount} warning(s) in ${byFile.size} file(s)\n`,
    );
  } else {
    console.log("TSDoc validation passed — no issues found.\n");
  }

  // Exit with error code only for hard errors, not warnings
  if (errorCount > 0) {
    process.exit(1);
  }
}

main();
