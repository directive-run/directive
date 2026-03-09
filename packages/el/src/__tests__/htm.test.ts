/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import { html } from "../htm.js";

// ============================================================================
// htm tagged template
// ============================================================================

describe("html tagged template (htm)", () => {
  it("creates a simple element", () => {
    const div = html`<div />` as HTMLDivElement;

    expect(div.tagName).toBe("DIV");
  });

  it("applies props", () => {
    const div = html`<div className="card" />` as HTMLDivElement;

    expect(div.className).toBe("card");
  });

  it("renders string children", () => {
    const p = html`<p>Hello world</p>` as HTMLParagraphElement;

    expect(p.textContent).toBe("Hello world");
  });

  it("renders nested elements", () => {
    const card = html`
      <div className="card">
        <h2>Title</h2>
        <p>Body</p>
      </div>
    ` as HTMLDivElement;

    expect(card.children.length).toBe(2);
    expect(card.querySelector("h2")!.textContent).toBe("Title");
    expect(card.querySelector("p")!.textContent).toBe("Body");
  });

  it("interpolates expressions", () => {
    const count = 42;
    const span = html`<span>Count: ${count}</span>` as HTMLSpanElement;

    expect(span.textContent).toBe("Count: 42");
  });

  it("interpolates elements", () => {
    const inner = html`<strong>bold</strong>` as HTMLElement;
    const p = html`<p>Hello ${inner} world</p>` as HTMLParagraphElement;

    expect(p.textContent).toBe("Hello bold world");
    expect(p.querySelector("strong")).toBeTruthy();
  });

  it("renders mapped arrays", () => {
    const items = ["one", "two", "three"];
    const ul = html`
      <ul>
        ${items.map((item) => html`<li>${item}</li>`)}
      </ul>
    ` as HTMLUListElement;

    expect(ul.children.length).toBe(3);
    expect(ul.children[0]!.textContent).toBe("one");
  });

  it("applies event handlers", () => {
    let clicked = false;
    const btn = html`
      <button onclick=${() => { clicked = true; }}>Click</button>
    ` as HTMLButtonElement;

    btn.dispatchEvent(new Event("click"));

    expect(clicked).toBe(true);
  });

  it("applies id and other props", () => {
    const div = html`<div id="main" title="tooltip" />` as HTMLDivElement;

    expect(div.id).toBe("main");
    expect(div.title).toBe("tooltip");
  });
});
