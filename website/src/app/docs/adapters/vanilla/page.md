---
title: Vanilla Adapter
description: Use Directive with vanilla JavaScript and TypeScript. Typed element creation, reactive DOM bindings, JSX runtime, and htm tagged templates — no framework required.
---

Directive's vanilla adapter gives you three ways to build reactive UIs with zero framework overhead. Create typed DOM elements, bind them to system state, and choose from `el()` calls, JSX, or htm tagged templates. {% .lead %}

---

## Installation

`@directive-run/el` versions independently from the rest of the Directive ecosystem. Its core (`el()`, JSX, htm) has zero dependency on `@directive-run/core`.

```bash
# Standalone — no Directive dependency
npm install @directive-run/el

# With reactive bindings (bind, bindText, mount)
npm install @directive-run/el @directive-run/core

# For htm tagged templates (optional)
npm install htm
```

---

## Three Ways to Write

```typescript
// 1. el() — function calls, no build step
el("div", { className: "card" }, el("h2", "Title"), el("p", "Body"))

// 2. JSX — familiar syntax, compiles to el() calls
<div className="card"><h2>Title</h2><p>Body</p></div>

// 3. htm — tagged templates, no build step
html`<div className="card"><h2>Title</h2><p>Body</p></div>`
```

All three produce real DOM nodes. No virtual DOM, no diffing, no reconciliation.

---

## Setup

Create your system in a shared file:

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

---

## el() — Element Creation

Create typed DOM elements with optional props and children. Props are auto-detected — if the second argument is a child, the empty `{}` is not needed.

```typescript
import { el } from "@directive-run/el";

// Without props — no {} needed
el("p", "Hello world")
el("ul", items.map(item => el("li", item)))
el("div", el("h1", "Title"), el("p", "Body"))

// With props — plain objects detected as props
el("a", { href: "/home", className: "nav" }, "Home")
el("input", { type: "email", value: "a@b.com" })

// Event handlers attached at creation
el("button", { onclick: () => save() }, "Save")

// Conditional children — false/null/undefined silently skipped
el("div", hasError && el("p", { className: "error" }, message))

// Numbers coerce to text nodes
el("span", "Score: ", score)
```

### Type Safety

The return type is inferred from the tag name:

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

Write JSX that compiles to `el()` calls. No React required.

### Setup

Add to your `tsconfig.json`:

```json
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
import { system } from "./system";

const app = (
  <div className="card">
    <h2>Counter</h2>
    <p>Count: {system.facts.count}</p>
    <button onclick={() => system.dispatch({ type: "increment" })}>+</button>
    <button onclick={() => system.dispatch({ type: "decrement" })}>-</button>
    {showError && <p className="error">Something went wrong</p>}
    <ul>
      {items.map(item => <li>{item}</li>)}
    </ul>
  </div>
);

document.body.appendChild(app);
```

{% callout type="note" title="JSX produces real DOM nodes" %}
Unlike React, this JSX creates actual `HTMLElement` instances. There is no virtual DOM, no reconciliation, and no component lifecycle. For reactive updates, combine with `bind()`, `bindText()`, or `mount()`.
{% /callout %}

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
    <h2>Counter</h2>
    <p>Count: ${count}</p>
    <button onclick=${() => increment()}>+</button>
    <ul>
      ${items.map(item => html`<li>${item}</li>`)}
    </ul>
  </div>
`;

document.body.appendChild(app);
```

Works in plain `.js` files with no TypeScript or bundler. Great for prototyping, CDN-based projects, or `<script type="module">` in HTML files.

---

## Reactive Bindings

### bind()

Subscribe an element to a Directive system. The updater runs immediately with current state, then on every change. Returns a cleanup function.

```typescript
import { el, bind } from "@directive-run/el";

const badge = el("span", { className: "badge" });

const cleanup = bind(system, badge, (el, facts, derived) => {
  el.textContent = `${facts.count}`;
  el.className = facts.count > 10 ? "badge high" : "badge low";
});

// Later: unsubscribe
cleanup();
```

### bindText()

Shorthand for binding text content:

```typescript
import { el, bindText } from "@directive-run/el";

const label = el("span");

const cleanup = bindText(system, label, (facts, derived) => {
  return `${derived.doubled} items`;
});
```

### mount()

Replace a container's children on every state change. Uses `replaceChildren()` for a single DOM operation per update. Ideal for lists and conditional rendering.

```typescript
import { el, mount } from "@directive-run/el";

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

---

## Multi-Module Systems

For namespaced systems with multiple modules, use `system.subscribe()` directly instead of `bind()`:

```typescript
import { el } from "@directive-run/el";
import { createSystem } from "@directive-run/core";

const system = createSystem({
  modules: { rocket: rocketModule, ship: shipModule, nav: navModule },
});
system.start();

const fuelSpan = el("span");
const hullSpan = el("span");
const distSpan = el("span");

system.subscribe(["rocket.*"], () => {
  fuelSpan.textContent = `${Math.round(system.facts.rocket.fuel)}%`;
});

system.subscribe(["ship.*"], () => {
  hullSpan.textContent = `${Math.round(system.facts.ship.hull)}%`;
});

system.subscribe(["nav.*"], () => {
  distSpan.textContent = `${Math.round(system.facts.nav.distance)} km`;
});
```

---

## Patterns

### Full Page with el()

```typescript
import { el, bind, bindText, mount } from "@directive-run/el";
import { system } from "./system";

// Build the UI declaratively
const countSpan = el("span");
const listEl = el("ul");

bindText(system, countSpan, (facts) => `${facts.count}`);

mount(system, listEl, (facts) => {
  return facts.items.map(item => el("li", item));
});

const app = el("div", { className: "app" },
  el("header",
    el("h1", "My App"),
    el("p", "Count: ", countSpan),
  ),
  el("main",
    el("button", { onclick: () => system.dispatch({ type: "increment" }) }, "+"),
    el("button", { onclick: () => system.dispatch({ type: "decrement" }) }, "-"),
    listEl,
  ),
);

document.body.appendChild(app);
```

### CDN Usage with htm

```html
<script type="module">
  import { createModule, createSystem, t } from "https://esm.sh/@directive-run/core";
  import { el } from "https://esm.sh/@directive-run/el";
  import htm from "https://esm.sh/htm";

  const html = htm.bind(el);

  // ... define module and system ...

  const app = html`
    <div className="app">
      <h1>Hello from the CDN</h1>
    </div>
  `;

  document.body.appendChild(app);
</script>
```

### Combining with Other Frameworks

`el()` creates standard DOM nodes, so you can use it alongside any framework:

```typescript
// Inside a React useEffect
useEffect(() => {
  const widget = el("div", { className: "widget" },
    el("canvas", { id: "chart", width: 400, height: 200 }),
  );
  containerRef.current?.appendChild(widget);
  return () => widget.remove();
}, []);
```

---

## Next Steps

- **[API Reference](/docs/api/vanilla)** – Full API documentation
- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Core Concepts](/docs/core-concepts)** – Facts, derivations, and constraints
