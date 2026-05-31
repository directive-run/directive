import { describe, expect, it } from "vitest";
import { addHeader, isDomLine, stripDomWiring } from "../extract-examples";

describe("isDomLine", () => {
  it("flags document query selectors", () => {
    expect(isDomLine("const el = document.getElementById('root');")).toBe(true);
    expect(isDomLine("const card = document.querySelector('.card');")).toBe(
      true,
    );
  });

  it("flags element property mutations", () => {
    expect(isDomLine("el.innerHTML = '<div>x</div>';")).toBe(true);
    expect(isDomLine("button.textContent += '!';")).toBe(true);
    expect(isDomLine("badge.classList.add('on');")).toBe(true);
    expect(isDomLine("input.setAttribute('aria-busy', 'true');")).toBe(true);
  });

  it("flags element event listeners but not window listeners", () => {
    expect(isDomLine("button.addEventListener('click', onClick);")).toBe(true);
    expect(isDomLine("window.addEventListener('load', boot);")).toBe(false);
  });

  it("flags element-named const declarations", () => {
    expect(isDomLine("const buttonEl = getBtn();")).toBe(true);
    expect(isDomLine("const cardContainer = h('div');")).toBe(true);
    expect(isDomLine("const submitBtn = mkBtn();")).toBe(true);
  });

  it("does not flag plain module/system code", () => {
    expect(isDomLine("const system = createSystem({ module });")).toBe(false);
    expect(
      isDomLine("const trafficLight = createModule('traffic', { ... });"),
    ).toBe(false);
    expect(isDomLine("facts.phase = 'red';")).toBe(false);
  });

  it("flags HTMLElement casts", () => {
    expect(isDomLine("const node = el as HTMLButtonElement;")).toBe(true);
    expect(isDomLine("function paint(el: HTMLElement) { return el; }")).toBe(
      true,
    );
  });
});

describe("addHeader", () => {
  it("notes when source is pure", () => {
    const result = addHeader(
      { name: "counter", sourcePath: "counter/src/module.ts", pure: true },
      "export const m = 1;\n",
    );

    expect(result).toContain("// Example: counter");
    expect(result).toContain("// Source: examples/counter/src/module.ts");
    expect(result).toContain("// Pure module file — no DOM wiring");
    expect(result).toContain("export const m = 1;");
  });

  it("notes when DOM wiring was stripped", () => {
    const result = addHeader(
      { name: "demo", sourcePath: "demo/src/main.ts", pure: false },
      "export const m = 1;\n",
    );

    expect(result).toContain("// Extracted for AI rules — DOM wiring stripped");
  });

  it("keeps the body content intact below the header block", () => {
    const body = "import { x } from 'y';\nexport const m = createModule();\n";
    const result = addHeader(
      { name: "demo", sourcePath: "demo/src/module.ts", pure: true },
      body,
    );

    expect(result.endsWith(body)).toBe(true);
  });
});

describe("stripDomWiring", () => {
  it("preserves a pure module body (no DOM wiring to strip)", () => {
    const source = `import { createModule } from "@directive-run/core";

export const counter = createModule("counter", {
  schema: { facts: { count: { type: "number" } } },
  init: (f) => { f.count = 0; },
});
`;

    const result = stripDomWiring(source);

    expect(result).toContain("createModule");
    expect(result).toContain("init: (f) => { f.count = 0; }");
  });

  it("removes top-level document queries and element vars", () => {
    const source = `import { createSystem } from "@directive-run/core";
import { counter } from "./module";

const button = document.getElementById("inc");
const display = document.querySelector(".count");

const system = createSystem({ module: counter });
`;

    const result = stripDomWiring(source);

    expect(result).toContain("createSystem({ module: counter })");
    expect(result).not.toContain("document.getElementById");
    expect(result).not.toContain("document.querySelector");
  });

  it("removes function render() {} declarations entirely", () => {
    const source = `const system = createSystem({ module });

function render() {
  display.textContent = String(system.facts.count);
  button.disabled = false;
}

system.dispatch({ type: "increment" });
`;

    const result = stripDomWiring(source);

    expect(result).toContain("createSystem");
    expect(result).toContain("system.dispatch");
    expect(result).not.toContain("function render");
    expect(result).not.toContain("display.textContent");
  });

  it("removes system.subscribe(() => render()) wiring", () => {
    const source = `const system = createSystem({ module });
system.subscribe(() => render());

const inc = () => system.dispatch({ type: "increment" });
`;

    const result = stripDomWiring(source);

    expect(result).toContain("createSystem");
    expect(result).toContain("const inc = () => system.dispatch");
    expect(result).not.toContain("system.subscribe(() => render");
  });

  it("collapses 3+ consecutive blank lines down to 2", () => {
    const source = `const a = 1;




const b = 2;
`;

    const result = stripDomWiring(source);

    expect(result).not.toMatch(/\n\n\n\n/);
    expect(result).toMatch(/const a = 1;\n\n\nconst b = 2;/);
  });

  it("trims trailing blank lines but keeps a single newline", () => {
    const source = `const a = 1;


`;

    const result = stripDomWiring(source);

    expect(result.endsWith("const a = 1;\n")).toBe(true);
  });

  it("skips data-ready attribute wiring", () => {
    const source = `const system = createSystem({ module });

document.body.setAttribute("data-counter-ready", "true");
`;

    const result = stripDomWiring(source);

    expect(result).not.toContain("data-counter-ready");
    expect(result).not.toContain("document.body.setAttribute");
  });
});
