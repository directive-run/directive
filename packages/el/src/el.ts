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

/**
 * Props that must never be set via `Object.assign`.
 *
 * Three categories:
 *
 * 1. **XSS sinks** — `innerHTML`, `outerHTML`, `srcdoc` write raw
 *    markup that bypasses text-node escaping. Always rejected.
 * 2. **Prototype-pollution keys** — `__proto__`, `constructor`,
 *    `prototype` reach the element's prototype chain via
 *    `Object.assign` and can break the entire DOM API for the page.
 *    Mirrors `@directive-run/core`'s `BLOCKED_PROPS` so the two
 *    deny-sets can't drift.
 * 3. **Inline event handlers** — `onclick`, `onerror`, `onmouseover`,
 *    etc. are detected by prefix at sanitize time (see
 *    `sanitizeProps`) and rejected when their value is anything other
 *    than a function. Untrusted facts that happen to be strings
 *    starting with `on...` would otherwise let an attacker register
 *    a JS-string event handler at runtime.
 *
 * Shared between `el()` and the JSX runtime so the two render paths
 * can't drift on what's considered unsafe to write to an Element.
 */
export const XSS_BLOCKED_PROPS = new Set([
  "innerHTML",
  "outerHTML",
  "srcdoc",
  "__proto__",
  "constructor",
  "prototype",
]);
const BLOCKED_PROPS = XSS_BLOCKED_PROPS;

function isProps(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Node)
  );
}

function isUnsafeEventHandlerKey(key: string, value: unknown): boolean {
  // `on<name>` keys WRITTEN AS STRINGS register inline JS handlers.
  // A function value is the legitimate React-style `onClick` shape;
  // a string value is the attack vector.
  return key.length > 2 && key.startsWith("on") && typeof value !== "function";
}

function sanitizeProps<T>(props: Partial<T>): Partial<T> {
  const clean: Record<string, unknown> = {};
  // Use `Object.entries` to skip inherited keys + only copy own keys.
  // Spread `{ ...props }` would copy `__proto__` if it appears as an
  // OWN key on the input, which the core BLOCKED_PROPS set covers but
  // we re-filter here so the check is co-located with the unsafe-
  // handler reject.
  for (const [key, value] of Object.entries(props as object)) {
    if (BLOCKED_PROPS.has(key)) continue;
    if (isUnsafeEventHandlerKey(key, value)) continue;
    clean[key] = value;
  }

  return clean as Partial<T>;
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

  const element = Object.assign(
    document.createElement(type),
    props ? sanitizeProps(props) : props,
  );

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
