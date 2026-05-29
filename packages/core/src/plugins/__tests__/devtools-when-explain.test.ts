// @vitest-environment happy-dom
/**
 * R4.E — devtools panel renders per-clause whenExplain tree.
 *
 * The plumbing already existed (the `constraint.evaluate` event carries
 * `whenExplain?: ClauseResult[]`, `engine.explain()` renders the tree
 * for text output) — this suite verifies the visual panel renders the
 * clause tree when a data-form `when` constraint evaluates, and falls
 * back gracefully for function-form constraints.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { devtoolsPlugin } from "../devtools.js";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__DIRECTIVE__;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__DIRECTIVE__;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

function findConstraintsBody(): HTMLElement | null {
  const root = document.querySelector("[data-directive-devtools]");
  if (!root) return null;
  const allDetails = root.querySelectorAll("details");
  for (const d of Array.from(allDetails)) {
    const sum = d.querySelector("summary");
    if (sum?.textContent?.startsWith("Constraints")) {
      const body = d.querySelector("div");

      return body as HTMLElement | null;
    }
  }

  return null;
}

describe("devtools whenExplain panel (R4.E)", () => {
  it("renders Constraints section with empty state on start", () => {
    const mod = createModule("empty", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-empty", panel: true, defaultOpen: true }),
      ],
    });
    system.start();

    const body = findConstraintsBody();
    expect(body).not.toBeNull();
    expect(body?.querySelector(".dt-constraints-empty")).not.toBeNull();

    system.destroy();
  });

  it("renders the clause tree for a data-form `when` constraint", async () => {
    const mod = createModule("traffic", {
      schema: {
        facts: { phase: t.string<"red" | "green">(), elapsed: t.number() },
        derivations: {},
        events: {},
        requirements: { TRANSITION: {} },
      },
      init: (facts) => {
        facts.phase = "red";
        facts.elapsed = 20;
      },
      constraints: {
        transition: {
          when: { phase: { $eq: "red" }, elapsed: { $gte: 30 } },
          require: { type: "TRANSITION" },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({
          name: "test-data-form",
          panel: true,
          defaultOpen: true,
        }),
      ],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const body = findConstraintsBody();
    expect(body).not.toBeNull();
    expect(body?.querySelector(".dt-constraints-empty")).toBeNull();

    const text = body?.textContent ?? "";
    expect(text).toContain("transition");
    expect(text).toContain("✗"); // inactive (elapsed=20 < 30)
    expect(text).toContain("phase");
    expect(text).toContain("elapsed");
    expect(text).toContain("actual: 20");

    system.destroy();
  });

  it("updates the clause tree when facts change", async () => {
    const mod = createModule("ready", {
      schema: {
        facts: { phase: t.string<"red" | "green">(), elapsed: t.number() },
        derivations: {},
        events: {},
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.phase = "red";
        facts.elapsed = 0;
      },
      constraints: {
        ready: {
          when: { phase: { $eq: "red" }, elapsed: { $gte: 30 } },
          require: { type: "GO" },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-update", panel: true, defaultOpen: true }),
      ],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    let body = findConstraintsBody();
    expect(body?.textContent).toContain("actual: 0");

    system.facts.elapsed = 30;
    await new Promise((r) => setTimeout(r, 0));

    body = findConstraintsBody();
    const text = body?.textContent ?? "";
    expect(text).toContain("ready");
    expect(text).not.toContain("actual: 0");

    system.destroy();
  });

  it("renders a function-form note when `when` is a function", async () => {
    const mod = createModule("fnform", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: { EXCEED: {} },
      },
      init: (facts) => {
        facts.count = 5;
      },
      constraints: {
        threshold: {
          when: (facts) => (facts.count as number) > 3,
          require: { type: "EXCEED" },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-fn", panel: true, defaultOpen: true }),
      ],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const body = findConstraintsBody();
    const text = body?.textContent ?? "";
    expect(text).toContain("threshold");
    expect(text).toContain("function-form when (no clause tree)");

    system.destroy();
  });

  it("renders RegExp as /pattern/flags, not JSON-stringified {}", async () => {
    const mod = createModule("rx", {
      schema: {
        facts: { phase: t.string() },
        derivations: {},
        events: {},
        requirements: { MATCH: {} },
      },
      init: (facts) => {
        facts.phase = "red";
      },
      constraints: {
        matchPhase: {
          when: { phase: { $matches: /^red/i } },
          require: { type: "MATCH" },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-rx", panel: true, defaultOpen: true }),
      ],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 30));

    const body = findConstraintsBody();
    const text = body?.textContent ?? "";
    expect(text).toContain("matchPhase");
    // The fix: RegExp formats as /^red/i, not the JSON.stringify "{}".
    expect(text).toContain("/^red/i");
    expect(text).not.toContain("matches {}");

    system.destroy();
  });

  it("changes empty-state copy when system has no constraints", () => {
    const mod = createModule("nocon", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-nocon", panel: true, defaultOpen: true }),
      ],
    });
    system.start();

    const body = findConstraintsBody();
    const empty = body?.querySelector(".dt-constraints-empty");
    expect(empty?.textContent).toBe("This system has no constraints");

    system.destroy();
  });

  it("removes the row when a dynamic constraint is unregistered", async () => {
    const mod = createModule("dis", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.x = 5;
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-unreg", panel: true, defaultOpen: true }),
      ],
    });
    system.start();

    // Dynamic register so we have something we're allowed to unregister.
    system.constraints.register("bigEnough", {
      when: { x: { $gt: 3 } },
      require: { type: "GO" },
    });
    await new Promise((r) => setTimeout(r, 30));

    let body = findConstraintsBody();
    expect(body?.textContent).toContain("bigEnough");

    system.constraints.unregister("bigEnough");
    await new Promise((r) => setTimeout(r, 30));

    body = findConstraintsBody();
    const root = document.querySelector("[data-directive-devtools]");
    const summary = Array.from(root?.querySelectorAll("summary") ?? []).find(
      (s) => s.textContent?.startsWith("Constraints"),
    );
    expect(summary?.textContent).toMatch(/Constraints \(0\)/);
    expect(body?.querySelector(".dt-constraints-empty")).not.toBeNull();

    system.destroy();
  });

  it("rebuilds the row on each evaluation (no duplicate appends)", async () => {
    const mod = createModule("dedup", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: { BIG: {} },
      },
      init: (facts) => {
        facts.x = 0;
      },
      constraints: {
        gt5: {
          when: { x: { $gt: 5 } },
          require: { type: "BIG" },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        devtoolsPlugin({ name: "test-dedup", panel: true, defaultOpen: true }),
      ],
    });
    system.start();

    system.facts.x = 1;
    system.facts.x = 2;
    system.facts.x = 6;
    system.facts.x = 7;
    await new Promise((r) => setTimeout(r, 0));

    const body = findConstraintsBody();
    const root = document.querySelector("[data-directive-devtools]");
    const summary = Array.from(root?.querySelectorAll("summary") ?? []).find(
      (s) => s.textContent?.startsWith("Constraints"),
    );
    expect(summary?.textContent).toMatch(/Constraints \(1\)/);
    expect(body?.children.length).toBe(1);

    system.destroy();
  });
});
