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

type ElProps<K extends keyof HTMLElementTagNameMap> =
  Omit<Partial<HTMLElementTagNameMap[K]>, "children"> & {
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

/** Props that must never be set via Object.assign (XSS vectors). */
const BLOCKED_PROPS = new Set(["innerHTML", "outerHTML"]);

export function jsx(
  type: string | ((props: Record<string, unknown>) => Node),
  props: Record<string, unknown>,
): HTMLElement | DocumentFragment {
  if (typeof type === "function") {
    return type(props) as HTMLElement | DocumentFragment;
  }

  const { children, ...rest } = props;
  for (const key of BLOCKED_PROPS) {
    delete rest[key];
  }

  const element = Object.assign(
    document.createElement(type),
    rest,
  );

  if (children != null) {
    const childArray = Array.isArray(children) ? children : [children];
    appendChildren(element, childArray as ElChild[]);
  }

  return element;
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export function Fragment(props: { children?: ElChild | ElChild[] }): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (props.children != null) {
    const children = Array.isArray(props.children)
      ? props.children
      : [props.children];
    appendChildren(fragment, children);
  }

  return fragment;
}
