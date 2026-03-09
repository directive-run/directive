/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import { el } from "../el.js";

// ============================================================================
// Basic Element Creation
// ============================================================================

describe("el()", () => {
  describe("element creation", () => {
    it("creates a div element", () => {
      const div = el("div");

      expect(div.tagName).toBe("DIV");
      expect(div).toBeInstanceOf(HTMLDivElement);
    });

    it("creates a span element", () => {
      const span = el("span");

      expect(span.tagName).toBe("SPAN");
      expect(span).toBeInstanceOf(HTMLSpanElement);
    });

    it("creates an anchor element", () => {
      const a = el("a");

      expect(a.tagName).toBe("A");
      expect(a).toBeInstanceOf(HTMLAnchorElement);
    });

    it("creates an input element", () => {
      const input = el("input");

      expect(input.tagName).toBe("INPUT");
      expect(input).toBeInstanceOf(HTMLInputElement);
    });

    it("creates a button element", () => {
      const button = el("button");

      expect(button.tagName).toBe("BUTTON");
      expect(button).toBeInstanceOf(HTMLButtonElement);
    });
  });

  // ============================================================================
  // Props
  // ============================================================================

  describe("props", () => {
    it("applies className", () => {
      const div = el("div", { className: "container" });

      expect(div.className).toBe("container");
    });

    it("applies id", () => {
      const div = el("div", { id: "main" });

      expect(div.id).toBe("main");
    });

    it("applies href to anchor", () => {
      const a = el("a", { href: "/home" });

      expect(a.href).toContain("/home");
    });

    it("applies type and value to input", () => {
      const input = el("input", { type: "text", value: "hello" });

      expect(input.type).toBe("text");
      expect(input.value).toBe("hello");
    });

    it("applies disabled to button", () => {
      const button = el("button", { disabled: true });

      expect(button.disabled).toBe(true);
    });

    it("handles empty props object", () => {
      const div = el("div", {});

      expect(div.tagName).toBe("DIV");
    });

    it("handles undefined props", () => {
      const div = el("div", undefined);

      expect(div.tagName).toBe("DIV");
    });
  });

  // ============================================================================
  // Children
  // ============================================================================

  describe("children", () => {
    it("appends a string child as text node", () => {
      const p = el("p", {}, "Hello world");

      expect(p.textContent).toBe("Hello world");
      expect(p.childNodes.length).toBe(1);
      expect(p.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);
    });

    it("appends multiple string children", () => {
      const p = el("p", {}, "Hello", " ", "world");

      expect(p.textContent).toBe("Hello world");
      expect(p.childNodes.length).toBe(3);
    });

    it("appends element children", () => {
      const child = el("span", {}, "inner");
      const parent = el("div", {}, child);

      expect(parent.children.length).toBe(1);
      expect(parent.children[0]).toBe(child);
      expect(parent.textContent).toBe("inner");
    });

    it("appends mixed string and element children", () => {
      const span = el("span", {}, "bold");
      const p = el("p", {}, "Hello ", span, " world");

      expect(p.childNodes.length).toBe(3);
      expect(p.textContent).toBe("Hello bold world");
    });

    it("flattens array children", () => {
      const items = ["one", "two", "three"].map((t) => el("li", {}, t));
      const ul = el("ul", {}, items);

      expect(ul.children.length).toBe(3);
      expect(ul.children[0]!.textContent).toBe("one");
      expect(ul.children[2]!.textContent).toBe("three");
    });

    it("handles nested arrays", () => {
      const group1 = [el("li", {}, "a"), el("li", {}, "b")];
      const group2 = [el("li", {}, "c")];
      const ul = el("ul", {}, group1, group2);

      expect(ul.children.length).toBe(3);
    });

    it("handles no children", () => {
      const div = el("div");

      expect(div.childNodes.length).toBe(0);
    });

    it("handles empty string child", () => {
      const p = el("p", {}, "");

      expect(p.textContent).toBe("");
      expect(p.childNodes.length).toBe(1);
    });
  });

  // ============================================================================
  // Falsy / Non-String Children
  // ============================================================================

  describe("falsy and non-string children", () => {
    it("silently skips null child", () => {
      const div = el("div", {}, null);

      expect(div.childNodes.length).toBe(0);
    });

    it("silently skips undefined child", () => {
      const div = el("div", {}, undefined);

      expect(div.childNodes.length).toBe(0);
    });

    it("silently skips false child", () => {
      const div = el("div", {}, false);

      expect(div.childNodes.length).toBe(0);
    });

    it("silently skips true child", () => {
      const div = el("div", {}, true);

      expect(div.childNodes.length).toBe(0);
    });

    it("coerces number child to text node", () => {
      const div = el("div", {}, 42);

      expect(div.textContent).toBe("42");
      expect(div.childNodes.length).toBe(1);
      expect(div.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);
    });

    it("coerces 0 to text node (not skipped)", () => {
      const div = el("div", {}, 0);

      expect(div.textContent).toBe("0");
      expect(div.childNodes.length).toBe(1);
    });

    it("handles mixed children with falsy values", () => {
      const div = el("div", {}, "hello", null, 42, false, el("span", {}, "!"));

      expect(div.childNodes.length).toBe(3);
      expect(div.textContent).toBe("hello42!");
    });

    it("supports conditional pattern (false && el(...))", () => {
      const showError = false;
      const div = el("div", {}, showError && el("p", {}, "Error"));

      expect(div.childNodes.length).toBe(0);
    });

    it("supports conditional pattern (true && el(...))", () => {
      const showError = true;
      const div = el("div", {}, showError && el("p", {}, "Error"));

      expect(div.childNodes.length).toBe(1);
      expect(div.textContent).toBe("Error");
    });
  });

  // ============================================================================
  // Event Handlers and Attribute Props
  // ============================================================================

  describe("event handler and attribute props", () => {
    it("assigns onclick handler as function property", () => {
      const handler = () => {};
      const button = el("button", { onclick: handler });

      expect(button.onclick).toBe(handler);
    });

    it("fires click handler via dispatchEvent", () => {
      let clicked = false;
      const button = el("button", { onclick: () => { clicked = true; } });

      button.dispatchEvent(new Event("click"));

      expect(clicked).toBe(true);
    });

    it("applies title attribute", () => {
      const div = el("div", { title: "tooltip" });

      expect(div.title).toBe("tooltip");
    });

    it("applies tabIndex attribute", () => {
      const div = el("div", { tabIndex: 3 });

      expect(div.tabIndex).toBe(3);
    });

    it("applies hidden attribute", () => {
      const div = el("div", { hidden: true });

      expect(div.hidden).toBe(true);
    });
  });

  // ============================================================================
  // Props Auto-Detection (skip empty {})
  // ============================================================================

  describe("props auto-detection", () => {
    it("treats string second arg as child, not props", () => {
      const p = el("p", "Hello");

      expect(p.textContent).toBe("Hello");
      expect(p.childNodes.length).toBe(1);
    });

    it("treats number second arg as child", () => {
      const span = el("span", 42);

      expect(span.textContent).toBe("42");
    });

    it("treats Node second arg as child", () => {
      const inner = el("span", "inner");
      const outer = el("div", inner);

      expect(outer.children.length).toBe(1);
      expect(outer.textContent).toBe("inner");
    });

    it("treats array second arg as children", () => {
      const items = [el("li", "one"), el("li", "two")];
      const ul = el("ul", items);

      expect(ul.children.length).toBe(2);
    });

    it("treats null second arg as skipped child", () => {
      const div = el("div", null, "after");

      expect(div.textContent).toBe("after");
    });

    it("treats false second arg as skipped child", () => {
      const div = el("div", false, "after");

      expect(div.textContent).toBe("after");
    });

    it("treats plain object second arg as props", () => {
      const div = el("div", { className: "box" }, "content");

      expect(div.className).toBe("box");
      expect(div.textContent).toBe("content");
    });

    it("works with string child and additional children", () => {
      const p = el("p", "Hello ", el("strong", "world"));

      expect(p.textContent).toBe("Hello world");
      expect(p.childNodes.length).toBe(2);
    });

    it("works with no args beyond tag", () => {
      const div = el("div");

      expect(div.childNodes.length).toBe(0);
    });

    it("works with undefined second arg", () => {
      const div = el("div", undefined, "child");

      expect(div.textContent).toBe("child");
    });
  });

  // ============================================================================
  // Security (BLOCKED_PROPS)
  // ============================================================================

  describe("BLOCKED_PROPS", () => {
    it("strips innerHTML from props (XSS prevention)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing security guard
      const div = el("div", { innerHTML: "<img src=x onerror=alert(1)>" } as any);

      expect(div.innerHTML).toBe("");
    });

    it("strips outerHTML from props (XSS prevention)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing security guard
      const div = el("div", { outerHTML: "<script>alert(1)</script>" } as any);

      expect(div.tagName).toBe("DIV");
    });

    it("still applies safe props alongside blocked ones", () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing security guard
      const div = el("div", { className: "safe", innerHTML: "<script>bad</script>" } as any);

      expect(div.className).toBe("safe");
      expect(div.innerHTML).toBe("");
    });
  });

  // ============================================================================
  // Nesting
  // ============================================================================

  describe("nesting", () => {
    it("supports deeply nested structures", () => {
      const tree = el(
        "div",
        { className: "root" },
        el(
          "header",
          {},
          el("h1", {}, "Title"),
        ),
        el(
          "main",
          {},
          el("p", {}, "Content"),
        ),
      );

      expect(tree.children.length).toBe(2);
      expect(tree.querySelector("h1")!.textContent).toBe("Title");
      expect(tree.querySelector("p")!.textContent).toBe("Content");
    });

    it("builds a complete list", () => {
      const items = ["Buy milk", "Walk dog"];
      const list = el(
        "ul",
        { className: "todo-list" },
        items.map((item) =>
          el("li", { className: "todo-item" }, item),
        ),
      );

      expect(list.className).toBe("todo-list");
      expect(list.children.length).toBe(2);
      expect(list.children[0]!.className).toBe("todo-item");
      expect(list.children[0]!.textContent).toBe("Buy milk");
    });
  });
});
