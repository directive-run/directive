import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeTaggedStreams } from "../streaming.js";
import type { MultiplexedStreamChunk, MultiplexedStreamResult } from "../streaming.js";
import type { OrchestratorStreamChunk } from "../agent-orchestrator.js";
import {
  createMockAgentRunner,
  createTestMultiAgentOrchestrator,
  collectMultiplexedStream,
  assertMultiplexedStream,
} from "../testing.js";
import type { RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

async function* mockStream(
  chunks: OrchestratorStreamChunk[],
  delay = 0,
): AsyncIterable<OrchestratorStreamChunk> {
  for (const chunk of chunks) {
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    yield chunk;
  }
}

function tokenChunk(data: string, tokenCount: number): OrchestratorStreamChunk {
  return { type: "token", data, tokenCount };
}

function doneChunk(totalTokens: number, duration = 100): OrchestratorStreamChunk {
  return { type: "done", totalTokens, duration, droppedTokens: 0 };
}

function errorChunk(message: string): OrchestratorStreamChunk {
  return { type: "error", error: new Error(message) };
}

// ============================================================================
// 1. mergeTaggedStreams
// ============================================================================

describe("mergeTaggedStreams", () => {
  it("returns empty stream when sources is empty (via iterator return)", async () => {
    const { stream: merged } = mergeTaggedStreams([]);
    const iterator = merged[Symbol.asyncIterator]();

    // With zero sources, no finish() fires so the stream never closes on its own.
    // Calling return() is the correct way to terminate an idle merge.
    const result = await iterator.return!();

    expect(result.done).toBe(true);
  });

  it("tags all chunks from a single source with agentId", async () => {
    const sourceChunks: OrchestratorStreamChunk[] = [
      tokenChunk("hello", 1),
      tokenChunk(" world", 2),
      doneChunk(2),
    ];

    const { stream: merged } = mergeTaggedStreams([
      { agentId: "alpha", stream: mockStream(sourceChunks) },
    ]);

    const chunks = await collectMultiplexedStream(merged);

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.agentId).toBe("alpha");
    }
    expect(chunks[0]!.chunk).toEqual(tokenChunk("hello", 1));
    expect(chunks[2]!.chunk).toEqual(doneChunk(2));
  });

  it("merges chunks from two sources", async () => {
    const alphaChunks: OrchestratorStreamChunk[] = [
      tokenChunk("A1", 1),
      doneChunk(1),
    ];
    const betaChunks: OrchestratorStreamChunk[] = [
      tokenChunk("B1", 1),
      tokenChunk("B2", 2),
      doneChunk(2),
    ];

    const { stream: merged } = mergeTaggedStreams([
      { agentId: "alpha", stream: mockStream(alphaChunks) },
      { agentId: "beta", stream: mockStream(betaChunks) },
    ]);

    const chunks = await collectMultiplexedStream(merged);

    // All 5 chunks should arrive
    expect(chunks).toHaveLength(5);

    const alphaReceived = chunks.filter((c) => c.agentId === "alpha");
    const betaReceived = chunks.filter((c) => c.agentId === "beta");

    expect(alphaReceived).toHaveLength(2);
    expect(betaReceived).toHaveLength(3);
  });

  it("interleaves chunks when sources have delays", async () => {
    // Alpha emits slowly, Beta emits fast. They should interleave.
    const alphaChunks: OrchestratorStreamChunk[] = [
      tokenChunk("A1", 1),
      tokenChunk("A2", 2),
    ];
    const betaChunks: OrchestratorStreamChunk[] = [
      tokenChunk("B1", 1),
      tokenChunk("B2", 2),
    ];

    const { stream: merged } = mergeTaggedStreams([
      { agentId: "alpha", stream: mockStream(alphaChunks, 20) },
      { agentId: "beta", stream: mockStream(betaChunks, 5) },
    ]);

    const chunks = await collectMultiplexedStream(merged);
    const agentOrder = chunks.map((c) => c.agentId);

    // Beta should appear before Alpha's second chunk since it has a shorter delay
    // At minimum, both agents should be represented
    expect(agentOrder).toContain("alpha");
    expect(agentOrder).toContain("beta");

    // Beta's first chunk should arrive before Alpha's second chunk
    const betaFirstIdx = agentOrder.indexOf("beta");
    const alphaSecondIdx = agentOrder.lastIndexOf("alpha");

    expect(betaFirstIdx).toBeLessThan(alphaSecondIdx);
  });

  it("emits error chunks tagged with agent (does not crash merge)", async () => {
    const alphaChunks: OrchestratorStreamChunk[] = [
      tokenChunk("A1", 1),
      errorChunk("alpha failed"),
    ];
    const betaChunks: OrchestratorStreamChunk[] = [
      tokenChunk("B1", 1),
      doneChunk(1),
    ];

    const { stream: merged } = mergeTaggedStreams([
      { agentId: "alpha", stream: mockStream(alphaChunks) },
      { agentId: "beta", stream: mockStream(betaChunks) },
    ]);

    const chunks = await collectMultiplexedStream(merged);

    // Both agents should have emitted their chunks
    const alphaReceived = chunks.filter((c) => c.agentId === "alpha");
    const betaReceived = chunks.filter((c) => c.agentId === "beta");

    expect(alphaReceived).toHaveLength(2);
    expect(betaReceived).toHaveLength(2);

    // Alpha's error chunk should be tagged
    const alphaError = alphaReceived.find((c) => c.chunk.type === "error");
    expect(alphaError).toBeDefined();
    expect(alphaError!.agentId).toBe("alpha");
  });

  it("completes when all sources complete", async () => {
    const alphaChunks: OrchestratorStreamChunk[] = [tokenChunk("A1", 1)];
    const betaChunks: OrchestratorStreamChunk[] = [tokenChunk("B1", 1)];

    const { stream: merged } = mergeTaggedStreams([
      { agentId: "alpha", stream: mockStream(alphaChunks) },
      { agentId: "beta", stream: mockStream(betaChunks) },
    ]);

    const chunks: MultiplexedStreamChunk[] = [];
    for await (const chunk of merged) {
      chunks.push(chunk);
    }

    // Stream should have ended (the for-await completed without hanging)
    expect(chunks).toHaveLength(2);
  });
});

// ============================================================================
// 2. Multi-agent runParallelStream
// ============================================================================

describe("Multi-agent runParallelStream", () => {
  it("streams and merges two agents successfully", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      defaultMockResponse: { output: "agent output", totalTokens: 50 },
    });

    const { stream, merge, results } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "test input",
      (runResults) => runResults.map((r) => String(r.output)).join(" + "),
    );

    const chunks = await collectMultiplexedStream(stream);
    const mergedResult = await merge;
    const runResults = await results;

    expect(chunks.length).toBeGreaterThan(0);
    expect(runResults).toHaveLength(2);
    expect(mergedResult).toContain("agent output");
  });

  it("emits tagged chunks from both agents", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      defaultMockResponse: { output: "output", totalTokens: 30 },
    });

    const { stream } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "test",
      (runResults) => runResults.map((r) => String(r.output)).join(""),
    );

    const chunks = await collectMultiplexedStream(stream);

    assertMultiplexedStream(chunks, {
      agentIds: ["alpha", "beta"],
    });
  });

  it("results resolves with successful run results", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      mockResponses: {
        alpha: { output: "alpha-out", totalTokens: 40 },
        beta: { output: "beta-out", totalTokens: 60 },
      },
    });

    const { stream, results } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "go",
      (r) => r,
    );

    // Consume stream to let it complete
    await collectMultiplexedStream(stream);
    const runResults = await results;

    expect(runResults).toHaveLength(2);
    expect(runResults.map((r) => r.output)).toContain("alpha-out");
    expect(runResults.map((r) => r.output)).toContain("beta-out");
  });

  it("merge resolves with the merged value", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      mockResponses: {
        alpha: { output: "hello", totalTokens: 10 },
        beta: { output: "world", totalTokens: 10 },
      },
    });

    const { stream, merge } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "input",
      (runResults) => runResults.map((r) => String(r.output)).join(" + "),
    );

    await collectMultiplexedStream(stream);
    const mergedResult = await merge;

    expect(mergedResult).toContain("+");
    expect(mergedResult).toContain("hello");
    expect(mergedResult).toContain("world");
  });

  it("abort() stops all agents", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      defaultMockResponse: { output: "test", totalTokens: 10, delay: 5000 },
    });

    const { stream, abort } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "test input",
      (runResults) => runResults.map((r) => String(r.output)).join(""),
    );

    // Abort immediately
    abort();

    // Stream should end without hanging
    const chunks = await collectMultiplexedStream(stream);

    // After abort, the stream should terminate (chunks may be empty or partial)
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("broadcasts a single string input to all agents", async () => {
    const calls: Array<{ agent: string; input: string }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      defaultMockResponse: {
        output: "out",
        totalTokens: 10,
        generate: (input, agent) => {
          calls.push({ agent: agent.name, input });

          return {};
        },
      },
    });

    const { stream } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "broadcast message",
      (r) => r,
    );

    await collectMultiplexedStream(stream);

    const alphaCall = calls.find((c) => c.agent === "alpha");
    const betaCall = calls.find((c) => c.agent === "beta");

    expect(alphaCall?.input).toBe("broadcast message");
    expect(betaCall?.input).toBe("broadcast message");
  });

  it("sends per-agent inputs when given a string array", async () => {
    const calls: Array<{ agent: string; input: string }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      defaultMockResponse: {
        output: "out",
        totalTokens: 10,
        generate: (input, agent) => {
          calls.push({ agent: agent.name, input });

          return {};
        },
      },
    });

    const { stream } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      ["alpha-input", "beta-input"],
      (r) => r,
    );

    await collectMultiplexedStream(stream);

    const alphaCall = calls.find((c) => c.agent === "alpha");
    const betaCall = calls.find((c) => c.agent === "beta");

    expect(alphaCall?.input).toBe("alpha-input");
    expect(betaCall?.input).toBe("beta-input");
  });

  it("throws when input count does not match agent count", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      defaultMockResponse: { output: "out", totalTokens: 10 },
    });

    expect(() => {
      orchestrator.runParallelStream(
        ["alpha", "beta"],
        ["only-one-input"],
        (r) => r,
      );
    }).toThrow(/Input count/);
  });

  it("succeeds with minSuccess when enough agents complete", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
        gamma: { agent: { name: "gamma", instructions: "" } },
      },
      mockResponses: {
        alpha: { output: "ok", totalTokens: 10 },
        beta: { output: "ok", totalTokens: 10 },
        gamma: { error: new Error("gamma failed") },
      },
    });

    const { stream, merge, results } = orchestrator.runParallelStream(
      ["alpha", "beta", "gamma"],
      "go",
      (runResults) => runResults.length,
      { minSuccess: 2 },
    );

    await collectMultiplexedStream(stream);
    const mergedResult = await merge;
    const runResults = await results;

    // 2 of 3 succeeded, which meets minSuccess
    expect(runResults).toHaveLength(2);
    expect(mergedResult).toBe(2);
  });

  it("rejects when minSuccess is not met", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      mockResponses: {
        alpha: { error: new Error("alpha failed") },
        beta: { output: "ok", totalTokens: 10 },
      },
    });

    const { stream, merge } = orchestrator.runParallelStream(
      ["alpha", "beta"],
      "go",
      (runResults) => runResults.length,
      { minSuccess: 2 },
    );

    await collectMultiplexedStream(stream);

    await expect(merge).rejects.toThrow(/Only 1\/2 agents succeeded/);
  });
});
