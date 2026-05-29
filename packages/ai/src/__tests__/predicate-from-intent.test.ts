import { t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import {
  PredicateFromIntentError,
  predicateFromIntent,
  predicateFromIntentRaw,
  predicateFromIntentWithProvenance,
  predicateToolSpec,
  predicateToolSpecAnthropic,
  predicateToolSpecOpenAI,
} from "../predicate-from-intent.js";
import type { AgentRunner } from "../types.js";

// ============================================================================
// Test helpers — mock AgentRunner that returns canned outputs in sequence
// ============================================================================

function mockRunner(...outputs: string[]): AgentRunner {
  let i = 0;
  return vi.fn(async () => {
    const out = outputs[i++] ?? outputs[outputs.length - 1] ?? "{}";

    return {
      output: out as unknown as string,
      messages: [],
      toolCalls: [],
      totalTokens: 0,
    };
  }) as AgentRunner;
}

const SCHEMA = {
  facts: {
    cartTotal: t.number(),
    region: t.string(),
    active: t.boolean(),
  },
};

// ============================================================================
// Happy path
// ============================================================================

describe("predicateFromIntent — happy path", () => {
  it("returns a validated predicate on first attempt", async () => {
    const runner = mockRunner('{"cartTotal":{"$gte":50}}');
    const predicate = await predicateFromIntent({
      intent: "checkout unblocked when cart at least 50",
      schema: SCHEMA,
      runner,
    });
    expect(predicate).toEqual({ cartTotal: { $gte: 50 } });
  });

  it("handles JSON with surrounding prose", async () => {
    const runner = mockRunner(
      'Here is your predicate: {"region":{"$in":["US","EU"]}} — done.',
    );
    const predicate = await predicateFromIntent({
      intent: "block non-US/EU",
      schema: SCHEMA,
      runner,
    });
    expect(predicate).toEqual({ region: { $in: ["US", "EU"] } });
  });
});

// ============================================================================
// Validation pipeline — each layer
// ============================================================================

describe("predicateFromIntent — validation pipeline", () => {
  it("rejects output exceeding maxPredicateBytes (DoS guard, pre-parse)", async () => {
    const huge = "x".repeat(70_000); // > 64 KiB default
    const runner = mockRunner(huge);

    const raw = await predicateFromIntentRaw({
      intent: "anything",
      schema: SCHEMA,
      runner,
      maxRetries: 1,
    });
    expect(raw.predicate).toBeNull();
    expect(raw.errors[0]?.reason).toMatch(/maxPredicateBytes/);
  });

  it("retries on structural-invalid output (unknown operator)", async () => {
    const runner = mockRunner(
      '{"cartTotal":{"$weirdo":5}}',
      '{"cartTotal":{"$gte":5}}',
    );
    const predicate = await predicateFromIntent({
      intent: "amount at least 5",
      schema: SCHEMA,
      runner,
    });
    expect(predicate).toEqual({ cartTotal: { $gte: 5 } });
  });

  it("retries on schema-mismatch (operator on wrong kind)", async () => {
    // $gte on a boolean is structurally valid but semantically wrong.
    const runner = mockRunner(
      '{"active":{"$gte":true}}',
      '{"active":{"$eq":true}}',
    );
    const predicate = await predicateFromIntent({
      intent: "active flag is true",
      schema: SCHEMA,
      runner,
    });
    expect(predicate).toEqual({ active: { $eq: true } });
  });

  it("retries on unknown fact path", async () => {
    const runner = mockRunner(
      '{"ssn":{"$eq":"123-45-6789"}}', // not in schema
      '{"region":{"$eq":"US"}}',
    );
    const predicate = await predicateFromIntent({
      intent: "region is US",
      schema: SCHEMA,
      runner,
    });
    expect(predicate).toEqual({ region: { $eq: "US" } });
  });

  it("rejects output exceeding maxOperatorCount", async () => {
    // 5 operator clauses, cap at 3
    const runner = mockRunner(
      JSON.stringify({
        cartTotal: { $gte: 1, $lte: 100 },
        region: { $eq: "US" },
        active: { $eq: true, $ne: false },
      }),
    );

    const raw = await predicateFromIntentRaw({
      intent: "many clauses",
      schema: SCHEMA,
      runner,
      maxOperatorCount: 3,
      maxRetries: 0,
    });
    expect(raw.predicate).toBeNull();
    expect(
      raw.errors.some((e) =>
        e.details?.some((d) => d.reason.includes("maxOperatorCount")),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Retry exhaustion
// ============================================================================

describe("predicateFromIntent — retry exhaustion", () => {
  it("throws PredicateFromIntentError after maxRetries fail", async () => {
    const runner = mockRunner(
      "garbage 1",
      "garbage 2",
      "garbage 3",
      "garbage 4",
    );

    await expect(
      predicateFromIntent({
        intent: "anything",
        schema: SCHEMA,
        runner,
        maxRetries: 3,
      }),
    ).rejects.toBeInstanceOf(PredicateFromIntentError);
  });

  it("predicateFromIntentRaw returns predicate:null on exhaustion (no throw)", async () => {
    const runner = mockRunner("garbage 1", "garbage 2");

    const raw = await predicateFromIntentRaw({
      intent: "anything",
      schema: SCHEMA,
      runner,
      maxRetries: 1,
    });
    expect(raw.predicate).toBeNull();
    expect(raw.attempts).toBe(2);
    expect(raw.errors).toHaveLength(2);
    expect(raw.lastRawOutput).toBe("garbage 2");
  });

  it("error carries attempts + lastRawOutput for debugging", async () => {
    const runner = mockRunner("garbage");

    try {
      await predicateFromIntent({
        intent: "x",
        schema: SCHEMA,
        runner,
        maxRetries: 1,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PredicateFromIntentError);
      const e = err as PredicateFromIntentError;
      expect(e.attempts).toBe(2);
      expect(e.lastRawOutput).toBe("garbage");
      expect(e.errors.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Input validation
// ============================================================================

describe("predicateFromIntent — input validation", () => {
  it("rejects empty intent", async () => {
    await expect(
      predicateFromIntent({
        intent: "",
        schema: SCHEMA,
        runner: mockRunner("{}"),
      }),
    ).rejects.toThrow(/non-empty string/);
  });

  it("rejects schema with no introspectable facts", async () => {
    await expect(
      predicateFromIntent({
        intent: "x",
        schema: {},
        runner: mockRunner("{}"),
      }),
    ).rejects.toThrow(/no introspectable facts/);
  });

  it("applies the `redact` option to the intent before prompting", async () => {
    const runner = vi.fn(async () => ({
      output: '{"cartTotal":{"$gte":1}}',
      messages: [],
      toolCalls: [],
      totalTokens: 0,
    })) as AgentRunner;
    const redact = vi.fn((s: string) => s.replace(/SECRET/g, "[redacted]"));

    await predicateFromIntent({
      intent: "find SECRET orders",
      schema: SCHEMA,
      runner,
      redact,
    });
    expect(redact).toHaveBeenCalledWith("find SECRET orders");
    // Verify the redacted intent was used in the prompt
    const call = (runner as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1]).toContain("[redacted]");
    expect(call[1]).not.toContain("SECRET");
  });
});

// ============================================================================
// predicateToolSpec
// ============================================================================

describe("predicateToolSpec", () => {
  it("produces a tool spec with the schema embedded in description", () => {
    const spec = predicateToolSpec(SCHEMA);
    expect(spec.name).toBe("emit_predicate");
    expect(spec.description).toContain("cartTotal");
    expect(spec.description).toContain("number");
    expect(spec.description).toContain("ops:");
    expect(spec.input_schema.required).toEqual(["predicate"]);
  });

  it("respects custom name + description", () => {
    const spec = predicateToolSpec(SCHEMA, {
      name: "block_checkout",
      description: "Block checkout under condition X",
    });
    expect(spec.name).toBe("block_checkout");
    expect(spec.description).toBe("Block checkout under condition X");
  });

  it("filters schema summary by factPath", () => {
    const spec = predicateToolSpec(
      {
        facts: {
          cartTotal: t.number(),
          region: t.string(),
        },
      },
      { factPath: "cart" },
    );
    // factPath "cart" doesn't match "cartTotal" (no dot) — depending on semantics,
    // this filters to empty. The schemaSummary should at minimum not contain "region".
    expect(spec.schemaSummary).not.toContain("region:");
  });
});

// ============================================================================
// C6 — split Anthropic / OpenAI tool-spec shapes
// ============================================================================

describe("predicateToolSpecAnthropic (C6) — Anthropic Messages shape", () => {
  it("emits { name, description, input_schema } at top level", () => {
    const spec = predicateToolSpecAnthropic(SCHEMA);
    expect(spec.name).toBe("emit_predicate");
    expect(spec.input_schema).toEqual({
      type: "object",
      properties: { predicate: { type: "object" } },
      required: ["predicate"],
    });
    expect(spec.description).toContain("cartTotal");
    expect(spec.schemaSummary).toContain("cartTotal");
  });

  it("schema lives under input_schema (NOT under function.parameters)", () => {
    const spec = predicateToolSpecAnthropic(SCHEMA);
    expect("input_schema" in spec).toBe(true);
    // OpenAI keys must not appear on the Anthropic shape.
    expect("function" in (spec as object)).toBe(false);
    expect("type" in (spec as object)).toBe(false);
  });
});

describe("predicateToolSpecOpenAI (C6) — OpenAI Chat Completions shape", () => {
  it("emits { type: 'function', function: { name, description, parameters } }", () => {
    const spec = predicateToolSpecOpenAI(SCHEMA);
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("emit_predicate");
    expect(spec.function.parameters).toEqual({
      type: "object",
      properties: { predicate: { type: "object" } },
      required: ["predicate"],
    });
    expect(spec.function.description).toContain("cartTotal");
    expect(spec.schemaSummary).toContain("cartTotal");
  });

  it("does NOT include the Anthropic top-level input_schema", () => {
    const spec = predicateToolSpecOpenAI(SCHEMA);
    expect("input_schema" in (spec as object)).toBe(false);
  });

  it("respects custom name + description", () => {
    const spec = predicateToolSpecOpenAI(SCHEMA, {
      name: "set_rule",
      description: "Set a rule.",
    });
    expect(spec.function.name).toBe("set_rule");
    expect(spec.function.description).toBe("Set a rule.");
  });
});

describe("predicateToolSpec (deprecated alias) — back-compat", () => {
  it("returns the Anthropic shape (identical to predicateToolSpecAnthropic)", () => {
    const aliased = predicateToolSpec(SCHEMA);
    const anthropic = predicateToolSpecAnthropic(SCHEMA);
    expect(aliased).toEqual(anthropic);
  });
});

// ============================================================================
// M1 — $in / $nin maxArrayOperandLength enforced end-to-end
// ============================================================================

describe("predicateFromIntent — maxArrayOperandLength cap (M1)", () => {
  it("rejects a $in operand with > 1000 elements (default cap)", async () => {
    const huge = Array.from({ length: 1001 }, (_, i) => `r${i}`);
    const runner = mockRunner(JSON.stringify({ region: { $in: huge } }));

    const raw = await predicateFromIntentRaw({
      intent: "many regions",
      schema: SCHEMA,
      runner,
      maxRetries: 0,
    });

    expect(raw.predicate).toBeNull();
    const reasons = raw.errors
      .flatMap((e) => e.details ?? [])
      .map((d) => d.reason);
    expect(reasons.some((r) => r.includes("maxArrayOperandLength"))).toBe(true);
  });

  it("accepts a $in operand at the cap", async () => {
    const ok = Array.from({ length: 5 }, (_, i) => `r${i}`);
    const runner = mockRunner(JSON.stringify({ region: { $in: ok } }));

    const result = await predicateFromIntent({
      intent: "few regions",
      schema: SCHEMA,
      runner,
      maxArrayOperandLength: 5,
    });
    expect((result as Record<string, unknown>).region).toBeDefined();
  });
});

// ============================================================================
// M7 — AbortSignal cooperative cancellation
// ============================================================================

describe("predicateFromIntent — AbortSignal (M7)", () => {
  it("throws 'aborted' when signal fires before the first attempt", async () => {
    const controller = new AbortController();
    controller.abort();

    const runner = mockRunner('{"cartTotal":{"$gte":1}}');
    await expect(
      predicateFromIntent({
        intent: "x",
        schema: SCHEMA,
        runner,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it("throws 'aborted' on a retry boundary after validation failure", async () => {
    const controller = new AbortController();
    let calls = 0;
    const runner: AgentRunner = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        controller.abort();

        return {
          output: "garbage",
          messages: [],
          toolCalls: [],
          totalTokens: 0,
        };
      }

      return {
        output: '{"cartTotal":{"$gte":1}}',
        messages: [],
        toolCalls: [],
        totalTokens: 0,
      };
    }) as AgentRunner;

    await expect(
      predicateFromIntent({
        intent: "x",
        schema: SCHEMA,
        runner,
        maxRetries: 3,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
    expect(calls).toBe(1); // never reached the retry
  });
});

// ============================================================================
// M16 — retry feedback scopes schema reminder to offending paths
// ============================================================================

describe("predicateFromIntent — retry feedback scope (M16)", () => {
  it("retry prompt only includes kinds for offending paths + 'N more facts' sentinel", async () => {
    // Build a 200-fact schema where only one fact is touched in the bad predicate.
    const wideFacts: Record<string, ReturnType<typeof t.number>> = {};
    for (let i = 0; i < 200; i++) {
      wideFacts[`field${i}`] = t.number();
    }
    const wideSchema = { facts: wideFacts };

    const runner: AgentRunner = vi.fn(async () => ({
      output: '{"field5":{"$startsWith":"x"}}', // $startsWith invalid on number
      messages: [],
      toolCalls: [],
      totalTokens: 0,
    })) as AgentRunner;

    await predicateFromIntentRaw({
      intent: "test",
      schema: wideSchema,
      runner,
      maxRetries: 1,
    });

    const calls = (runner as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const retryPrompt = calls[1]![1] as string;

    // The retry should mention the offending field…
    expect(retryPrompt).toContain("field5");
    // …and include the truncation sentinel…
    expect(retryPrompt).toMatch(/more fact\(s\) available/);
    // …and NOT spam 200 fields back at the LLM.
    let mentionCount = 0;
    for (let i = 0; i < 200; i++) {
      if (retryPrompt.includes(`field${i}:`)) mentionCount++;
    }
    expect(mentionCount).toBeLessThan(10);
  });
});

// ============================================================================
// M24 — predicateFromIntentWithProvenance
// ============================================================================

describe("predicateFromIntentWithProvenance (M24)", () => {
  it("returns predicate + provenance record on success", async () => {
    const runner = mockRunner('{"cartTotal":{"$gte":50}}');
    const result = await predicateFromIntentWithProvenance({
      intent: "checkout unblocked when cart at least 50",
      schema: SCHEMA,
      runner,
      agent: { name: "test-emitter", model: "gpt-4o-mini" },
    });

    expect(result.predicate).toEqual({ cartTotal: { $gte: 50 } });
    expect(result.provenance.model).toBe("gpt-4o-mini");
    expect(result.provenance.intent).toBe(
      "checkout unblocked when cart at least 50",
    );
    expect(result.provenance.attemptCount).toBe(1);
    expect(result.provenance.emittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof result.provenance.predicateHash).toBe("string");
    expect(result.provenance.predicateHash.length).toBeGreaterThan(0);
    expect(typeof result.provenance.intentHash).toBe("string");
    expect(result.provenance.intentHash.length).toBeGreaterThan(0);
  });

  it("provenance.model is 'unknown' when agent has no model", async () => {
    const runner = mockRunner('{"cartTotal":{"$gte":1}}');
    const result = await predicateFromIntentWithProvenance({
      intent: "any",
      schema: SCHEMA,
      runner,
    });
    expect(result.provenance.model).toBe("unknown");
  });

  it("intent reflects redacted form when redact is supplied", async () => {
    const runner = mockRunner('{"cartTotal":{"$gte":1}}');
    const result = await predicateFromIntentWithProvenance({
      intent: "find SECRET orders",
      schema: SCHEMA,
      runner,
      redact: (s) => s.replace(/SECRET/g, "[redacted]"),
    });
    expect(result.provenance.intent).toBe("find [redacted] orders");
  });

  it("throws PredicateFromIntentError on retry exhaustion (same as non-provenance)", async () => {
    const runner = mockRunner("garbage", "garbage", "garbage", "garbage");
    await expect(
      predicateFromIntentWithProvenance({
        intent: "x",
        schema: SCHEMA,
        runner,
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(PredicateFromIntentError);
  });

  it("two identical successful runs yield the same predicateHash", async () => {
    const r1 = await predicateFromIntentWithProvenance({
      intent: "x",
      schema: SCHEMA,
      runner: mockRunner('{"cartTotal":{"$gte":50}}'),
    });
    const r2 = await predicateFromIntentWithProvenance({
      intent: "x",
      schema: SCHEMA,
      runner: mockRunner('{"cartTotal":{"$gte":50}}'),
    });
    expect(r1.provenance.predicateHash).toBe(r2.provenance.predicateHash);
  });

  // ============================================================================
  // N3 — predicateHash is invariant under whitespace / key-order differences
  // ============================================================================

  it("N3: same logical predicate emitted with different whitespace → same predicateHash", async () => {
    const tight = '{"cartTotal":{"$gte":50},"region":{"$in":["US","EU"]}}';
    const loose =
      '  {\n  "cartTotal" : {\n    "$gte" : 50\n  },\n  "region" : {\n    "$in" : [\n      "US",\n      "EU"\n    ]\n  }\n  }  ';

    const r1 = await predicateFromIntentWithProvenance({
      intent: "x",
      schema: SCHEMA,
      runner: mockRunner(tight),
    });
    const r2 = await predicateFromIntentWithProvenance({
      intent: "x",
      schema: SCHEMA,
      runner: mockRunner(loose),
    });

    // Same predicateHash — canonicalization absorbs the whitespace.
    expect(r1.provenance.predicateHash).toBe(r2.provenance.predicateHash);
  });

  it("N3: same logical predicate with different key order → same predicateHash", async () => {
    const orderA = '{"cartTotal":{"$gte":50},"region":{"$in":["US","EU"]}}';
    const orderB = '{"region":{"$in":["US","EU"]},"cartTotal":{"$gte":50}}';

    const r1 = await predicateFromIntentWithProvenance({
      intent: "x",
      schema: SCHEMA,
      runner: mockRunner(orderA),
    });
    const r2 = await predicateFromIntentWithProvenance({
      intent: "x",
      schema: SCHEMA,
      runner: mockRunner(orderB),
    });

    expect(r1.provenance.predicateHash).toBe(r2.provenance.predicateHash);
  });

  // ============================================================================
  // M6 — redactIntent option omits raw intent, keeps intentHash
  // ============================================================================

  it("M6: redactIntent: true → provenance omits raw intent, keeps intentHash", async () => {
    const runner = mockRunner('{"cartTotal":{"$gte":1}}');
    const result = await predicateFromIntentWithProvenance({
      intent: "patient SSN 123-45-6789 over-the-limit on cart",
      schema: SCHEMA,
      runner,
      redactIntent: true,
    });

    expect(result.provenance.intent).toBeUndefined();
    expect(typeof result.provenance.intentHash).toBe("string");
    expect(result.provenance.intentHash.length).toBeGreaterThan(0);

    // The raw intent must not appear anywhere in the serialized provenance.
    const serialized = JSON.stringify(result.provenance);
    expect(serialized).not.toContain("123-45-6789");
    expect(serialized).not.toContain("patient");
    expect(serialized).not.toContain("SSN");
  });

  it("M6: redactIntent: false (default) → both intent and intentHash present", async () => {
    const runner = mockRunner('{"cartTotal":{"$gte":1}}');
    const result = await predicateFromIntentWithProvenance({
      intent: "checkout unblocked when cart > 0",
      schema: SCHEMA,
      runner,
    });

    expect(result.provenance.intent).toBe("checkout unblocked when cart > 0");
    expect(typeof result.provenance.intentHash).toBe("string");
  });

  it("M6: intentHash is stable across runs for the same intent", async () => {
    const r1 = await predicateFromIntentWithProvenance({
      intent: "stable intent string",
      schema: SCHEMA,
      runner: mockRunner('{"cartTotal":{"$gte":1}}'),
    });
    const r2 = await predicateFromIntentWithProvenance({
      intent: "stable intent string",
      schema: SCHEMA,
      runner: mockRunner('{"cartTotal":{"$gte":1}}'),
    });
    expect(r1.provenance.intentHash).toBe(r2.provenance.intentHash);
  });
});

// ============================================================================
// M3 — mock-runner-style import.meta.env guard is Node-safe
// ============================================================================
//
// The mock-runner file in examples/compliance-audit references
// `import.meta.env.PROD` for its Vite production-build guard. In Node
// (vitest) `import.meta.env` is undefined and a naive read would throw
// TypeError on import.
//
// We can't cross-package import the actual file from a typed test
// project (rootDir constraint), but we CAN replicate the guard pattern
// here and assert it does the right thing in Node — vitest IS Node, so
// the same runtime guard the example uses is exercised here.

describe("mock-runner-style import.meta.env guard (M3)", () => {
  it("the feature-detected env access does NOT throw in Node (vitest IS Node)", () => {
    // Exact pattern used by examples/compliance-audit/src/mock-runner.ts.
    // If `import.meta.env` is undefined (Node), the optional chain
    // resolves to `undefined`; the comparison reads `undefined === true`
    // → false and the throw never fires. If we instead read
    // `import.meta.env.PROD` directly, Node would TypeError.
    expect(() => {
      const metaEnv =
        typeof import.meta !== "undefined" && "env" in import.meta
          ? (
              import.meta as {
                env?: { PROD?: boolean; VITE_ALLOW_MOCK_RUNNER?: string };
              }
            ).env
          : undefined;

      if (
        metaEnv?.PROD === true &&
        metaEnv?.VITE_ALLOW_MOCK_RUNNER !== "true"
      ) {
        throw new Error("guard fired in Node — should have no-opped");
      }
    }).not.toThrow();
  });

  it("the same guard DOES fire when metaEnv?.PROD === true (browser PROD build sim)", () => {
    // Simulate the Vite production build where the substituted env
    // object exists and PROD is true.
    expect(() => {
      const metaEnv: { PROD?: boolean; VITE_ALLOW_MOCK_RUNNER?: string } = {
        PROD: true,
      };
      if (
        metaEnv?.PROD === true &&
        metaEnv?.VITE_ALLOW_MOCK_RUNNER !== "true"
      ) {
        throw new Error(
          "[Directive demo] mockPredicateRunner is for demo only.",
        );
      }
    }).toThrow(/demo only/);
  });

  it("the guard no-ops when VITE_ALLOW_MOCK_RUNNER='true' even in PROD (browser opt-out)", () => {
    expect(() => {
      const metaEnv: { PROD?: boolean; VITE_ALLOW_MOCK_RUNNER?: string } = {
        PROD: true,
        VITE_ALLOW_MOCK_RUNNER: "true",
      };
      if (
        metaEnv?.PROD === true &&
        metaEnv?.VITE_ALLOW_MOCK_RUNNER !== "true"
      ) {
        throw new Error("should not fire");
      }
    }).not.toThrow();
  });
});

// ============================================================================
// N6 — AbortSignal threaded into runner call (in-flight cancellation)
// ============================================================================

describe("predicateFromIntent — AbortSignal threaded into runner (N6)", () => {
  it("forwards signal as the runner's third arg via RunOptions", async () => {
    const runner = vi.fn(async () => ({
      output: '{"cartTotal":{"$gte":1}}',
      messages: [],
      toolCalls: [],
      totalTokens: 0,
    })) as AgentRunner;

    const controller = new AbortController();
    await predicateFromIntent({
      intent: "x",
      schema: SCHEMA,
      runner,
      signal: controller.signal,
    });

    const calls = (runner as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[0]!;
    // Third positional arg is RunOptions; signal is forwarded.
    expect(lastCall[2]).toBeDefined();
    expect((lastCall[2] as { signal?: AbortSignal }).signal).toBe(
      controller.signal,
    );
  });

  it("throws 'aborted' when a slow runner is cancelled mid-call (runner honors signal)", async () => {
    const controller = new AbortController();
    let runnerCalls = 0;

    // Runner that resolves after a delay — but honors the signal by
    // rejecting once aborted (mirrors fetch's behavior).
    const slowRunner: AgentRunner = vi.fn(async (_agent, _input, options) => {
      runnerCalls++;

      return new Promise((resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (options?.signal?.aborted) {
          onAbort();

          return;
        }
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        // Long delay — never resolves before abort fires.
        setTimeout(() => {
          resolve({
            output: '{"cartTotal":{"$gte":1}}',
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          });
        }, 10_000);
      });
    }) as AgentRunner;

    const promise = predicateFromIntent({
      intent: "x",
      schema: SCHEMA,
      runner: slowRunner,
      signal: controller.signal,
      maxRetries: 3,
    });

    // Fire abort on the next macrotask, after the runner has been called.
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow(/aborted/);
    // The abort fires before the next retry — runner called exactly once.
    expect(runnerCalls).toBe(1);
  });
});
