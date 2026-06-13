/**
 * JSX automatic runtime for @directive-run/el.
 *
 * Usage — set in tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "jsx": "react-jsx",
 *     "jsxImportSource": "@directive-run/el"
 *   }
 * }
 *
 * Then write JSX that compiles to el() calls:
 *   <div className="card"><h2>Title</h2></div>
 */

import { type ElChild, appendChildren } from "./el.js";

type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<
  Partial<HTMLElementTagNameMap[K]>,
  "children"
> & {
  children?: ElChild | ElChild[];
};

type IntrinsicEl = {
  [K in keyof HTMLElementTagNameMap]: ElProps<K>;
};

export namespace JSX {
  export type IntrinsicElements = IntrinsicEl;
  // HTMLElement for intrinsic elements. Fragment returns DocumentFragment at
  // runtime but TypeScript's JSX type system requires a single Element type.
  export type Element = HTMLElement;
}

import { XSS_BLOCKED_PROPS } from "./el.js";

const BLOCKED_PROPS = XSS_BLOCKED_PROPS;

export function jsx(
  type: string | ((props: Record<string, unknown>) => Node),
  props: Record<string, unknown>,
): HTMLElement | DocumentFragment {
  if (typeof type === "function") {
    return type(props) as HTMLElement | DocumentFragment;
  }

  const { children, ...rest } = props;
  // Mirror `sanitizeProps` in el.ts: drop XSS sinks (innerHTML family),
  // prototype-pollution keys (__proto__ / constructor / prototype),
  // and string-valued `on<Event>` handlers (function-valued is the
  // legitimate JSX path; string-valued is the attack vector).
  for (const key of Object.keys(rest)) {
    if (BLOCKED_PROPS.has(key)) {
      delete rest[key];
      continue;
    }
    if (
      key.length > 2 &&
      key.startsWith("on") &&
      typeof rest[key] !== "function"
    ) {
      delete rest[key];
    }
  }

  const element = Object.assign(document.createElement(type), rest);

  if (children != null) {
    const childArray = Array.isArray(children) ? children : [children];
    appendChildren(element, childArray as ElChild[]);
  }

  return element;
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export function Fragment(props: {
  children?: ElChild | ElChild[];
}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (props.children != null) {
    const children = Array.isArray(props.children)
      ? props.children
      : [props.children];
    appendChildren(fragment, children);
  }

  return fragment;
}
