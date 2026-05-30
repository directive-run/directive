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
      <button onclick=${() => {
        clicked = true;
      }}>Click</button>
    ` as HTMLButtonElement;

    btn.dispatchEvent(new Event("click"));

    expect(clicked).toBe(true);
  });

  it("applies id and other props", () => {
    const div = html`<div id="main" title="tooltip" />` as HTMLDivElement;

    expect(div.id).toBe("main");
    expect(div.title).toBe("tooltip");
  });

  // XSS-relevant props (`innerHTML`, `outerHTML`, `srcdoc`) are blocked at the
  // `el()` layer that htm dispatches through. The htm path goes via the same
  // sink, so these tests guarantee a future change to the htm parser cannot
  // skip the blocklist without an explicit test failure.
  describe("XSS-blocked props", () => {
    it("ignores innerHTML interpolated through htm", () => {
      const payload = "<script>alert(1)</script>";
      const div = html`<div innerHTML=${payload} />` as HTMLDivElement;
      expect(div.innerHTML).toBe("");
      expect(div.querySelector("script")).toBeNull();
    });

    it("ignores outerHTML interpolated through htm", () => {
      const div = html`<div outerHTML=${"<b>x</b>"} />` as HTMLDivElement;
      // outerHTML write would replace the element; the blocklist prevents
      // that, so the original empty `<div>` survives.
      expect(div.tagName).toBe("DIV");
      expect(div.children.length).toBe(0);
    });

    it("ignores srcdoc on iframes interpolated through htm", () => {
      const iframe =
        html`<iframe srcdoc=${"<script>alert(1)</script>"} />` as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toBeNull();
      // srcdoc as a DOM property is undefined-or-empty when never set
      expect(iframe.srcdoc ?? "").toBe("");
    });
  });
});
