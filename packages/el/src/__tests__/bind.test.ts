/**
 * @vitest-environment happy-dom
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { bind, bindText, mount } from "../bind.js";
import { el } from "../el.js";

// ============================================================================
// Helpers
// ============================================================================

const testSchema = {
  facts: {
    count: t.number(),
    name: t.string(),
    items: t.array<string>(),
  },
  derivations: {
    doubled: t.number(),
    greeting: t.string(),
  },
  events: {},
  requirements: {},
};

function createTestSystem() {
  const mod = createModule("test", {
    schema: testSchema,
    init: (facts) => {
      facts.count = 0;
      facts.name = "world";
      facts.items = [];
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
      greeting: (facts) => `Hello, ${facts.name}!`,
    },
  });

  const system = createSystem({ module: mod });
  system.start();

  return system;
}

// ============================================================================
// bind()
// ============================================================================

describe("bind()", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("calls updater immediately with initial state", () => {
    const span = el("span");
    const updater = vi.fn();

    bind(system, span, updater);

    expect(updater).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledWith(
      span,
      expect.objectContaining({ count: 0, name: "world" }),
      expect.any(Object),
    );
  });

  it("updates element when facts change", () => {
    const span = el("span");

    bind(system, span, (el, facts) => {
      el.textContent = `Count: ${facts.count}`;
    });

    expect(span.textContent).toBe("Count: 0");

    system.facts.count = 5;

    expect(span.textContent).toBe("Count: 5");
  });

  it("provides derived values to updater", () => {
    const span = el("span");

    bind(system, span, (el, _facts, derived) => {
      el.textContent = `${derived.doubled}`;
    });

    expect(span.textContent).toBe("0");

    system.facts.count = 3;

    expect(span.textContent).toBe("6");
  });

  it("updates element props, not just text", () => {
    const div = el("div", { className: "initial" });

    bind(system, div, (el, facts) => {
      const count = facts.count as number;
      el.className = count > 5 ? "high" : "low";
    });

    expect(div.className).toBe("low");

    system.facts.count = 10;

    expect(div.className).toBe("high");
  });

  it("returns a cleanup function that unsubscribes", () => {
    const span = el("span");
    const updater = vi.fn((el: HTMLSpanElement, facts: Record<string, unknown>) => {
      el.textContent = `${facts.count}`;
    });

    const cleanup = bind(system, span, updater);

    expect(updater).toHaveBeenCalledTimes(1);

    system.facts.count = 1;
    expect(updater).toHaveBeenCalledTimes(2);

    cleanup();

    system.facts.count = 2;
    // Should NOT have been called again
    expect(updater).toHaveBeenCalledTimes(2);
    expect(span.textContent).toBe("1");
  });

  it("handles rapid successive updates", () => {
    const span = el("span");
    const values: number[] = [];

    bind(system, span, (_el, facts) => {
      values.push(facts.count as number);
    });

    system.facts.count = 1;
    system.facts.count = 2;
    system.facts.count = 3;

    // All updates should have been received (synchronous subscription)
    expect(values).toEqual([0, 1, 2, 3]);
  });

  it("handles multiple bindings on same element", () => {
    const div = el("div");

    const cleanup1 = bind(system, div, (el, facts) => {
      el.textContent = `${facts.count}`;
    });

    const cleanup2 = bind(system, div, (el, facts) => {
      el.className = `count-${facts.count}`;
    });

    expect(div.textContent).toBe("0");
    expect(div.className).toBe("count-0");

    system.facts.count = 3;

    expect(div.textContent).toBe("3");
    expect(div.className).toBe("count-3");

    cleanup1();
    cleanup2();
  });

  it("throws when system is null", () => {
    const span = el("span");

    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      bind(null as any, span, () => {});
    }).toThrow("[Directive]");
  });
});

// ============================================================================
// bindText()
// ============================================================================

describe("bindText()", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("sets initial text content", () => {
    const span = el("span");

    bindText(system, span, (facts) => `Count: ${facts.count}`);

    expect(span.textContent).toBe("Count: 0");
  });

  it("updates text on fact change", () => {
    const span = el("span");

    bindText(system, span, (facts) => `Count: ${facts.count}`);

    system.facts.count = 42;

    expect(span.textContent).toBe("Count: 42");
  });

  it("can use derived values", () => {
    const span = el("span");

    bindText(system, span, (_facts, derived) => `${derived.greeting}`);

    expect(span.textContent).toBe("Hello, world!");

    system.facts.name = "Directive";

    expect(span.textContent).toBe("Hello, Directive!");
  });

  it("returns cleanup function", () => {
    const span = el("span");

    const cleanup = bindText(system, span, (facts) => `${facts.count}`);

    expect(span.textContent).toBe("0");

    cleanup();

    system.facts.count = 99;
    expect(span.textContent).toBe("0");
  });
});

// ============================================================================
// mount()
// ============================================================================

describe("mount()", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("renders initial children", () => {
    const container = el("div");

    mount(system, container, (facts) => {
      return [
        el("span", {}, `Count: ${facts.count}`),
      ];
    });

    expect(container.children.length).toBe(1);
    expect(container.textContent).toBe("Count: 0");
  });

  it("replaces children on state change", () => {
    const container = el("div");

    mount(system, container, (facts) => {
      const items = facts.items as string[];

      return items.map((item) => el("li", {}, item));
    });

    expect(container.children.length).toBe(0);

    system.facts.items = ["apple", "banana"];

    expect(container.children.length).toBe(2);
    expect(container.children[0]!.textContent).toBe("apple");
    expect(container.children[1]!.textContent).toBe("banana");
  });

  it("clears children when renderer returns empty array", () => {
    const container = el("div");

    system.facts.items = ["one"];

    mount(system, container, (facts) => {
      const items = facts.items as string[];

      return items.map((item) => el("li", {}, item));
    });

    expect(container.children.length).toBe(1);

    system.facts.items = [];

    expect(container.children.length).toBe(0);
  });

  it("completely replaces children (no leftover nodes)", () => {
    const container = el("div");

    mount(system, container, (facts) => {
      const count = facts.count as number;

      if (count === 0) {
        return [el("p", {}, "Empty state")];
      }

      return [
        el("h2", {}, "Results"),
        el("span", {}, `${count} items`),
      ];
    });

    expect(container.children.length).toBe(1);
    expect(container.children[0]!.tagName).toBe("P");

    system.facts.count = 5;

    expect(container.children.length).toBe(2);
    expect(container.children[0]!.tagName).toBe("H2");
    expect(container.querySelector("p")).toBeNull();
  });

  it("returns cleanup function", () => {
    const container = el("div");

    const cleanup = mount(system, container, (facts) => {
      return [el("span", {}, `${facts.count}`)];
    });

    expect(container.textContent).toBe("0");

    cleanup();

    system.facts.count = 99;
    // Should NOT update
    expect(container.textContent).toBe("0");
  });

  it("can use derived values", () => {
    const container = el("div");

    mount(system, container, (_facts, derived) => {
      return [el("p", {}, `${derived.greeting}`)];
    });

    expect(container.textContent).toBe("Hello, world!");

    system.facts.name = "Mars";

    expect(container.textContent).toBe("Hello, Mars!");
  });

  it("throws when system is null", () => {
    const container = el("div");

    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      mount(null as any, container, () => []);
    }).toThrow("[Directive]");
  });
});

// ============================================================================
// Post-Destroy Behavior
// ============================================================================

describe("post-destroy behavior", () => {
  it("cleanup after system.destroy() does not throw", () => {
    const system = createTestSystem();
    const span = el("span");

    const cleanup = bind(system, span, (el, facts) => {
      el.textContent = `${facts.count}`;
    });

    system.destroy();

    expect(() => cleanup()).not.toThrow();
  });

  it("fact changes after cleanup do not invoke updater", () => {
    const system = createTestSystem();
    const span = el("span");
    const updater = vi.fn();

    const cleanup = bind(system, span, updater);

    expect(updater).toHaveBeenCalledTimes(1);

    cleanup();

    system.facts.count = 99;

    expect(updater).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

// ============================================================================
// mount() Edge Cases
// ============================================================================

describe("mount() edge cases", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("renderer returning single Node (not array) works", () => {
    const container = el("div");

    mount(system, container, (facts) => {
      return el("span", {}, `Count: ${facts.count}`);
    });

    expect(container.children.length).toBe(1);
    expect(container.textContent).toBe("Count: 0");

    system.facts.count = 7;

    expect(container.textContent).toBe("Count: 7");
  });

  it("renderer returning single text node works", () => {
    const container = el("div");

    mount(system, container, (facts) => {
      return document.createTextNode(`${facts.count}`);
    });

    expect(container.textContent).toBe("0");

    system.facts.count = 5;

    expect(container.textContent).toBe("5");
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe("error handling", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("updater that throws propagates the error", () => {
    const span = el("span");

    expect(() => {
      bind(system, span, () => {
        throw new Error("updater boom");
      });
    }).toThrow("updater boom");
  });

  it("renderer that throws propagates the error", () => {
    const container = el("div");

    expect(() => {
      mount(system, container, () => {
        throw new Error("renderer boom");
      });
    }).toThrow("renderer boom");
  });

  it("bindText selector that throws propagates the error", () => {
    const span = el("span");

    expect(() => {
      bindText(system, span, () => {
        throw new Error("selector boom");
      });
    }).toThrow("selector boom");
  });
});

// ============================================================================
// Subscription Cleanup Verification
// ============================================================================

describe("subscription cleanup verification", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("after bind cleanup, fact changes do not invoke updater (spy-verified)", () => {
    const span = el("span");
    const updater = vi.fn();

    const cleanup = bind(system, span, updater);

    expect(updater).toHaveBeenCalledTimes(1);

    system.facts.count = 1;

    expect(updater).toHaveBeenCalledTimes(2);

    cleanup();

    system.facts.count = 2;
    system.facts.count = 3;
    system.facts.name = "changed";

    expect(updater).toHaveBeenCalledTimes(2);
  });

  it("after mount cleanup, fact changes do not invoke renderer (spy-verified)", () => {
    const container = el("div");
    const renderer = vi.fn((_facts: Record<string, unknown>) => {
      return [el("span", {}, "test")];
    });

    const cleanup = mount(system, container, renderer);

    expect(renderer).toHaveBeenCalledTimes(1);

    system.facts.count = 1;

    expect(renderer).toHaveBeenCalledTimes(2);

    cleanup();

    system.facts.count = 2;
    system.facts.count = 3;

    expect(renderer).toHaveBeenCalledTimes(2);
  });

  it("after bindText cleanup, fact changes do not invoke selector (spy-verified)", () => {
    const span = el("span");
    const selector = vi.fn(
      (facts: Record<string, unknown>) => `${facts.count}`,
    );

    const cleanup = bindText(system, span, selector);

    expect(selector).toHaveBeenCalledTimes(1);

    system.facts.count = 1;

    expect(selector).toHaveBeenCalledTimes(2);

    cleanup();

    system.facts.count = 2;

    expect(selector).toHaveBeenCalledTimes(2);
  });

  it("multiple cleanups do not throw (idempotent)", () => {
    const span = el("span");

    const cleanup = bind(system, span, () => {});

    expect(() => {
      cleanup();
      cleanup();
      cleanup();
    }).not.toThrow();
  });

  it("multiple mount cleanups do not throw (idempotent)", () => {
    const container = el("div");

    const cleanup = mount(system, container, () => [el("span")]);

    expect(() => {
      cleanup();
      cleanup();
      cleanup();
    }).not.toThrow();
  });
});

// ============================================================================
// Combining el + bind
// ============================================================================

describe("el + bind integration", () => {
  it("builds a reactive UI fragment", () => {
    const mod = createModule("counter", {
      schema: {
        facts: {
          count: t.number(),
        },
        derivations: {
          label: t.string(),
        },
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: {
        label: (facts) => `Count is ${facts.count}`,
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    const heading = el("h1");
    const badge = el("span", { className: "badge" });

    bindText(system, heading, (_facts, derived) => `${derived.label}`);
    bind(system, badge, (el, facts) => {
      const count = facts.count as number;
      el.textContent = `${count}`;
      el.className = count > 5 ? "badge high" : "badge low";
    });

    expect(heading.textContent).toBe("Count is 0");
    expect(badge.textContent).toBe("0");
    expect(badge.className).toBe("badge low");

    system.facts.count = 10;

    expect(heading.textContent).toBe("Count is 10");
    expect(badge.textContent).toBe("10");
    expect(badge.className).toBe("badge high");

    system.destroy();
  });
});
