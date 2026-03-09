/**
 * @vitest-environment happy-dom
 */

/* @jsxImportSource @directive-run/el */

import { describe, expect, it } from "vitest";

// ============================================================================
// JSX Runtime
// ============================================================================

describe("JSX runtime", () => {
  it("creates a simple element", () => {
    const div = <div />;

    expect(div.tagName).toBe("DIV");
    expect(div).toBeInstanceOf(HTMLDivElement);
  });

  it("applies className prop", () => {
    const div = <div className="card" />;

    expect(div.className).toBe("card");
  });

  it("applies id prop", () => {
    const div = <div id="main" />;

    expect(div.id).toBe("main");
  });

  it("renders string children", () => {
    const p = <p>Hello world</p>;

    expect(p.textContent).toBe("Hello world");
  });

  it("renders nested elements", () => {
    const card = (
      <div className="card">
        <h2>Title</h2>
        <p>Body</p>
      </div>
    );

    expect(card.children.length).toBe(2);
    expect(card.querySelector("h2")!.textContent).toBe("Title");
    expect(card.querySelector("p")!.textContent).toBe("Body");
  });

  it("renders expression children", () => {
    const count = 42;
    const span = <span>Count: {count}</span>;

    expect(span.textContent).toBe("Count: 42");
  });

  it("renders array children via map", () => {
    const items = ["one", "two", "three"];
    const ul = (
      <ul>
        {items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    );

    expect(ul.children.length).toBe(3);
    expect(ul.children[0]!.textContent).toBe("one");
    expect(ul.children[2]!.textContent).toBe("three");
  });

  it("skips null/undefined/boolean children", () => {
    const div = (
      <div>
        {null}
        {undefined}
        {false}
        {true}
        <span>real</span>
      </div>
    );

    expect(div.children.length).toBe(1);
    expect(div.textContent).toBe("real");
  });

  it("renders conditional children", () => {
    const showError = true;
    const div = <div>{showError && <p>Error!</p>}</div>;

    expect(div.querySelector("p")!.textContent).toBe("Error!");
  });

  it("skips conditional children when false", () => {
    const showError = false;
    const div = <div>{showError && <p>Error!</p>}</div>;

    expect(div.querySelector("p")).toBeNull();
  });

  it("applies event handlers", () => {
    let clicked = false;
    const btn = <button onclick={() => { clicked = true; }}>Click</button>;

    btn.dispatchEvent(new Event("click"));

    expect(clicked).toBe(true);
  });

  it("renders a single child without wrapping in array", () => {
    const div = <div><span>only</span></div>;

    expect(div.children.length).toBe(1);
    expect(div.textContent).toBe("only");
  });

  it("strips innerHTML prop (XSS prevention)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing security guard
    const div = <div {...{ innerHTML: "<img src=x onerror=alert(1)>" } as any} />;

    expect(div.innerHTML).toBe("");
  });

  it("strips outerHTML prop (XSS prevention)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing security guard
    const div = <div {...{ outerHTML: "<script>alert(1)</script>" } as any} />;

    expect(div.tagName).toBe("DIV");
  });
});

// ============================================================================
// Fragment
// ============================================================================

describe("Fragment", () => {
  it("renders children into a DocumentFragment", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Fragment returns DocumentFragment at runtime
    const frag = (<><li>One</li><li>Two</li></>) as any as DocumentFragment;

    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(2);
  });

  it("renders text children", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Fragment returns DocumentFragment at runtime
    const frag = (<>Hello world</>) as any as DocumentFragment;

    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.textContent).toBe("Hello world");
  });

  it("renders mixed element and text children", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Fragment returns DocumentFragment at runtime
    const frag = (<>Hello<span>world</span></>) as any as DocumentFragment;

    expect(frag.childNodes.length).toBe(2);
    expect(frag.textContent).toBe("Helloworld");
  });

  it("renders empty fragment with no children", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Fragment returns DocumentFragment at runtime
    const frag = (<></>) as any as DocumentFragment;

    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(0);
  });

  it("appends fragment children to a parent element", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Fragment returns DocumentFragment at runtime
    const frag = (<><li>A</li><li>B</li><li>C</li></>) as any as DocumentFragment;

    const ul = <ul />;
    ul.appendChild(frag);

    expect(ul.children.length).toBe(3);
    expect(ul.children[0]!.textContent).toBe("A");
    expect(ul.children[2]!.textContent).toBe("C");
  });
});
