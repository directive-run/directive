import { describe, it, expect } from "vitest";
import {
  parallel,
  sequential,
  supervisor,
  dag,
  reflect,
  race,
  debate,
  patternToJSON,
} from "../multi-agent-orchestrator.js";
import { patternToMermaid } from "../pattern-mermaid.js";
import type { SerializedPattern } from "../multi-agent-orchestrator.js";

// ============================================================================
// Tests
// ============================================================================

describe("patternToMermaid", () => {
  // ---------- parallel ----------

  it("renders parallel pattern with fan-out / fan-in", () => {
    const p = parallel(["agent-a", "agent-b"], (r) => r);
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  __input((Input)) --> agent_a[agent-a]",
        "  agent_a[agent-a] --> __merge((Merge))",
        "  __input((Input)) --> agent_b[agent-b]",
        "  agent_b[agent-b] --> __merge((Merge))",
        "",
      ].join("\n"),
    );
  });

  it("deduplicates agents in parallel pattern", () => {
    const p = parallel(["worker", "worker", "worker"], (r) => r);
    const result = patternToMermaid(p);

    expect(result).toContain("worker_1[worker #1]");
    expect(result).toContain("worker_2[worker #2]");
    expect(result).toContain("worker_3[worker #3]");
  });

  // ---------- sequential ----------

  it("renders sequential pattern as pipeline chain", () => {
    const p = sequential(["agent-a", "agent-b", "agent-c"]);
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  agent_a[agent-a] --> agent_b[agent-b] --> agent_c[agent-c]",
        "",
      ].join("\n"),
    );
  });

  it("handles single-agent sequential", () => {
    const p = sequential(["solo"]);
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  solo[solo]",
        "",
      ].join("\n"),
    );
  });

  // ---------- supervisor ----------

  it("renders supervisor pattern with hub-spoke", () => {
    const p = supervisor("supervisor", ["worker-1", "worker-2"]);
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  supervisor[supervisor] -->|delegate| worker_1[worker-1]",
        "  worker_1[worker-1] -->|result| supervisor[supervisor]",
        "  supervisor[supervisor] -->|delegate| worker_2[worker-2]",
        "  worker_2[worker-2] -->|result| supervisor[supervisor]",
        "",
      ].join("\n"),
    );
  });

  // ---------- dag ----------

  it("renders DAG with topological sort and dependency edges", () => {
    const p = dag({
      fetch: { agent: "fetcher" },
      analyze: { agent: "analyzer", deps: ["fetch"] },
      summarize: { agent: "summarizer", deps: ["fetch"] },
      report: { agent: "reporter", deps: ["analyze", "summarize"] },
    });
    const result = patternToMermaid(p, { direction: "TD" });

    expect(result).toBe(
      [
        "graph TD",
        "  fetch[fetcher]",
        "  fetch[fetcher] --> analyze[analyzer]",
        "  fetch[fetcher] --> summarize[summarizer]",
        "  analyze[analyzer] --> report[reporter]",
        "  summarize[summarizer] --> report[reporter]",
        "",
      ].join("\n"),
    );
  });

  it("DAG determinism — same nodes in different insertion order produce identical output", () => {
    const p1 = dag({
      a: { agent: "alpha" },
      b: { agent: "beta", deps: ["a"] },
      c: { agent: "gamma", deps: ["a"] },
      d: { agent: "delta", deps: ["b", "c"] },
    });
    const p2 = dag({
      d: { agent: "delta", deps: ["b", "c"] },
      c: { agent: "gamma", deps: ["a"] },
      b: { agent: "beta", deps: ["a"] },
      a: { agent: "alpha" },
    });

    expect(patternToMermaid(p1)).toBe(patternToMermaid(p2));
  });

  it("DAG isolated nodes still appear", () => {
    const p = dag({
      lonely: { agent: "orphan" },
      connected: { agent: "linked", deps: [] },
    });
    const result = patternToMermaid(p);

    expect(result).toContain("connected[linked]");
    expect(result).toContain("lonely[orphan]");
  });

  it("DAG node ID vs agent name — key used as ID, node.agent as label", () => {
    const p = dag({
      step_1: { agent: "my-fancy-agent" },
    });
    const result = patternToMermaid(p);

    expect(result).toContain("step_1[my-fancy-agent]");
  });

  // ---------- race ----------

  it("renders race pattern with dotted output arrows", () => {
    const p = race(["agent-a", "agent-b"]);
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  __input((Input)) --> agent_a[agent-a]",
        "  agent_a[agent-a] -.-> __output((Output))",
        "  __input((Input)) --> agent_b[agent-b]",
        "  agent_b[agent-b] -.-> __output((Output))",
        "",
      ].join("\n"),
    );
  });

  it("deduplicates agents in race pattern", () => {
    const p = race(["fast", "fast"]);
    const result = patternToMermaid(p);

    expect(result).toContain("fast_1[fast #1]");
    expect(result).toContain("fast_2[fast #2]");
  });

  // ---------- reflect ----------

  it("renders reflect pattern with feedback loop", () => {
    const p = reflect("producer", "evaluator");
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  producer[producer] --> evaluator[evaluator]",
        "  evaluator[evaluator] -->|feedback| producer[producer]",
        "  evaluator[evaluator] -->|pass| __output((Output))",
        "",
      ].join("\n"),
    );
  });

  // ---------- debate ----------

  it("renders debate pattern with judge and rounds", () => {
    const p = debate({ agents: ["agent-a", "agent-b"], evaluator: "judge" });
    const result = patternToMermaid(p);

    expect(result).toBe(
      [
        "graph LR",
        "  agent_a[agent-a] --> judge[judge]",
        "  judge[judge] -->|next round| agent_a[agent-a]",
        "  agent_b[agent-b] --> judge[judge]",
        "  judge[judge] -->|next round| agent_b[agent-b]",
        "  judge[judge] --> __output((Output))",
        "",
      ].join("\n"),
    );
  });

  // ---------- SerializedPattern input ----------

  it("accepts pre-serialized pattern without double-serializing", () => {
    const json: SerializedPattern = {
      type: "sequential",
      agents: ["a", "b"],
    };
    const result = patternToMermaid(json);

    expect(result).toBe(
      [
        "graph LR",
        "  a[a] --> b[b]",
        "",
      ].join("\n"),
    );
  });

  it("accepts SerializedPattern from patternToJSON", () => {
    const p = parallel(["x", "y"], (r) => r);
    const json = patternToJSON(p);
    const fromRuntime = patternToMermaid(p);
    const fromSerialized = patternToMermaid(json);

    expect(fromRuntime).toBe(fromSerialized);
  });

  // ---------- options ----------

  it("uses TD direction when specified", () => {
    const p = sequential(["a", "b"]);
    const result = patternToMermaid(p, { direction: "TD" });

    expect(result).toMatch(/^graph TD\n/);
  });

  it("emits theme preamble when specified", () => {
    const p = sequential(["a"]);
    const result = patternToMermaid(p, { theme: "dark" });

    expect(result).toMatch(/^%%\{init: \{'theme': 'dark'\}\}%%\n/);
    expect(result).toContain("graph LR");
  });

  it("applies custom agent shape (round)", () => {
    const p = sequential(["x"]);
    const result = patternToMermaid(p, { shapes: { agent: "round" } });

    expect(result).toContain("x(x)");
  });

  it("applies custom agent shape (stadium)", () => {
    const p = sequential(["x"]);
    const result = patternToMermaid(p, { shapes: { agent: "stadium" } });

    expect(result).toContain("x([x])");
  });

  it("applies custom agent shape (hexagon)", () => {
    const p = sequential(["x"]);
    const result = patternToMermaid(p, { shapes: { agent: "hexagon" } });

    expect(result).toContain("x{{x}}");
  });

  it("applies custom virtual shape (square)", () => {
    const p = parallel(["a"], (r) => r);
    const result = patternToMermaid(p, { shapes: { virtual: "square" } });

    expect(result).toContain("__input[Input]");
    expect(result).toContain("__merge[Merge]");
  });

  it("applies custom virtual shape (stadium)", () => {
    const p = race(["a"]);
    const result = patternToMermaid(p, { shapes: { virtual: "stadium" } });

    expect(result).toContain("__input([Input])");
    expect(result).toContain("__output([Output])");
  });

  // ---------- edge cases ----------

  it("throws on unknown pattern type", () => {
    const bad = { type: "unknown" } as unknown as SerializedPattern;

    expect(() => patternToMermaid(bad)).toThrow(
      '[Directive] patternToMermaid: unknown pattern type "unknown"',
    );
  });

  it("sanitizes special characters in agent names", () => {
    const p = sequential(["my agent!", "test@2"]);
    const result = patternToMermaid(p);

    // IDs are sanitized (non-alphanumeric → _), labels escape Mermaid-special chars
    expect(result).toContain("my_agent_");
    expect(result).toContain("test_2");
  });

  it("escapes Mermaid-special characters in labels to prevent injection", () => {
    const p = sequential(["evil[inject]", "bad-->target"]);
    const result = patternToMermaid(p);

    // Brackets escaped via HTML char codes in labels
    expect(result).toContain("#91;inject#93;");
    // Angle bracket escaped in label (the --> between nodes is legitimate Mermaid edge syntax)
    expect(result).toContain("bad--#62;target");
    expect(result).toContain("evil_inject_");
    expect(result).toContain("bad___target");
  });

  it("escapes newlines in agent names", () => {
    const p = sequential(["line1\nline2"]);
    const result = patternToMermaid(p);

    // Newlines replaced with spaces
    expect(result).not.toContain("\n" + "line2");
    expect(result).toContain("line1 line2");
  });

  // ---------- determinism ----------

  it("100 calls with same input produce identical output", () => {
    const p = dag({
      a: { agent: "alpha" },
      b: { agent: "beta", deps: ["a"] },
      c: { agent: "gamma", deps: ["a"] },
    });

    const first = patternToMermaid(p);
    for (let i = 0; i < 100; i++) {
      expect(patternToMermaid(p)).toBe(first);
    }
  });
});
