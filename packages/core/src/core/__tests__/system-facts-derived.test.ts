import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import type {
  SingleModuleSystem,
  SystemDerived,
  SystemFacts,
} from "../../index.js";

describe("SystemFacts / SystemDerived", () => {
  it("extracts the typed facts shape from a single-module system", () => {
    const counter = createModule("counter", {
      schema: {
        facts: {
          count: t.number(),
          label: t.string(),
        },
        derivations: {
          doubled: t.number(),
        },
      },
      init: (facts) => {
        facts.count = 0;
        facts.label = "zero";
      },
      derive: {
        doubled: (facts) => facts.count * 2,
      },
    });

    const system = createSystem({ module: counter });

    // Type-level: a function typed against the helpers compiles only when
    // the schema is preserved end-to-end. If the helpers collapsed to
    // Record<string, unknown>, `facts.count + 1` would be a type error.
    function render(
      facts: SystemFacts<typeof system>,
      derived: SystemDerived<typeof system>,
    ): string {
      return `${facts.label}=${facts.count + 1}, doubled=${derived.doubled}`;
    }

    expect(render({ count: 0, label: "zero" }, { doubled: 0 })).toBe(
      "zero=1, doubled=0",
    );
  });

  it("accepts a SingleModuleSystem<S> reference and infers S", () => {
    const traffic = createModule("traffic", {
      schema: {
        facts: {
          phase: t.string<"red" | "green" | "yellow">(),
        },
        derivations: {
          isRed: t.boolean(),
        },
      },
      init: (facts) => {
        facts.phase = "red";
      },
      derive: {
        isRed: (facts) => facts.phase === "red",
      },
    });
    type TrafficSystem = SingleModuleSystem<typeof traffic.schema>;

    function paint(
      facts: SystemFacts<TrafficSystem>,
      derived: SystemDerived<TrafficSystem>,
    ): "stop" | "go" {
      // facts.phase is "red" | "green" | "yellow", not unknown
      if (facts.phase === "red" || derived.isRed) {
        return "stop";
      }
      return "go";
    }

    expect(paint({ phase: "red" }, { isRed: true })).toBe("stop");
    expect(paint({ phase: "green" }, { isRed: false })).toBe("go");
  });

  it("accepts a raw module schema", () => {
    const schema = {
      facts: {
        name: t.string(),
      },
      derivations: {
        upper: t.string(),
      },
    } as const;

    function describe_(
      facts: SystemFacts<typeof schema>,
      derived: SystemDerived<typeof schema>,
    ): string {
      return `${facts.name}/${derived.upper}`;
    }

    expect(describe_({ name: "ada" }, { upper: "ADA" })).toBe("ada/ADA");
  });

  it("preserves namespaced shape for multi-module systems", () => {
    const auth = createModule("auth", {
      schema: {
        facts: { token: t.string() },
        derivations: { hasToken: t.boolean() },
      },
      init: (facts) => {
        facts.token = "";
      },
      derive: {
        hasToken: (facts) => facts.token.length > 0,
      },
    });
    const cart = createModule("cart", {
      schema: {
        facts: { count: t.number() },
        derivations: { empty: t.boolean() },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: {
        empty: (facts) => facts.count === 0,
      },
    });

    const system = createSystem({ modules: { auth, cart } });

    function summary(
      facts: SystemFacts<typeof system>,
      derived: SystemDerived<typeof system>,
    ): string {
      return `${facts.auth.token ? "in" : "out"}/${
        derived.cart.empty ? "0" : "n"
      }`;
    }

    expect(
      summary(
        { auth: { token: "abc" }, cart: { count: 2 } },
        { auth: { hasToken: true }, cart: { empty: false } },
      ),
    ).toBe("in/n");
  });
});
