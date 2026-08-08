/**
 * `createAgentMetrics` carries the same token classes the cost ledger prices.
 *
 * On a provider that reports prompt-cache usage, `inputTokens` is the *uncached
 * remainder* — so a run that reads a large cached prefix reports a fraction of
 * the tokens it actually processed when only input and output are counted. That
 * is the same under-reporting the cost side carried before cache tokens were
 * billed, one package over.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  type ObservabilityInstance,
  createAgentMetrics,
  createObservability,
} from "../observability.js";

let observability: ObservabilityInstance | undefined;

function makeObservability(): ObservabilityInstance {
  observability = createObservability({ serviceName: "agent-metrics-test" });

  return observability;
}

afterEach(async () => {
  await observability?.destroy();
  observability = undefined;
});

describe("createAgentMetrics token accounting", () => {
  it("counts cache reads and cache writes toward agent.tokens", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 2_000,
    });

    expect(obs.getMetric("agent.tokens.cache_read")?.sum).toBe(10_000);
    expect(obs.getMetric("agent.tokens.cache_write")?.sum).toBe(2_000);
    expect(obs.getMetric("agent.tokens")?.sum).toBe(12_150);
  });

  it("reports a heavily cached run as more than its uncached remainder", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    // What a cached run looks like on the wire: a small uncached remainder and
    // a large cached prefix the provider still processed and still billed.
    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      inputTokens: 40,
      outputTokens: 60,
      cacheReadTokens: 50_000,
    });

    expect(obs.getMetric("agent.tokens")?.sum).toBeGreaterThan(50_000);
  });

  it("leaves the cache metrics unrecorded when the provider reports none", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(obs.getMetric("agent.tokens.cache_read")).toBeUndefined();
    expect(obs.getMetric("agent.tokens.cache_write")).toBeUndefined();
    expect(obs.getMetric("agent.tokens")?.sum).toBe(150);
  });

  it("counts a cache write reported under the wire spelling", () => {
    // Every shipped adapter emits `cacheCreationTokens`; this surface read only
    // `cacheWriteTokens`. Adapter usage passed straight through therefore
    // reported no cache writes at all and a total of 150 rather than
    // 10,000,150. Both spellings resolve in one place now, and this is a
    // consumer of that place rather than a second implementation of it.
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 10_000_000,
    });

    expect(obs.getMetric("agent.tokens.cache_write")?.sum).toBe(10_000_000);
    expect(obs.getMetric("agent.tokens")?.sum).toBe(10_000_150);
  });

  it("bills the larger when a runner reports both spellings", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      cacheCreationTokens: 900,
      cacheWriteTokens: 1_500,
    });

    expect(obs.getMetric("agent.tokens.cache_write")?.sum).toBe(1_500);
  });

  it("does not count a token class inherited from the prototype", () => {
    Object.defineProperty(Object.prototype, "cacheReadTokens", {
      value: 1e15,
      configurable: true,
      enumerable: false,
    });
    try {
      const obs = makeObservability();
      const metrics = createAgentMetrics(obs);

      metrics.trackRun("support-agent", {
        success: true,
        latencyMs: 100,
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(obs.getMetric("agent.tokens.cache_read")).toBeUndefined();
      expect(obs.getMetric("agent.tokens")?.sum).toBe(150);
    } finally {
      // biome-ignore lint/performance/noDelete: restoring the prototype is the point
      delete (Object.prototype as Record<string, unknown>).cacheReadTokens;
    }
  });

  it("drops a count no counter can recover from", () => {
    // A counter is cumulative: one NaN addend is permanent, and every later
    // reading of the metric inherits it.
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      inputTokens: 100,
      outputTokens: Number.NaN,
    });

    expect(obs.getMetric("agent.tokens")?.sum).toBe(100);
    expect(obs.getMetric("agent.tokens.output")).toBeUndefined();
  });
});

describe("createAgentMetrics cost and tool-call accounting", () => {
  it("records a reported cost and tool-call count", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      cost: 1.25,
      toolCalls: 3,
    });

    expect(obs.getMetric("agent.cost")?.sum).toBe(1.25);
    expect(obs.getMetric("agent.tool_calls")?.sum).toBe(3);
  });

  it("does not bill a cost inherited from the prototype", () => {
    // `cost` and `toolCalls` sat three lines below the token guard, read bare.
    // A polluted prototype answered for every run that reported no cost —
    // which is most of them — summing 1e308 into a counter nothing can undo.
    Object.defineProperty(Object.prototype, "cost", {
      value: 1e308,
      configurable: true,
      enumerable: false,
    });
    try {
      const obs = makeObservability();
      const metrics = createAgentMetrics(obs);

      metrics.trackRun("support-agent", {
        success: true,
        latencyMs: 100,
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(obs.getMetric("agent.cost")).toBeUndefined();
    } finally {
      // biome-ignore lint/performance/noDelete: restoring the prototype is the point
      delete (Object.prototype as Record<string, unknown>).cost;
    }
  });

  it("drops a cost no counter can recover from", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      cost: Number.NaN,
      toolCalls: Number.POSITIVE_INFINITY,
    });

    expect(obs.getMetric("agent.cost")).toBeUndefined();
    expect(obs.getMetric("agent.tool_calls")).toBeUndefined();
  });

  it("drops a cost reported as a string rather than reading it as absent", () => {
    const obs = makeObservability();
    const metrics = createAgentMetrics(obs);

    metrics.trackRun("support-agent", {
      success: true,
      latencyMs: 100,
      cost: "1.25" as unknown as number,
    });

    expect(obs.getMetric("agent.cost")).toBeUndefined();
  });
});
