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
});
