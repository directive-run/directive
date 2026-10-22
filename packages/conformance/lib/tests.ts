/**
 * The tests in a file, by the name vitest reports for them.
 *
 * A key is the describe titles and the test title joined with " > ", which is
 * what vitest's `task.fullName`-style chain produces. Titles that are not
 * plain strings (`it.each` templates, computed titles) cannot be matched
 * statically; they are marked `dynamic` and keyed by their source text.
 */

import {
  type CallExpression,
  Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

export interface StaticTest {
  key: string;
  dynamic: boolean;
  call: CallExpression;
  /** Enclosing describe calls, outermost first. */
  describes: CallExpression[];
}

/** `it`, `it.skip`, `it.each(t)` and `it.each\`…\`` all root at `it`. */
export function calleeRoot(call: CallExpression): string | undefined {
  let current: Node = call.getExpression();
  for (;;) {
    if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
    } else if (Node.isCallExpression(current)) {
      current = current.getExpression();
    } else if (Node.isTaggedTemplateExpression(current)) {
      current = current.getTag();
    } else if (Node.isIdentifier(current)) {
      return current.getText();
    } else {
      return undefined;
    }
  }
}

function isEach(call: CallExpression): boolean {
  const callee = call.getExpression();

  return (
    Node.isCallExpression(callee) || Node.isTaggedTemplateExpression(callee)
  );
}

/** A test or suite call: a known root, a title, and a body (or `todo`). */
function isBlock(call: CallExpression, roots: string[]): boolean {
  const root = calleeRoot(call);
  if (!root || !roots.includes(root)) {
    return false;
  }
  const args = call.getArguments();
  const title = args[0];
  // The body is the last function argument: `it(name, { timeout }, fn)`.
  const fn = [...args]
    .slice(1)
    .reverse()
    .find((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a));
  if (!title) {
    return false;
  }
  if (call.getExpression().getText().endsWith(".todo")) {
    return true;
  }
  // `scenario(title, build, steps)`: build may be any expression.
  if (root === "scenario") {
    return call.getArguments().length >= 3;
  }

  return !!fn && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn));
}

export function isTestCall(
  call: CallExpression,
  roots: string[] = ["it", "test"],
): boolean {
  return isBlock(call, roots);
}

export function isDescribeCall(call: CallExpression): boolean {
  return isBlock(call, ["describe", "suite"]);
}

function title(call: CallExpression): { text: string; dynamic: boolean } {
  const arg = call.getArguments()[0] as Node;
  const literal =
    Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg);
  if (literal && !isEach(call)) {
    return { text: arg.getLiteralText(), dynamic: false };
  }

  return { text: arg.getText(), dynamic: true };
}

/**
 * `roots` names the calls that register a test. Ported tests use `it` and
 * `test`; differential files also register through `scenario(name, build,
 * steps)`, whose second argument is the build function.
 */
export function staticTests(
  sf: SourceFile,
  roots: string[] = ["it", "test"],
): StaticTest[] {
  const out: StaticTest[] = [];
  const seen = new Map<string, number>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isTestCall(call, roots)) {
      continue;
    }
    const describes = call
      .getAncestors()
      .filter(
        (a): a is CallExpression =>
          Node.isCallExpression(a) && isDescribeCall(a),
      )
      .reverse();
    const parts = [...describes, call].map(title);
    let key = parts.map((p) => p.text).join(" > ");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      key = `${key} #${n}`;
    }
    out.push({
      key,
      dynamic: parts.some((p) => p.dynamic),
      call,
      describes,
    });
  }

  return out;
}
