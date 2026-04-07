// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "@directive-run/core";
import { render, screen, act } from "@testing-library/react";
import { createDirectiveContext } from "../index";

const counterModule = createModule("ctx-test", {
  schema: {
    facts: { count: t.number(), name: t.string() },
    derivations: { doubled: t.number() },
    requirements: {},
    events: { increment: {} },
  },
  init: (f) => {
    f.count = 0;
    f.name = "test";
  },
  derive: { doubled: (f) => f.count * 2 },
  events: {
    increment: (f) => {
      f.count += 1;
    },
  },
});

describe("createDirectiveContext", () => {
  it("provides useFact from context", () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    const Ctx = createDirectiveContext(sys);

    function Display() {
      const count = Ctx.useFact("count");
      return <div data-testid="count">{count}</div>;
    }

    render(
      <Ctx.Provider>
        <Display />
      </Ctx.Provider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");
    sys.destroy();
  });

  it("provides useDerived from context", () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    const Ctx = createDirectiveContext(sys);

    function Display() {
      const doubled = Ctx.useDerived("doubled");
      return <div data-testid="doubled">{doubled}</div>;
    }

    render(
      <Ctx.Provider>
        <Display />
      </Ctx.Provider>,
    );

    expect(screen.getByTestId("doubled").textContent).toBe("0");
    sys.destroy();
  });

  it("provides useEvents from context", () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    const Ctx = createDirectiveContext(sys);

    function Controls() {
      const events = Ctx.useEvents();
      return (
        <button data-testid="btn" onClick={() => events.increment()}>
          inc
        </button>
      );
    }

    function Display() {
      const count = Ctx.useFact("count");
      return <div data-testid="count">{count}</div>;
    }

    render(
      <Ctx.Provider>
        <Display />
        <Controls />
      </Ctx.Provider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      screen.getByTestId("btn").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
    sys.destroy();
  });

  it("throws when used outside Provider", () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    const Ctx = createDirectiveContext(sys);

    function Bad() {
      Ctx.useFact("count");
      return null;
    }

    expect(() => render(<Bad />)).toThrow("outside of <Provider>");
    sys.destroy();
  });

  it("accepts system override via Provider", () => {
    const sys1 = createSystem({ module: counterModule });
    sys1.start();
    sys1.facts.count = 10;

    const sys2 = createSystem({ module: counterModule });
    sys2.start();
    sys2.facts.count = 99;

    const Ctx = createDirectiveContext(sys1);

    function Display() {
      const count = Ctx.useFact("count");
      return <div data-testid="count">{count}</div>;
    }

    render(
      <Ctx.Provider system={sys2}>
        <Display />
      </Ctx.Provider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("99");

    sys1.destroy();
    sys2.destroy();
  });

  it("useSystem returns the system instance", () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    const Ctx = createDirectiveContext(sys);

    let capturedSystem: unknown = null;

    function Capture() {
      capturedSystem = Ctx.useSystem();
      return null;
    }

    render(
      <Ctx.Provider>
        <Capture />
      </Ctx.Provider>,
    );

    expect(capturedSystem).toBe(sys);
    sys.destroy();
  });
});
