import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKERS_AI_MODEL,
  WORKERS_AI_PRICING,
  WORKERS_AI_PRICING_AS_OF,
  createWorkersAIRunner,
} from "../adapters/workers-ai.js";
import { readReportedUsage } from "../pricing.js";

function agent(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-agent",
    instructions: "You are helpful.",
    model: undefined as string | undefined,
    ...overrides,
  };
}

function fakeBinding(result: unknown) {
  return { run: vi.fn().mockResolvedValue(result) };
}

describe("createWorkersAIRunner", () => {
  it("sends model and messages to the binding and reports usage", async () => {
    const binding = fakeBinding({
      response: "Hello!",
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
    const onBeforeCall = vi.fn();
    const onAfterCall = vi.fn();
    const runner = createWorkersAIRunner({
      binding,
      temperature: 0.2,
      maxTokens: 64,
      hooks: { onBeforeCall, onAfterCall },
    });

    const result = await runner(agent(), "Hi");

    const [model, input] = binding.run.mock.calls[0]!;
    expect(model).toBe(DEFAULT_WORKERS_AI_MODEL);
    expect(input).toEqual({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
      temperature: 0.2,
      max_tokens: 64,
    });
    expect(result.output).toBe("Hello!");
    expect(result.totalTokens).toBe(17);
    expect(result.tokenUsage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(result.usageReported).toBe(true);
    expect(onBeforeCall).toHaveBeenCalledOnce();
    expect(onAfterCall).toHaveBeenCalledOnce();
    expect(onAfterCall.mock.calls[0]![0].tokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
    });
  });

  it("uses agent.model over the runner model", async () => {
    const binding = fakeBinding({ response: "x" });
    const runner = createWorkersAIRunner({ binding, model: "@cf/a/b" });
    await runner(agent({ model: "@cf/c/d" }), "Hi");
    expect(binding.run.mock.calls[0]![0]).toBe("@cf/c/d");
  });

  it("marks usage as not reported when the binding sends none", async () => {
    const runner = createWorkersAIRunner({
      binding: fakeBinding({ response: "no usage here" }),
    });
    const result = await runner(agent(), "Hi");
    expect(result.usageReported).toBe(false);
  });

  it("treats an all-zero usage block as not reported", async () => {
    const runner = createWorkersAIRunner({
      binding: fakeBinding({
        response: "x",
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    });
    expect((await runner(agent(), "Hi")).usageReported).toBe(false);
  });

  it("fires the error hook and rethrows when the binding throws", async () => {
    const boom = new Error("AiError: 3040 capacity");
    const binding = { run: vi.fn().mockRejectedValue(boom) };
    const onError = vi.fn();
    const runner = createWorkersAIRunner({ binding, hooks: { onError } });

    await expect(runner(agent(), "Hi")).rejects.toBe(boom);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0].error).toBe(boom);
  });

  it("carries reported usage on the error when the shape is unrecognised", async () => {
    const onError = vi.fn();
    const runner = createWorkersAIRunner({
      binding: fakeBinding({
        weird: true,
        usage: { prompt_tokens: 30, completion_tokens: 2 },
      }),
      hooks: { onError },
    });

    const err = await runner(agent(), "Hi").catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toContain("weird");
    expect(readReportedUsage(err)).toEqual({
      inputTokens: 30,
      outputTokens: 2,
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("rejects a non-object response", async () => {
    const runner = createWorkersAIRunner({ binding: fakeBinding("nope") });
    await expect(runner(agent(), "Hi")).rejects.toThrow(/not an object/);
  });

  describe("response shapes", () => {
    it("reads a string response, parsing JSON text", async () => {
      const runner = createWorkersAIRunner({
        binding: fakeBinding({ response: '{"a":1}' }),
      });
      expect((await runner(agent(), "Hi")).output).toEqual({ a: 1 });
    });

    it("passes an object response through and serialises it for hooks", async () => {
      const onAfterCall = vi.fn();
      const runner = createWorkersAIRunner({
        binding: fakeBinding({ response: { a: 1 } }),
        hooks: { onAfterCall },
      });
      const result = await runner(agent(), "Hi");
      expect(result.output).toEqual({ a: 1 });
      expect(onAfterCall.mock.calls[0]![0].output).toBe('{"a":1}');
    });

    it("reads the OpenAI-compatible choices envelope and its usage names", async () => {
      const runner = createWorkersAIRunner({
        binding: fakeBinding({
          choices: [{ message: { content: "from choices" } }],
          usage: { input_tokens: 4, output_tokens: 6 },
        }),
      });
      const result = await runner(agent(), "Hi");
      expect(result.output).toBe("from choices");
      expect(result.tokenUsage).toEqual({ inputTokens: 4, outputTokens: 6 });
    });
  });

  it("forwards the abort signal to the binding", async () => {
    const binding = fakeBinding({ response: "x" });
    const runner = createWorkersAIRunner({ binding });
    const ctrl = new AbortController();
    await runner(agent(), "Hi", { signal: ctrl.signal });
    expect(binding.run.mock.calls[0]![2]).toEqual({ signal: ctrl.signal });
  });

  it("rejects a binding without run()", () => {
    expect(() => createWorkersAIRunner({ binding: {} as never })).toThrow(
      /binding/,
    );
  });
});

describe("WORKERS_AI_PRICING", () => {
  it("prices every model above zero in both field spellings", () => {
    expect(Object.keys(WORKERS_AI_PRICING).length).toBeGreaterThan(0);
    for (const rates of Object.values(WORKERS_AI_PRICING)) {
      expect(rates.input).toBeGreaterThan(0);
      expect(rates.output).toBeGreaterThan(0);
      expect(rates.inputPerMillion).toBe(rates.input);
      expect(rates.outputPerMillion).toBe(rates.output);
    }
  });

  it("carries the verified rates for the default model", () => {
    const rates = WORKERS_AI_PRICING[DEFAULT_WORKERS_AI_MODEL]!;
    expect(rates.input).toBe(0.293);
    expect(rates.output).toBe(2.253);
  });

  it("has a plausible checked-on date", () => {
    expect(WORKERS_AI_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
