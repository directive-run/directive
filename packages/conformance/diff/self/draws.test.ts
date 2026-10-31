/**
 * A drawn retry delay is incidental to the comparison, never to the oracle:
 * compare.ts masks exactly the values `drawProblems` bounds-checks, and no
 * others. Each test here proves one half of that: a draw, a hook duration or
 * an observe duration outside its bounds fails (on the reference and on an
 * engine under test); a `$draw` anywhere else is a scenario error that is
 * not masked; and a value that is not a draw, next to one that is, is still
 * reported.
 */

import { describe, expect, it } from "vitest";
import {
  compareContract,
  contract,
  drawProblems,
  drawnResolvers,
} from "../compare.js";
import type { CoreApi, EngineHandle } from "../engines.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  type BuildContext,
  type ScenarioDef,
  runScenario,
} from "../scenario.js";

// ---------------------------------------------------------------------------
// Hand-built traces

const ext = (data: unknown): TraceEntry => ({
  k: "external",
  data: data as Json,
});
const marker = (draw: Json, min = 10, max = 20) => ({
  $draw: draw,
  min,
  max,
});
const hookDone = (resolver: string, duration: unknown): TraceEntry => ({
  k: "hook",
  hook: "onResolverComplete",
  args: [resolver, { id: "req" }, duration as Json],
});
const observeDone = (resolver: string, duration: unknown): TraceEntry => ({
  k: "observe",
  event: {
    type: "resolver.complete",
    resolver,
    requirementId: "req",
    duration: duration as Json,
  },
});

/** Two waits of [10, 20] each, so the chain takes between 20 and 40 ms. */
function chain(opts: {
  draws?: [Json, Json];
  hook?: unknown;
  observe?: unknown;
}): TraceEntry[] {
  const [first, second] = opts.draws ?? [15, 15];

  return [
    ext(["r", 1, 0]),
    ext(["r", 2, marker(first)]),
    ext(["r", 3, marker(second)]),
    hookDone("r", "hook" in opts ? opts.hook : 30),
    observeDone("r", "observe" in opts ? opts.observe : 30),
  ];
}

describe("a drawn value outside its bounds fails", () => {
  it("control: draws and durations inside their bounds", () => {
    expect(drawProblems(chain({}))).toEqual([]);
    // Both edges of every range are inside it.
    expect(
      drawProblems(chain({ draws: [10, 10], hook: 20, observe: 20 })),
    ).toEqual([]);
    expect(
      drawProblems(chain({ draws: [20, 20], hook: 40, observe: 40 })),
    ).toEqual([]);
  });

  it("a draw below min or above max", () => {
    for (const bad of [9, 21, -1, 1000]) {
      const problems = drawProblems(chain({ draws: [15, bad] }));

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^external #2: .* is outside \[min, max\]$/);
    }
  });

  it("the hook's completion duration outside the summed bounds", () => {
    for (const bad of [19, 41, 999999, "30", null]) {
      const problems = drawProblems(chain({ hook: bad }));

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(
        /^hook #3: resolver "r" took .* outside its drawn waits' \[20, 40\]$/,
      );
    }
  });

  it("the observe event's duration outside the summed bounds", () => {
    for (const bad of [19, 41, 999999, "30", null]) {
      const problems = drawProblems(chain({ observe: bad }));

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(
        /^observe #4: resolver "r" took .* outside its drawn waits' \[20, 40\]$/,
      );
    }
  });

  it("a resolver the reference draws for must wait nothing on a trace with no draws", () => {
    const reference = chain({});
    const candidate = [ext(["r", 1, 0]), hookDone("r", 0), observeDone("r", 0)];
    const drawn = drawnResolvers(reference);

    expect(drawProblems(candidate, drawn)).toEqual([]);
    expect(
      drawProblems(
        [ext(["r", 1, 0]), hookDone("r", 5), observeDone("r", 5)],
        drawn,
      ),
    ).toHaveLength(2);
  });

  it("two completions would span two chains, so they are an error", () => {
    const twice = [...chain({}), hookDone("r", 30)];

    expect(drawProblems(twice).join("\n")).toMatch(/completed more than once/);
  });
});

describe("a `$draw` at a position that is not checked is rejected", () => {
  /** [what, an entry with the draw value `draw`]. */
  const misplaced: [string, (draw: number) => TraceEntry][] = [
    ["nested inside the marker's slot", (d) => ext(["r", 2, { a: marker(d) }])],
    ["a fourth element", (d) => ext(["r", 2, marker(d), "extra"])],
    ["a second one in the array", (d) => ext(["r", 2, marker(15), marker(d)])],
    ["in the resolver slot", (d) => ext([marker(d), 2, marker(15)])],
    ["in the attempt slot", (d) => ext(["r", marker(d), marker(15)])],
    ["a bare object", (d) => ext(marker(d))],
    ["inside an object entry", (d) => ext({ wait: marker(d) })],
    [
      "a marker with an extra key",
      (d) => ext(["r", 2, { ...marker(d), x: 1 }]),
    ],
    ["a marker without max", (d) => ext(["r", 2, { $draw: d, min: 10 }])],
    ["a marker with a string draw", (d) => ext(["r", 2, marker(String(d))])],
    ["a resolver slot that is not a string", (d) => ext([7, 2, marker(d)])],
    [
      "a hook argument",
      (d) => ({ k: "hook", hook: "onResolverStart", args: [marker(d)] }),
    ],
    [
      "a state fact",
      (d) => ({
        k: "state",
        label: "s",
        facts: { w: marker(d) },
        derived: {},
        inspect: {},
      }),
    ],
  ];

  it("control: the one checked position is masked and bounds-checked", () => {
    const at = (d: number) => ext(["r", 2, marker(d)]);

    // Masked: the value does not matter to the comparison ...
    expect(contract(at(11))).toEqual(contract(at(19)));
    // ... because it is checked.
    expect(drawProblems([at(11)])).toEqual([]);
    expect(drawProblems([at(21)])).toHaveLength(1);
  });

  it("every misplaced draw is rejected and never masked", () => {
    for (const [what, make] of misplaced) {
      // Never masked: two different draws are two different contracts ...
      expect(contract(make(11)), what).not.toEqual(contract(make(19)));
      // ... and the scenario is rejected, in either case.
      const problems = drawProblems([make(11)]);

      expect(problems, what).toHaveLength(1);
      expect(problems[0], what).toMatch(
        /"\$draw" outside \[resolverId, attempt/,
      );
    }
  });
});

describe("a value that is not a draw, next to one that is, is reported", () => {
  const reference = [...chain({}), ext(["after", 1])];
  const paths = (candidate: TraceEntry[]) =>
    compareContract(reference, candidate, "x").map((d) => d.path);

  it("control: only the draws and the durations differ", () => {
    const candidate = [
      ext(["r", 1, 0]),
      ext(["r", 2, marker(11)]),
      ext(["r", 3, marker(19)]),
      hookDone("r", 22),
      observeDone("r", 38),
      ext(["after", 1]),
    ];

    expect(paths(candidate)).toEqual([]);
  });

  it("the attempt number, min, max and the time of the first attempt", () => {
    const edit = (index: number, replace: unknown): TraceEntry[] =>
      reference.map((e, i) => (i === index ? ext(replace) : e));

    expect(paths(edit(1, ["r", 9, marker(15)]))).not.toEqual([]);
    expect(paths(edit(1, ["r", 2, marker(15, 11, 20)]))).not.toEqual([]);
    expect(paths(edit(1, ["r", 2, marker(15, 10, 21)]))).not.toEqual([]);
    expect(paths(edit(0, ["r", 1, 5]))).not.toEqual([]);
  });

  it("another entry, and another resolver's duration", () => {
    const base = chain({});

    expect(paths([...base, ext(["after", 2])])).not.toEqual([]);
    // A resolver that reports no draws keeps its duration exact.
    const other = [...reference, hookDone("plain", 5)];
    const changed = [...reference, hookDone("plain", 6)];

    expect(compareContract(other, changed, "x")).not.toEqual([]);
  });

  it("the hook's other arguments", () => {
    const candidate = reference.map((e) =>
      e.k === "hook"
        ? { ...e, args: [e.args[0], { id: "other" }, e.args[2]] as Json[] }
        : e,
    );

    expect(paths(candidate)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through runScenario, on the real engines

/** One resolver that retries twice with `jitter: "full"` (bounds 0..40, 0..80). */
function chainScenario(
  report: (n: number, wait: number, max: number) => unknown = (
    n,
    wait,
    max,
  ) => ["load", n, { $draw: wait, min: 0, max }],
): ScenarioDef {
  return {
    name: "draw self-test chain",
    build: ({ core: { createModule, t }, external }: BuildContext) => {
      let attempts = 0;
      let last = 0;

      return {
        module: createModule("m", {
          schema: {
            facts: { done: t.boolean() },
            derivations: {},
            events: {},
            requirements: { LOAD: {} },
          },
          init: (facts: any) => {
            facts.done = false;
          },
          constraints: {
            load: { when: (f: any) => !f.done, require: { type: "LOAD" } },
          },
          resolvers: {
            load: {
              requirement: "LOAD",
              retry: {
                attempts: 3,
                backoff: "exponential",
                initialDelay: 40,
                jitter: "full",
              },
              resolve: async (_req: unknown, context: any) => {
                attempts += 1;
                const now = Date.now();
                external(
                  attempts === 1
                    ? ["load", 1, now]
                    : report(attempts, now - last, 40 * 2 ** (attempts - 2)),
                );
                last = now;
                if (attempts < 3) {
                  throw new Error("again");
                }
                context.facts.done = true;
              },
            },
          },
        } as any),
      };
    },
    steps: [{ op: "start" }, { op: "settle" }],
  };
}

/** Wrap the engine under test, as tamper.test.ts does. */
function faulty(fault: {
  plugin?: (hook: string, args: unknown[]) => unknown[];
  observe?: (event: any) => any;
}) {
  return (engine: EngineHandle): EngineHandle => ({
    ...engine,
    async load() {
      const core = await engine.load();

      return {
        ...core,
        createSystem: (config: Record<string, unknown>) => {
          const plugins = (config.plugins as Record<string, any>[]).map((p) => {
            if (p.name !== "conformance-recorder" || !fault.plugin) {
              return p;
            }
            const wrapped: Record<string, any> = { name: p.name };
            for (const [key, fn] of Object.entries(p)) {
              if (typeof fn === "function") {
                wrapped[key] = (...args: unknown[]) =>
                  fn(...(fault.plugin?.(key, args) ?? args));
              }
            }

            return wrapped;
          });
          const system = (core.createSystem as (c: unknown) => any)({
            ...config,
            plugins,
          });

          return new Proxy(system, {
            get: (target, prop) =>
              prop === "observe" && fault.observe
                ? (fn: (e: unknown) => void) =>
                    system.observe((event: unknown) =>
                      fn(fault.observe?.(event)),
                    )
                : Reflect.get(target, prop),
          });
        },
      } as unknown as CoreApi;
    },
  });
}

describe("runScenario enforces the bounds on real engines", () => {
  it("control: the unfaulted chain passes", async () => {
    const result = await runScenario(chainScenario(), { divergences: [] });

    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
  });

  it("a draw outside [min, max] fails on the reference and the candidate", async () => {
    const result = await runScenario(
      chainScenario((n, wait, max) => [
        "load",
        n,
        { $draw: wait + 1000, min: 0, max },
      ]),
      { divergences: [] },
    );

    expect(result.ok).toBe(false);
    expect(result.report).toMatch(/v1 in scenario .*outside \[min, max\]/);
    expect(result.report).toMatch(/local in scenario .*outside \[min, max\]/);
  });

  it("a hook duration outside the bounds fails, though the comparison masks it", async () => {
    const result = await runScenario(chainScenario(), {
      divergences: [],
      wrapCandidate: faulty({
        plugin: (hook, args) =>
          hook === "onResolverComplete" ? [args[0], args[1], 999999] : args,
      }),
    });

    // Masked: the comparison sees no difference. Only the bounds catch it.
    expect(result.unexplained).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(
      /local in scenario .*hook #\d+: resolver "load" took 999999 ms, outside/,
    );
    expect(result.report).not.toMatch(/v1 in scenario/);
  });

  it("an observe duration outside the bounds fails, though the comparison masks it", async () => {
    const result = await runScenario(chainScenario(), {
      divergences: [],
      wrapCandidate: faulty({
        observe: (event) =>
          event.type === "resolver.complete"
            ? { ...event, duration: 999999 }
            : event,
      }),
    });

    expect(result.unexplained).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(
      /local in scenario .*observe #\d+: resolver "load" took 999999 ms, outside/,
    );
  });

  it("a `$draw` at an unchecked position fails the scenario", async () => {
    const result = await runScenario(
      chainScenario((n, wait, max) => [
        "load",
        n,
        { $draw: wait, min: 0, max },
        "extra",
      ]),
      { divergences: [] },
    );

    expect(result.ok).toBe(false);
    expect(result.report).toMatch(/v1 in scenario .*"\$draw" outside/);
  });
});
