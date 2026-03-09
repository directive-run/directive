/**
 * Typed DOM element creation utility.
 *
 * Creates elements with props and children in a single call,
 * with full tag-to-element type inference.
 */

/** Valid child types for el() */
export type ElChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | Node
  | ElChild[];

/** Props that must never be set via Object.assign (XSS vectors). */
const BLOCKED_PROPS = new Set(["innerHTML", "outerHTML"]);

function isProps(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Node)
  );
}

function sanitizeProps<T>(props: Partial<T>): Partial<T> {
  const clean = { ...props };
  for (const key of BLOCKED_PROPS) {
    delete (clean as Record<string, unknown>)[key];
  }

  return clean;
}

/**
 * Create a typed DOM element with optional props and children.
 *
 * Props are auto-detected — if the second argument is a child, it's
 * treated as a child (no empty `{}` needed).
 *
 * @example
 * ```typescript
 * // With props
 * const link = el("a", { href: "/home" }, "Home");
 *
 * // Without props — no {} needed
 * el("p", "Hello world");
 * el("ul", items.map(i => el("li", i)));
 *
 * // Still works with explicit props
 * el("div", { className: "card" }, el("h2", "Title"));
 * ```
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  type: K,
  propsOrChild?: Partial<HTMLElementTagNameMap[K]> | ElChild,
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  let props: Partial<HTMLElementTagNameMap[K]> | undefined;

  if (isProps(propsOrChild)) {
    props = propsOrChild as Partial<HTMLElementTagNameMap[K]>;
  } else if (propsOrChild !== undefined) {
    children = [propsOrChild as ElChild, ...children];
  }

  const element = Object.assign(document.createElement(type), props ? sanitizeProps(props) : props);

  appendChildren(element, children);

  return element;
}

export function appendChildren(parent: Node, children: ElChild[]): void {
  for (const child of children) {
    if (child == null || typeof child === "boolean") {
      continue;
    }

    if (typeof child === "string") {
      parent.appendChild(document.createTextNode(child));
    } else if (typeof child === "number") {
      parent.appendChild(document.createTextNode(String(child)));
    } else if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else {
      parent.appendChild(child);
    }
  }
}
