import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchBreakpoint, createBreakpointId, createInitialBreakpointState } from "../breakpoints.js";
import type { BreakpointConfig, BreakpointContext, BreakpointRequest } from "../breakpoints.js";
import {
  createMockAgentRunner,
  createTestOrchestrator,
  createTestMultiAgentOrchestrator,
  createBreakpointSimulator,
} from "../testing.js";
import { sequential } from "../multi-agent-orchestrator.js";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides: Partial<BreakpointContext> = {}): BreakpointContext {
  return {
    agentId: "test-agent",
    agentName: "test-agent",
    input: "test input",
    state: {},
    breakpointType: "pre_agent_run",
    ...overrides,
  };
}

// ============================================================================
// 1. createBreakpointId
// ============================================================================

describe("createBreakpointId", () => {
  it("generates IDs starting with bp_", () => {
    const id = createBreakpointId();
    expect(id.startsWith("bp_")).toBe(true);
  });

  it("generates unique IDs on consecutive calls", () => {
    const id1 = createBreakpointId();
    const id2 = createBreakpointId();
    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// 2. createInitialBreakpointState
// ============================================================================

describe("createInitialBreakpointState", () => {
  it("returns empty pending, resolved, and cancelled arrays", () => {
    const state = createInitialBreakpointState();
    expect(state).toEqual({
      pending: [],
      resolved: [],
      cancelled: [],
    });
  });
});

// ============================================================================
// 3. matchBreakpoint
// ============================================================================

describe("matchBreakpoint", () => {
  const context = makeContext();

  it("returns null for empty breakpoints array", () => {
    const result = matchBreakpoint([], "pre_agent_run", context);
    expect(result).toBeNull();
  });

  it("returns matching config by type", () => {
    const configs: BreakpointConfig[] = [
      { type: "pre_agent_run" },
      { type: "post_run" },
    ];
    const result = matchBreakpoint(configs, "pre_agent_run", context);
    expect(result).toEqual({ type: "pre_agent_run" });
  });

  it("returns null when no type matches", () => {
    const configs: BreakpointConfig[] = [
      { type: "post_run" },
    ];
    const result = matchBreakpoint(configs, "pre_agent_run", context);
    expect(result).toBeNull();
  });

  it("returns matching config when when() returns true", () => {
    const configs: BreakpointConfig[] = [
      { type: "pre_agent_run", when: () => true },
    ];
    const result = matchBreakpoint(configs, "pre_agent_run", context);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("pre_agent_run");
  });

  it("returns null when when() returns false", () => {
    const configs: BreakpointConfig[] = [
      { type: "pre_agent_run", when: () => false },
    ];
    const result = matchBreakpoint(configs, "pre_agent_run", context);
    expect(result).toBeNull();
  });

  it("returns config with no when (always matches)", () => {
    const configs: BreakpointConfig[] = [
      { type: "pre_agent_run" },
    ];
    const result = matchBreakpoint(configs, "pre_agent_run", context);
    expect(result).toEqual({ type: "pre_agent_run" });
  });

  it("catches when() throwing and skips that breakpoint", () => {
    const configs: BreakpointConfig[] = [
      {
        type: "pre_agent_run",
        when: () => {
          throw new Error("predicate error");
        },
      },
      { type: "pre_agent_run" },
    ];
    // First config throws, second one matches (no when guard)
    const result = matchBreakpoint(configs, "pre_agent_run", context);
    expect(result).toEqual({ type: "pre_agent_run" });
  });
});

// ============================================================================
// 4. Single-agent breakpoints
// ============================================================================

describe("Single-agent breakpoints", () => {
  const agent = { name: "test-agent", instructions: "" };

  it("pre_input_guardrails fires before input guardrails run", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_input_guardrails" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(1);
    expect(simulator.hits[0].type).toBe("pre_input_guardrails");
  });

  it("pre_agent_run fires before agent execution", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(1);
    expect(simulator.hits[0].type).toBe("pre_agent_run");
  });

  it("pre_output_guardrails fires after agent, before output guardrails", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_output_guardrails" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(1);
    expect(simulator.hits[0].type).toBe("pre_output_guardrails");
  });

  it("post_run fires after all processing", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "post_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(1);
    expect(simulator.hits[0].type).toBe("post_run");
  });

  it("resume with input modification changes agent input", async () => {
    const simulator = createBreakpointSimulator({
      autoResumeDelay: 0,
      modifications: { input: "modified input" },
    });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "original input");

    // The mock runner should have received the modified input
    const calls = orchestrator.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("modified input");
  });

  it("resume with skip=true skips execution and returns empty result", async () => {
    const simulator = createBreakpointSimulator({
      autoResumeDelay: 0,
      modifications: { skip: true },
    });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    const result = await orchestrator.run(agent, "test");

    expect(result.output).toBeUndefined();
    expect(result.messages).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  it("cancel breakpoint rejects the run", async () => {
    const simulator = createBreakpointSimulator({
      cancel: true,
      cancelReason: "test cancel",
    });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await expect(orchestrator.run(agent, "test")).rejects.toThrow(/cancelled/);
  });

  it("multiple breakpoints fire in order", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [
        { type: "pre_input_guardrails" },
        { type: "pre_agent_run" },
        { type: "pre_output_guardrails" },
        { type: "post_run" },
      ],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(4);
    expect(simulator.hits[0].type).toBe("pre_input_guardrails");
    expect(simulator.hits[1].type).toBe("pre_agent_run");
    expect(simulator.hits[2].type).toBe("pre_output_guardrails");
    expect(simulator.hits[3].type).toBe("post_run");
  });

  it("no breakpoint overhead when array is empty", async () => {
    const orchestrator = createTestOrchestrator({
      breakpoints: [],
    });

    const result = await orchestrator.run(agent, "test");

    expect(result.output).toBe("mock response");
    expect(orchestrator.getCalls()).toHaveLength(1);
  });

  it("conditional breakpoint with when returning false does not fire", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run", when: () => false }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(0);
  });

  it("conditional breakpoint with when returning true fires", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run", when: () => true }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    expect(simulator.hits).toHaveLength(1);
    expect(simulator.hits[0].type).toBe("pre_agent_run");
  });

  it("breakpoint timeout rejects after configured time", async () => {
    // Use a very short timeout and no auto-resume so it times out
    const handler = vi.fn();
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: handler,
      breakpointTimeoutMs: 50,
    });
    // Do NOT attach a simulator — the breakpoint will never be resolved

    await expect(orchestrator.run(agent, "test")).rejects.toThrow(/timeout/i);
  });
});

// ============================================================================
// 5. Multi-agent breakpoints
// ============================================================================

describe("Multi-agent breakpoints", () => {
  it("agent-specific breakpoints fire on runAgent", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.runAgent("alpha", "hello");

    expect(simulator.hits).toHaveLength(1);
    expect(simulator.hits[0].type).toBe("pre_agent_run");
    expect(simulator.hits[0].agentId).toBe("alpha");
  });

  it("pre_handoff fires during handoff", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      breakpoints: [{ type: "pre_handoff" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.handoff("alpha", "beta", "handoff input");

    const handoffHits = simulator.hits.filter((h) => h.type === "pre_handoff");
    expect(handoffHits).toHaveLength(1);
    expect(handoffHits[0].agentId).toBe("alpha");
  });

  it("pre_pattern_step fires for sequential pattern steps", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      patterns: {
        pipeline: sequential(["alpha", "beta"]),
      },
      breakpoints: [{ type: "pre_pattern_step" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.runPattern("pipeline", "start");

    const stepHits = simulator.hits.filter((h) => h.type === "pre_pattern_step");
    expect(stepHits.length).toBeGreaterThanOrEqual(2);
  });

  it("resume works across agents", async () => {
    const simulator = createBreakpointSimulator({
      autoResumeDelay: 0,
      modifications: { input: "modified" },
    });
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
      },
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.runAgent("alpha", "original");

    // The mock runner should have received modified input
    const calls = orchestrator.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("modified");
  });

  it("cancel works across agents", async () => {
    const simulator = createBreakpointSimulator({
      cancel: true,
      cancelReason: "cancelled by test",
    });
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
      },
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
    });
    simulator.attachTo(orchestrator);

    await expect(orchestrator.runAgent("alpha", "test")).rejects.toThrow(/cancelled/i);
  });

  it("getPendingBreakpoints returns pending breakpoints", async () => {
    // Use a handler that does NOT auto-resolve, so we can inspect pending state
    let capturedRequest: BreakpointRequest | null = null;
    const handler = (req: BreakpointRequest) => {
      capturedRequest = req;
    };

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
      },
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: handler,
      breakpointTimeoutMs: 5000,
    });

    // Start run without awaiting — it will pause at the breakpoint
    const runPromise = orchestrator.runAgent("alpha", "test");

    // Give the microtask queue time to reach the breakpoint
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pending = orchestrator.getPendingBreakpoints();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].type).toBe("pre_agent_run");

    // Resume to clean up
    if (capturedRequest) {
      orchestrator.resumeBreakpoint(capturedRequest.id);
    }

    await runPromise;
  });

  it("multiple agents can have concurrent breakpoints with parallel execution", async () => {
    let capturedRequests: BreakpointRequest[] = [];
    const handler = (req: BreakpointRequest) => {
      capturedRequests.push(req);
    };

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: handler,
      breakpointTimeoutMs: 5000,
    });

    // Start two agents in parallel — both should hit breakpoints
    const runAlpha = orchestrator.runAgent("alpha", "alpha input");
    const runBeta = orchestrator.runAgent("beta", "beta input");

    // Wait for both breakpoints to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    const pending = orchestrator.getPendingBreakpoints();
    expect(pending.length).toBe(2);

    const agentIds = pending.map((p) => p.agentId).sort();
    expect(agentIds).toEqual(["alpha", "beta"]);

    // Resume both to clean up
    for (const req of capturedRequests) {
      orchestrator.resumeBreakpoint(req.id);
    }

    await Promise.all([runAlpha, runBeta]);
  });
});

// ============================================================================
// 6. Timeline integration
// ============================================================================

describe("Timeline integration", () => {
  const agent = { name: "test-agent", instructions: "" };

  it("records breakpoint_hit event in timeline when debug is true", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
      debug: true,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    const events = orchestrator.timeline!.getEvents();
    expect(events.some((e) => e.type === "breakpoint_hit")).toBe(true);
  });

  it("records breakpoint_resumed event in timeline when debug is true", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
      debug: true,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    const events = orchestrator.timeline!.getEvents();
    expect(events.some((e) => e.type === "breakpoint_resumed")).toBe(true);
  });

  it("breakpoint_hit event contains correct breakpoint type and agent ID", async () => {
    const simulator = createBreakpointSimulator({ autoResumeDelay: 0 });
    const orchestrator = createTestOrchestrator({
      breakpoints: [{ type: "pre_agent_run" }],
      onBreakpoint: simulator.handler,
      debug: true,
    });
    simulator.attachTo(orchestrator);

    await orchestrator.run(agent, "test");

    const events = orchestrator.timeline!.getEvents();
    const hitEvent = events.find((e) => e.type === "breakpoint_hit");
    expect(hitEvent).toBeDefined();
    expect((hitEvent as any).breakpointType).toBe("pre_agent_run");
    expect(hitEvent!.agentId).toBe("test-agent");
  });
});
