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
  const [title, fn] = call.getArguments();
  if (!title) {
    return false;
  }
  if (call.getExpression().getText().endsWith(".todo")) {
    return true;
  }

  return !!fn && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn));
}

export function isTestCall(call: CallExpression): boolean {
  return isBlock(call, ["it", "test"]);
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

export function staticTests(sf: SourceFile): StaticTest[] {
  const out: StaticTest[] = [];
  const seen = new Map<string, number>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isTestCall(call)) {
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
