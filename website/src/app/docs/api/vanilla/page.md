---
title: Vanilla API
description: Complete API reference for @directive-run/el – el(), bind(), bindText(), mount(), JSX runtime, and htm tagged templates.
---

Vanilla adapter API reference. Three entry points – main package, JSX runtime, and htm binding. {% .lead %}

---

## Quick Reference

### Main (`@directive-run/el`)

| Export | Type | Description |
|--------|------|-------------|
| `el` | Function | Create a typed DOM element |
| `bind` | Function | Subscribe element to system state |
| `bindText` | Function | Bind text content to system state |
| `mount` | Function | Replace children on state change |
| `ElChild` | Type | Union of valid child types |

### JSX Runtime (`@directive-run/el/jsx-runtime`)

| Export | Type | Description |
|--------|------|-------------|
| `jsx` | Function | JSX automatic transform (production) |
| `jsxs` | Function | JSX with static children (production) |
| `jsxDEV` | Function | JSX automatic transform (development) |
| `Fragment` | Function | Renders children into a `DocumentFragment` |
| `JSX` | Namespace | `IntrinsicElements` and `Element` types |

### htm (`@directive-run/el/htm`)

| Export | Type | Description |
|--------|------|-------------|
| `html` | Tagged template | htm bound to `el()` |

---

## el()

Create a typed DOM element with optional props and children.

```typescript
function el<K extends keyof HTMLElementTagNameMap>(
  type: K,
  propsOrChild?: Partial<HTMLElementTagNameMap[K]> | ElChild,
  ...children: ElChild[]
): HTMLElementTagNameMap[K]
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `type` | `K extends keyof HTMLElementTagNameMap` | HTML tag name (`"div"`, `"span"`, `"input"`, etc.) |
| `propsOrChild` | `Partial<HTMLElementTagNameMap[K]> \| ElChild` | Props object or first child (auto-detected) |
| `children` | `ElChild[]` | Additional children |

**Returns:** `HTMLElementTagNameMap[K]` – the typed DOM element.

**Props auto-detection:** If the second argument is a string, number, boolean, `null`, `undefined`, `Node`, or array, it is treated as a child. Plain objects are treated as props.

```typescript
// These are equivalent
el("p", {}, "Hello")
el("p", "Hello")

// Props detected as object
el("div", { className: "card" }, "content")

// Child detected as string
el("div", "content")

// Child detected as Node
el("div", el("span", "inner"))

// Child detected as array
el("ul", items.map(i => el("li", i)))
```

### ElChild

```typescript
type ElChild =
  | string      // → text node
  | number      // → text node (coerced via String())
  | boolean     // → silently skipped
  | null        // → silently skipped
  | undefined   // → silently skipped
  | Node        // → appended directly
  | ElChild[]   // → flattened recursively
```

---

## bind()

Subscribe an element to a Directive system. The updater runs immediately with current state, then on every fact change.

```typescript
function bind<E extends HTMLElement>(
  system: SingleModuleSystem<any>,
  element: E,
  updater: (
    el: E,
    facts: Record<string, unknown>,
    derived: Record<string, unknown>,
  ) => void,
): () => void
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `system` | `SingleModuleSystem` | A started Directive system |
| `element` | `E extends HTMLElement` | The element to bind |
| `updater` | `(el, facts, derived) => void` | Called on every state change |

**Returns:** `() => void` – cleanup function that unsubscribes.

```typescript
const span = el("span");

const cleanup = bind(system, span, (el, facts, derived) => {
  el.textContent = `${facts.count}`;
  el.className = derived.isHigh ? "high" : "low";
});

// Unsubscribe
cleanup();
```

---

## bindText()

Shorthand for binding text content. Equivalent to `bind()` with `el.textContent = selector(facts, derived)`.

```typescript
function bindText(
  system: SingleModuleSystem<any>,
  element: HTMLElement,
  selector: (
    facts: Record<string, unknown>,
    derived: Record<string, unknown>,
  ) => string,
): () => void
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `system` | `SingleModuleSystem` | A started Directive system |
| `element` | `HTMLElement` | The element to bind |
| `selector` | `(facts, derived) => string` | Returns the text to display |

**Returns:** `() => void` – cleanup function that unsubscribes.

```typescript
const label = el("span");

const cleanup = bindText(system, label, (facts, derived) => {
  return `${derived.doubled} items`;
});
```

---

## mount()

Replace a container's children on every state change. Uses `replaceChildren()` for a single DOM operation per update.

```typescript
function mount(
  system: SingleModuleSystem<any>,
  container: HTMLElement,
  renderer: (
    facts: Record<string, unknown>,
    derived: Record<string, unknown>,
  ) => Node | Node[],
): () => void
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `system` | `SingleModuleSystem` | A started Directive system |
| `container` | `HTMLElement` | The container whose children are replaced |
| `renderer` | `(facts, derived) => Node \| Node[]` | Returns the new children |

**Returns:** `() => void` – cleanup function that unsubscribes.

The renderer can return a single `Node` or an array of `Node`s:

```typescript
// Array of nodes
mount(system, listEl, (facts) => {
  return items.map(item => el("li", item));
});

// Single node
mount(system, container, (facts) => {
  return el("p", "Loading...");
});
```

---

## JSX Runtime

The JSX runtime allows writing JSX that compiles to `el()` calls without React.

### Setup

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@directive-run/el"
  }
}
```

### jsx / jsxs / jsxDEV

```typescript
function jsx(type: string, props: Record<string, unknown>): HTMLElement
```

These are called by the JSX compiler – you don't call them directly. They extract `children` from props and pass everything else to `el()`.

### Fragment

```typescript
function Fragment(props: { children?: ElChild | ElChild[] }): DocumentFragment
```

Renders children into a `DocumentFragment` (no wrapper element):

```tsx
const items = (
  <>
    <li>One</li>
    <li>Two</li>
  </>
);
```

### JSX Namespace

```typescript
namespace JSX {
  type IntrinsicElements = {
    [K in keyof HTMLElementTagNameMap]:
      Omit<Partial<HTMLElementTagNameMap[K]>, "children"> & {
        children?: ElChild | ElChild[];
      };
  };
  type Element = HTMLElement;
}
```

All HTML element props are available with full type inference. The `children` prop accepts `ElChild` values (strings, numbers, nodes, arrays, null/undefined/boolean).

---

## htm

Tagged template binding using [htm](https://github.com/developit/htm). Requires `htm` as a peer dependency.

### html

```typescript
import { html } from "@directive-run/el/htm";

const element = html`<div className="card">Hello</div>`;
```

`html` is `htm.bind(el)` – it parses the tagged template and calls `el()` for each element. Supports interpolation, nested elements, event handlers, and array children.

---

## Peer Dependencies

| Package | Required | Notes |
|---------|----------|-------|
| `@directive-run/core` | Yes | Core runtime |
| `htm` | Optional | Only for `@directive-run/el/htm` |

---

## Bundle Size

| Entry | ESM | CJS |
|-------|-----|-----|
| `@directive-run/el` | 1.3 KB | 1.4 KB |
| `@directive-run/el/jsx-runtime` | 0.7 KB | 0.8 KB |
| `@directive-run/el/htm` | 0.6 KB | 0.7 KB |

All sizes are minified with source maps. htm (700 bytes) is external.
