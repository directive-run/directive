import { t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import {
  predicateFromIntent,
  predicateFromIntentRaw,
  predicateToolSpec,
  PredicateFromIntentError,
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
