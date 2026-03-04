import { describe, expect, it } from "vitest";
import {
  dag,
  debate,
  parallel,
  patternFromJSON,
  patternToJSON,
  race,
  reflect,
  sequential,
  supervisor,
} from "../multi-agent-orchestrator.js";
import type {
  DagExecutionContext,
  DagPattern,
  DebatePattern,
  ParallelPattern,
  RacePattern,
  ReflectPattern,
  SequentialPattern,
  SerializedPattern,
  SupervisorPattern,
} from "../multi-agent-orchestrator.js";

// ============================================================================
// Tests
// ============================================================================

describe("patternToJSON / patternFromJSON", () => {
  // ---------- parallel ----------

  it("round-trip parallel — agents and minSuccess preserved", () => {
    const p = parallel(["a", "b", "c"], (results) => results, {
      minSuccess: 2,
      timeout: 5000,
    });
    const json = patternToJSON(p);

    expect(json).toEqual({
      type: "parallel",
      handlers: ["a", "b", "c"],
      minSuccess: 2,
      timeout: 5000,
    });

    const restored = patternFromJSON<unknown>(json) as ParallelPattern<unknown>;

    expect(restored.type).toBe("parallel");
    expect(restored.handlers).toEqual(["a", "b", "c"]);
    expect(restored.minSuccess).toBe(2);
    expect(restored.timeout).toBe(5000);
    // merge function stripped during serialization
    expect(restored.merge).toBeUndefined();
  });

  it("round-trip parallel — overrides re-attach merge function", () => {
    const p = parallel(["x", "y"], () => "noop");
    const json = patternToJSON(p);
    const merge = (results: unknown[]) => results.length;
    const restored = patternFromJSON(json, { merge } as Partial<
      ParallelPattern<number>
    >) as ParallelPattern<number>;

    expect(restored.merge).toBe(merge);
    expect(restored.handlers).toEqual(["x", "y"]);
  });

  // ---------- sequential ----------

  it("round-trip sequential — agents and continueOnError preserved", () => {
    const p = sequential(["step1", "step2", "step3"], {
      continueOnError: true,
    });
    const json = patternToJSON(p);

    expect(json).toEqual({
      type: "sequential",
      handlers: ["step1", "step2", "step3"],
      continueOnError: true,
    });

    const restored = patternFromJSON<unknown>(
      json,
    ) as SequentialPattern<unknown>;

    expect(restored.type).toBe("sequential");
    expect(restored.handlers).toEqual(["step1", "step2", "step3"]);
    expect(restored.continueOnError).toBe(true);
    // transform and extract functions stripped
    expect(restored.transform).toBeUndefined();
    expect(restored.extract).toBeUndefined();
  });

  it("round-trip sequential — without continueOnError defaults to undefined", () => {
    const p = sequential(["a", "b"]);
    const json = patternToJSON(p);

    expect(json.type).toBe("sequential");
    expect(
      (json as Extract<SerializedPattern, { type: "sequential" }>)
        .continueOnError,
    ).toBeUndefined();
  });

  // ---------- supervisor ----------

  it("round-trip supervisor — supervisor, workers, and maxRounds preserved", () => {
    const p = supervisor("boss", ["worker1", "worker2"], { maxRounds: 4 });
    const json = patternToJSON(p);

    expect(json).toEqual({
      type: "supervisor",
      supervisor: "boss",
      workers: ["worker1", "worker2"],
      maxRounds: 4,
    });

    const restored = patternFromJSON<unknown>(
      json,
    ) as SupervisorPattern<unknown>;

    expect(restored.type).toBe("supervisor");
    expect(restored.supervisor).toBe("boss");
    expect(restored.workers).toEqual(["worker1", "worker2"]);
    expect(restored.maxRounds).toBe(4);
    // extract function stripped
    expect(restored.extract).toBeUndefined();
  });

  // ---------- dag ----------

  it("round-trip dag — nodes preserved, when/transform functions stripped", () => {
    const p = dag<string>(
      {
        fetch: { handler: "fetcher" },
        analyze: {
          handler: "analyzer",
          deps: ["fetch"],
          timeout: 3000,
          when: () => true, // should be stripped
          transform: () => "ignored", // should be stripped
        },
        summarize: { handler: "summarizer", deps: ["analyze"], priority: 5 },
      },
      (context: DagExecutionContext) => String(context.outputs.summarize),
      { timeout: 10000, maxConcurrent: 3, onNodeError: "skip-downstream" },
    );

    const json = patternToJSON(p);

    expect(json.type).toBe("dag");

    const dagJson = json as Extract<SerializedPattern, { type: "dag" }>;

    expect(dagJson.timeout).toBe(10000);
    expect(dagJson.maxConcurrent).toBe(3);
    expect(dagJson.onNodeError).toBe("skip-downstream");

    const restored = patternFromJSON<string>(json) as DagPattern<string>;

    expect(restored.type).toBe("dag");
    expect(Object.keys(restored.nodes)).toEqual([
      "fetch",
      "analyze",
      "summarize",
    ]);
    expect(restored.nodes.fetch!.handler).toBe("fetcher");
    expect(restored.nodes.analyze!.deps).toEqual(["fetch"]);
    expect(restored.nodes.analyze!.timeout).toBe(3000);
    expect(restored.nodes.summarize!.priority).toBe(5);
    // when/transform stripped
    expect(
      (restored.nodes.analyze as unknown as Record<string, unknown>).when,
    ).toBeUndefined();
    expect(
      (restored.nodes.analyze as unknown as Record<string, unknown>).transform,
    ).toBeUndefined();
    // merge function stripped
    expect(restored.merge).toBeUndefined();
  });

  // ---------- reflect ----------

  it("round-trip reflect — function threshold stripped, numeric threshold kept", () => {
    const p = reflect("producer", "evaluator", {
      maxIterations: 3,
      onExhausted: "accept-best",
      timeout: 2000,
      threshold: 0.75, // number → kept
      parseEvaluation: () => ({ passed: true }), // function → stripped
      onIteration: () => {}, // function → stripped
    });

    const json = patternToJSON(p);
    const reflectJson = json as Extract<SerializedPattern, { type: "reflect" }>;

    expect(reflectJson.type).toBe("reflect");
    expect(reflectJson.handler).toBe("producer");
    expect(reflectJson.evaluator).toBe("evaluator");
    expect(reflectJson.maxIterations).toBe(3);
    expect(reflectJson.onExhausted).toBe("accept-best");
    expect(reflectJson.timeout).toBe(2000);
    expect(reflectJson.threshold).toBe(0.75);

    const restored = patternFromJSON<string>(json) as ReflectPattern<string>;

    expect(restored.threshold).toBe(0.75);
    expect(restored.parseEvaluation).toBeUndefined();
    expect(restored.onIteration).toBeUndefined();
  });

  it("round-trip reflect — function threshold is not a number, stripped from serialized form", () => {
    const p = reflect("writer", "reviewer", {
      threshold: (iteration) => 0.5 + iteration * 0.1, // function → stripped
    });

    const json = patternToJSON(p);
    const reflectJson = json as Extract<SerializedPattern, { type: "reflect" }>;

    // Function threshold should not appear in JSON (only number threshold is kept)
    expect(reflectJson.threshold).toBeUndefined();
  });

  // ---------- race ----------

  it("round-trip race — agents, timeout, and minSuccess preserved", () => {
    const p = race(["fast", "smart"], { timeout: 4000, minSuccess: 2 });
    const json = patternToJSON(p);

    expect(json).toEqual({
      type: "race",
      handlers: ["fast", "smart"],
      timeout: 4000,
      minSuccess: 2,
    });

    const restored = patternFromJSON<unknown>(json) as RacePattern<unknown>;

    expect(restored.type).toBe("race");
    expect(restored.handlers).toEqual(["fast", "smart"]);
    expect(restored.timeout).toBe(4000);
    expect(restored.minSuccess).toBe(2);
    // extract function stripped
    expect(restored.extract).toBeUndefined();
  });

  // ---------- debate ----------

  it("round-trip debate — evaluator, agents, and maxRounds preserved", () => {
    const p = debate({
      handlers: ["optimist", "pessimist"],
      evaluator: "judge",
      maxRounds: 3,
      timeout: 6000,
      parseJudgement: () => ({ winnerId: "optimist" }), // function → stripped
    });

    const json = patternToJSON(p);

    expect(json).toEqual({
      type: "debate",
      handlers: ["optimist", "pessimist"],
      evaluator: "judge",
      maxRounds: 3,
      timeout: 6000,
    });

    const restored = patternFromJSON<unknown>(json) as DebatePattern<unknown>;

    expect(restored.type).toBe("debate");
    expect(restored.handlers).toEqual(["optimist", "pessimist"]);
    expect(restored.evaluator).toBe("judge");
    expect(restored.maxRounds).toBe(3);
    expect(restored.timeout).toBe(6000);
    // function fields stripped
    expect(restored.parseJudgement).toBeUndefined();
    expect(restored.extract).toBeUndefined();
    expect(restored.signal).toBeUndefined();
  });

  // ---------- validation ----------

  it("patternFromJSON validates type — throws on unknown type", () => {
    expect(() => {
      patternFromJSON({ type: "invalid" } as unknown as SerializedPattern);
    }).toThrow('invalid or unknown pattern type "invalid"');
  });

  it("patternFromJSON validates type — throws on null input", () => {
    expect(() => {
      patternFromJSON(null as unknown as SerializedPattern);
    }).toThrow();
  });

  it("patternFromJSON validates type — throws when type missing", () => {
    expect(() => {
      patternFromJSON({} as unknown as SerializedPattern);
    }).toThrow();
  });

  // ---------- prototype pollution defense ----------

  it("patternFromJSON strips __proto__ from input — no prototype pollution", () => {
    const malicious = JSON.parse(
      '{"type":"parallel","handlers":["a","b"],"__proto__":{"polluted":true}}',
    ) as SerializedPattern;

    const restored = patternFromJSON(malicious);

    // The restored object must not have a polluted prototype
    expect(
      (restored as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
    // The plain Object.prototype must not be polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    expect(restored.type).toBe("parallel");
    expect((restored as ParallelPattern<unknown>).handlers).toEqual(["a", "b"]);
  });

  it("patternFromJSON strips __proto__ and is safe from prototype pollution", () => {
    // Verify that a carefully crafted object with __proto__ as a key does not
    // pollute Object.prototype. The implementation strips __proto__, constructor,
    // and prototype from the intermediate null-prototype object before spreading.
    const poisoned = JSON.parse(
      '{"type":"sequential","handlers":["a"],"__proto__":{"evil":true}}',
    ) as SerializedPattern;

    patternFromJSON(poisoned);

    // Object.prototype must not be contaminated
    expect(({} as Record<string, unknown>).evil).toBeUndefined();

    // The pattern itself must not carry the poisoned key
    const restored = patternFromJSON(poisoned);
    expect(restored.type).toBe("sequential");
    expect(
      (restored as unknown as Record<string, unknown>).evil,
    ).toBeUndefined();
  });

  // ---------- overrides ----------

  it("patternFromJSON with overrides — override is applied on top of JSON", () => {
    const json: SerializedPattern = {
      type: "parallel",
      handlers: ["a", "b"],
      minSuccess: 1,
    };
    const merge = (results: unknown[]) => results;
    const restored = patternFromJSON(json, { merge } as Partial<
      ParallelPattern<unknown[]>
    >) as ParallelPattern<unknown[]>;

    expect(restored.merge).toBe(merge);
    expect(restored.handlers).toEqual(["a", "b"]);
    expect(restored.minSuccess).toBe(1);
  });

  it("patternFromJSON overrides — can override agents list", () => {
    const json: SerializedPattern = {
      type: "race",
      handlers: ["slow", "slower"],
      timeout: 1000,
    };
    const restored = patternFromJSON(json, {
      handlers: ["fast", "faster"],
    } as Partial<RacePattern<unknown>>) as RacePattern<unknown>;

    expect(restored.handlers).toEqual(["fast", "faster"]);
    expect(restored.timeout).toBe(1000);
  });

  // ---------- full JSON.stringify/JSON.parse round-trip ----------

  it("JSON.stringify / JSON.parse full cycle — parallel", () => {
    const p = parallel(["r", "w"], (results) => results, { minSuccess: 2 });
    const json = patternToJSON(p);
    const serialized = JSON.stringify(json);
    const deserialized = JSON.parse(serialized) as SerializedPattern;
    const restored = patternFromJSON(deserialized) as ParallelPattern<unknown>;

    expect(restored.type).toBe("parallel");
    expect(restored.handlers).toEqual(["r", "w"]);
    expect(restored.minSuccess).toBe(2);
  });

  it("JSON.stringify / JSON.parse full cycle — debate", () => {
    const p = debate({
      handlers: ["pro", "con"],
      evaluator: "judge",
      maxRounds: 2,
      timeout: 5000,
    });

    const json = patternToJSON(p);
    const serialized = JSON.stringify(json);
    const deserialized = JSON.parse(serialized) as SerializedPattern;
    const restored = patternFromJSON(deserialized) as DebatePattern<unknown>;

    expect(restored.type).toBe("debate");
    expect(restored.handlers).toEqual(["pro", "con"]);
    expect(restored.evaluator).toBe("judge");
    expect(restored.maxRounds).toBe(2);
    expect(restored.timeout).toBe(5000);
  });

  it("JSON.stringify / JSON.parse full cycle — dag with deps", () => {
    const p = dag(
      {
        A: { handler: "fetcher" },
        B: { handler: "analyzer", deps: ["A"] },
      },
      (ctx: DagExecutionContext) => ctx.outputs,
    );

    const json = patternToJSON(p);
    const serialized = JSON.stringify(json);
    const deserialized = JSON.parse(serialized) as SerializedPattern;
    const restored = patternFromJSON(deserialized) as DagPattern<unknown>;

    expect(restored.type).toBe("dag");
    expect(restored.nodes.A!.handler).toBe("fetcher");
    expect(restored.nodes.B!.handler).toBe("analyzer");
    expect(restored.nodes.B!.deps).toEqual(["A"]);
  });

  it("JSON.stringify / JSON.parse full cycle — reflect with numeric threshold", () => {
    const p = reflect("writer", "critic", {
      maxIterations: 5,
      threshold: 0.8,
      onExhausted: "throw",
    });
    const json = patternToJSON(p);
    const serialized = JSON.stringify(json);
    const deserialized = JSON.parse(serialized) as SerializedPattern;
    const restored = patternFromJSON(deserialized) as ReflectPattern<unknown>;

    expect(restored.type).toBe("reflect");
    expect(restored.handler).toBe("writer");
    expect(restored.evaluator).toBe("critic");
    expect(restored.maxIterations).toBe(5);
    expect(restored.threshold).toBe(0.8);
    expect(restored.onExhausted).toBe("throw");
  });
});
