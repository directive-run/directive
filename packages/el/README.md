# @directive-run/el

[![npm](https://img.shields.io/npm/v/@directive-run/el?color=%236366f1)](https://www.npmjs.com/package/@directive-run/el)
[![downloads](https://img.shields.io/npm/dm/@directive-run/el)](https://www.npmjs.com/package/@directive-run/el)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/el)](https://bundlephobia.com/package/@directive-run/el)

Typed element creation, JSX runtime, and htm support — no framework required. Versions independently from the rest of the [Directive](https://www.npmjs.com/package/@directive-run/core) ecosystem.

Use `el()` standalone for any vanilla DOM project. Add `@directive-run/core` for reactive bindings (`bind`, `bindText`, `mount`).

## Three Ways to Write

```typescript
// 1. el() — function calls
el("div", { className: "card" }, el("h2", "Title"), el("p", "Body"))

// 2. JSX — familiar component syntax, no React
<div className="card"><h2>Title</h2><p>Body</p></div>

// 3. htm — tagged templates, no build step
html`<div className="card"><h2>Title</h2><p>Body</p></div>`
```

All three produce real DOM nodes. Pick what fits your project.

## Install

```bash
# Standalone — no Directive dependency
npm install @directive-run/el

# With reactive bindings (requires Directive)
npm install @directive-run/el @directive-run/core

# For htm (optional)
npm install htm
```

## Standalone Usage

`el()` works without Directive — just typed DOM creation:

```typescript
import { el } from "@directive-run/el";

const app = el("div", { className: "card" },
  el("h2", "Hello"),
  el("p", "No framework needed."),
  el("button", { onclick: () => alert("clicked") }, "Click me"),
);

document.body.appendChild(app);
```

## With Directive

Add reactive bindings to a Directive system:

```typescript
// system.ts
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    facts: { count: t.number() },
    derivations: { doubled: t.number() },
    events: { increment: {}, decrement: {} },
    requirements: {},
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
  events: {
    increment: (facts) => { facts.count += 1; },
    decrement: (facts) => { facts.count -= 1; },
  },
});

export const system = createSystem({ module: counter });
system.start();
```

```typescript
// main.ts — using el()
import { el, bindText } from "@directive-run/el";
import { system } from "./system";

const countSpan = el("span");
const doubledSpan = el("span");

bindText(system, countSpan, (facts) => `${facts.count}`);
bindText(system, doubledSpan, (_facts, derived) => `${derived.doubled}`);

const app = el("div",
  el("p", "Count: ", countSpan, " (doubled: ", doubledSpan, ")"),
  el("button", { onclick: () => system.dispatch({ type: "increment" }) }, "+"),
  el("button", { onclick: () => system.dispatch({ type: "decrement" }) }, "−"),
);

document.body.appendChild(app);
```

---

## el()

Create a typed DOM element with optional props and children in a single call.

**Props are auto-detected** — if the second argument is a child (string, number, Node, array), the empty `{}` is not needed:

```typescript
import { el } from "@directive-run/el";

// Props auto-detection — no empty {} needed
el("p", "Hello world")
el("ul", items.map(item => el("li", item)))
el("div", el("h1", "Title"), el("p", "Body"))

// With props — plain objects are detected as props
el("a", { href: "/home", className: "nav" }, "Home")
el("input", { type: "email", value: "a@b.com" })

// Array children are flattened (great for .map())
el("ul", items.map(item => el("li", item)))

// Event handlers attached at creation
el("button", { onclick: () => save() }, "Save")

// Conditional children — false/null/undefined silently skipped
el("div", hasError && el("p", { className: "error" }, message))

// Numbers coerce to text nodes
el("span", "Score: ", score)
```

### Type Safety

Return type is inferred from the tag name:

```typescript
const input = el("input", { type: "email" });
//    ^? HTMLInputElement — type, value, checked all auto-complete

const canvas = el("canvas", { width: 800, height: 600 });
//    ^? HTMLCanvasElement — getContext() available
```

### Children Types

| Type | Behavior |
|------|----------|
| `string` | Creates a text node |
| `number` | Coerces to text node (`0` renders as "0") |
| `Node` | Appended directly |
| `ElChild[]` | Flattened recursively |
| `null`, `undefined`, `false`, `true` | Silently skipped |

---

## JSX Runtime

Write JSX that compiles to `el()` calls — no React required.

### Setup

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@directive-run/el"
  }
}
```

### Usage

```tsx
// App.tsx
const app = (
  <div className="card">
    <h2>Title</h2>
    <p>Count: {count}</p>
    <button onclick={() => increment()}>+</button>
    {showError && <p className="error">Something went wrong</p>}
    <ul>
      {items.map(item => <li>{item}</li>)}
    </ul>
  </div>
);

document.body.appendChild(app);
```

JSX produces real DOM nodes — same as calling `el()` directly. No virtual DOM, no diffing, no reconciliation.

---

## htm (Tagged Templates)

Write HTML-like templates with no build step. Uses [htm](https://github.com/developit/htm) (700 bytes) bound to `el()`.

### Setup

```bash
npm install htm
```

### Usage

```typescript
import { html } from "@directive-run/el/htm";

const app = html`
  <div className="card">
    <h2>Title</h2>
    <p>Count: ${count}</p>
    <button onclick=${() => increment()}>+</button>
    <ul>
      ${items.map(item => html`<li>${item}</li>`)}
    </ul>
  </div>
`;

document.body.appendChild(app);
```

Works in plain `.js` files — no TypeScript or bundler needed. Great for prototyping, CDN-based projects, or `<script type="module">` in HTML files.

---

## Reactive Bindings

### bind()

Subscribe an element to a Directive system. Called immediately with current state, then on every change.

```typescript
import { bind } from "@directive-run/el";

const badge = el("span", { className: "badge" });

const cleanup = bind(system, badge, (el, facts, derived) => {
  el.textContent = `${facts.count}`;
  el.className = facts.count > 10 ? "badge high" : "badge low";
});

cleanup(); // unsubscribe
```

### bindText()

Shorthand for binding text content:

```typescript
import { bindText } from "@directive-run/el";

const label = el("span");
const cleanup = bindText(system, label, (facts, derived) => {
  return `${derived.doubled} items`;
});
```

### mount()

Replace a container's children on every state change. Uses `replaceChildren()` for a single DOM operation. Ideal for lists and conditional rendering.

```typescript
import { mount } from "@directive-run/el";

const listEl = el("ul");

const cleanup = mount(system, listEl, (facts) => {
  return facts.items.map(item => el("li", item));
});
```

The renderer can return a single node or an array:

```typescript
mount(system, container, (facts) => {
  if (facts.loading) {
    return el("p", "Loading...");
  }
  return [
    el("h2", "Results"),
    el("ul", results.map(r => el("li", r))),
  ];
});
```

## Multi-Module Systems

For namespaced systems with multiple modules, use `system.subscribe()` directly:

```typescript
const system = createSystem({
  modules: { rocket: rocketModule, ship: shipModule },
});
system.start();

const fuelSpan = el("span");
const hullSpan = el("span");

system.subscribe(["rocket.*"], () => {
  fuelSpan.textContent = `${Math.round(system.facts.rocket.fuel)}%`;
});

system.subscribe(["ship.*"], () => {
  hullSpan.textContent = `${Math.round(system.facts.ship.hull)}%`;
});
```

## API Reference

### Main (`@directive-run/el`)

| Export | Description |
|--------|-------------|
| `el(tag, propsOrChild?, ...children)` | Create a typed DOM element. Props auto-detected. |
| `bind(system, element, updater)` | Subscribe element to system state. Returns cleanup. |
| `bindText(system, element, selector)` | Bind text content to system state. Returns cleanup. |
| `mount(system, container, renderer)` | Replace children on state change. Returns cleanup. |
| `ElChild` | Type: `string \| number \| boolean \| null \| undefined \| Node \| ElChild[]` |

### JSX Runtime (`@directive-run/el/jsx-runtime`)

| Export | Description |
|--------|-------------|
| `jsx`, `jsxs`, `jsxDEV` | JSX automatic transform functions |
| `Fragment` | Renders children into a `DocumentFragment` |
| `JSX` namespace | `IntrinsicElements` and `Element` types |

### htm (`@directive-run/el/htm`)

| Export | Description |
|--------|-------------|
| `html` | Tagged template bound to `el()` via [htm](https://github.com/developit/htm) |

## Peer Dependencies

- `@directive-run/core` (optional — only needed for `bind`, `bindText`, `mount`)
- `htm` >= 3 (optional — only needed for `@directive-run/el/htm`)

## Documentation

- [Vanilla Adapter Guide](https://directive.run/docs/adapters/vanilla)
- [API Reference](https://directive.run/docs/api)

## License

MIT
