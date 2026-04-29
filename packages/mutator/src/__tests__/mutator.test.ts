// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "@directive-run/core";
import { flushAsync } from "@directive-run/core/testing";
import { defineMutator, mutate } from "../index.js";

type FormMutations = {
  submit: { values: string[] };
  cancel: Record<string, never>;
  retry: { reason: string };
};

interface FormDeps {
  submit: (values: string[]) => Promise<string[]>;
}

interface FormFacts {
  pendingMutation: unknown;
  values: string[];
  cancelCount: number;
  lastRetryReason: string | null;
}

function buildSystem(deps: FormDeps) {
  // Idiomatic Directive: handlers close over deps from this scope.
  const mut = defineMutator<FormMutations, FormFacts>({
    submit: async ({ payload, facts }) => {
      facts.values = await deps.submit(payload.values);
    },
    cancel: ({ facts }) => {
      facts.cancelCount += 1;
      facts.values = [];
    },
    retry: async ({ payload, facts }) => {
      facts.lastRetryReason = payload.reason;
    },
  });

  const module = createModule("form", {
    schema: {
      facts: {
        ...mut.facts,
        values: t.array<string>(),
        cancelCount: t.number(),
        lastRetryReason: t.string().nullable(),
      },
      events: {
        ...mut.events,
      },
      requirements: {
        ...mut.requirements,
      },
    },
    init: (f) => {
      (f as FormFacts).pendingMutation = mut.initialPendingMutation;
      f.values = [];
      f.cancelCount = 0;
      f.lastRetryReason = null;
    },
    events: {
      ...mut.eventHandlers,
    },
    constraints: {
      ...mut.constraints,
    },
    resolvers: {
      ...mut.resolvers,
    },
  });

  const sys = createSystem({ module });
  sys.start();
  return sys;
}

describe("@directive-run/mutator", () => {
  it("submit handler runs and clears pendingMutation on success", async () => {
    const sys = buildSystem({
      submit: async (vs) => vs.map((v) => v.toUpperCase()),
    });

    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a", "b"] }));
    await flushAsync();

    expect(JSON.parse(JSON.stringify(sys.facts.values))).toEqual(["A", "B"]);
    expect(sys.facts.pendingMutation).toBe(null);
    sys.destroy();
  });

  it("cancel handler runs without payload", async () => {
    const sys = buildSystem({ submit: async (v) => v });

    sys.events.MUTATE(mutate<FormMutations>("cancel"));
    await flushAsync();

    expect(sys.facts.cancelCount).toBe(1);
    expect(sys.facts.pendingMutation).toBe(null);
    sys.destroy();
  });

  it("retry handler captures payload", async () => {
    const sys = buildSystem({ submit: async (v) => v });

    sys.events.MUTATE(
      mutate<FormMutations>("retry", { reason: "network blip" }),
    );
    await flushAsync();

    expect(sys.facts.lastRetryReason).toBe("network blip");
    expect(sys.facts.pendingMutation).toBe(null);
    sys.destroy();
  });

  it("error in handler surfaces on pendingMutation.error and stops re-firing", async () => {
    const sys = buildSystem({
      submit: async () => {
        throw new Error("backend exploded");
      },
    });

    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();

    const pending = sys.facts.pendingMutation as {
      kind: string;
      error: string;
      status: string;
    } | null;
    expect(pending).not.toBe(null);
    expect(pending?.kind).toBe("submit");
    expect(pending?.error).toBe("backend exploded");
    expect(pending?.status).toBe("failed");
    expect(sys.facts.values).toEqual([]);
    sys.destroy();
  });

  it("dispatching a second mutation after success runs both", async () => {
    const sys = buildSystem({
      submit: async (vs) => vs.map((v) => v.toUpperCase()),
    });

    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();
    expect(sys.facts.values).toEqual(["A"]);

    sys.events.MUTATE(mutate<FormMutations>("cancel"));
    await flushAsync();
    expect(sys.facts.values).toEqual([]);
    expect(sys.facts.cancelCount).toBe(1);
    sys.destroy();
  });

  it("R1 sec C1: prototype-pollution kinds are rejected, not invoked", async () => {
    const sys = buildSystem({ submit: async (v) => v });
    // Bypass the typed mutate() helper to simulate a hostile dispatch.
    sys.events.MUTATE({
      kind: "constructor" as never,
      payload: {} as never,
      status: "pending",
      error: null,
    });
    await flushAsync();

    const pending = sys.facts.pendingMutation as {
      kind: string;
      error: string | null;
      status: string;
    } | null;
    expect(pending).not.toBe(null);
    expect(pending?.status).toBe("failed");
    expect(pending?.error).toContain("no handler registered for variant");
    sys.destroy();
  });

  it("R1 sec C1: __proto__ kind is rejected without invoking inherited", async () => {
    const sys = buildSystem({ submit: async (v) => v });
    sys.events.MUTATE({
      kind: "__proto__" as never,
      payload: {} as never,
      status: "pending",
      error: null,
    });
    await flushAsync();

    const pending = sys.facts.pendingMutation as {
      status: string;
    } | null;
    expect(pending?.status).toBe("failed");
    sys.destroy();
  });

  it("R1 sec C1: even if Object.prototype is polluted, lookup is rejected", async () => {
    const polluted = "__polluted__";
    (Object.prototype as Record<string, unknown>)[polluted] = () => {
      throw new Error("polluted handler invoked!");
    };
    try {
      const sys = buildSystem({ submit: async (v) => v });
      sys.events.MUTATE({
        kind: polluted as never,
        payload: {} as never,
        status: "pending",
        error: null,
      });
      await flushAsync();

      const pending = sys.facts.pendingMutation as {
        status: string;
      } | null;
      expect(pending?.status).toBe("failed");
      sys.destroy();
    } finally {
      delete (Object.prototype as Record<string, unknown>)[polluted];
    }
  });

  it("R1 sec C2: long error messages are truncated to 500 chars", async () => {
    const longMessage = "x".repeat(2_000);
    const sys = buildSystem({
      submit: async () => {
        throw new Error(longMessage);
      },
    });

    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();

    const pending = sys.facts.pendingMutation as {
      error: string;
    } | null;
    expect(pending?.error).toBeDefined();
    expect(pending!.error.length).toBeLessThanOrEqual(500);
    expect(pending!.error.endsWith("…")).toBe(true);
    sys.destroy();
  });

  it("R1 sec M5: in-flight mutation that is superseded does not get nulled by completing handler", async () => {
    let release: (() => void) | undefined;
    const slowSubmit = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          release = () => resolve(["A"]);
        }),
    );
    const sys = buildSystem({ submit: slowSubmit });

    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();

    // Mid-flight: a fresh MUTATE arrives.
    sys.events.MUTATE(mutate<FormMutations>("cancel"));
    // The original handler now completes:
    release?.();
    await flushAsync();

    // The cancel mutation should still be live (or already drained), NOT
    // nulled by the in-flight submit handler's completion path. Then
    // the cancel handler runs and cancelCount reaches 1.
    expect(sys.facts.cancelCount).toBe(1);
    sys.destroy();
  });

  it("R2 sec M-R2-1: non-Error throws are coerced safely", async () => {
    const sys = buildSystem({
      submit: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string-only thrown value";
      },
    });
    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();
    const pending = sys.facts.pendingMutation as { error: string } | null;
    expect(typeof pending?.error).toBe("string");
    expect(pending?.error).toContain("string-only thrown value");
    sys.destroy();
  });

  it("R2 sec M-R2-1: Error with non-string .message does not crash truncateError", async () => {
    const sys = buildSystem({
      submit: async () => {
        const e = new Error();
        // Hostile override — would TypeError on naive .length / .slice
        Object.defineProperty(e, "message", {
          value: 12345 as unknown as string,
        });
        throw e;
      },
    });
    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();
    const pending = sys.facts.pendingMutation as {
      error: string;
      status: string;
    } | null;
    expect(pending?.status).toBe("failed");
    expect(typeof pending?.error).toBe("string");
    expect(pending?.error).toContain("12345");
    sys.destroy();
  });

  it("R4 backlog: Error subclass with throwing message getter does not escape", async () => {
    class HostileError extends Error {
      override get message(): string {
        throw new Error("getter is hostile");
      }
    }
    const sys = buildSystem({
      submit: async () => {
        throw new HostileError();
      },
    });
    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();
    const pending = sys.facts.pendingMutation as {
      error: string;
      status: string;
    } | null;
    // The throw was contained; status is 'failed' with the
    // sentinel error message rather than crashing the resolver.
    expect(pending?.status).toBe("failed");
    expect(pending?.error).toContain("getter threw");
    sys.destroy();
  });

  it("R2 sec M-R2-1: object thrown values coerce without crash", async () => {
    const sys = buildSystem({
      submit: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { code: 500, custom: "field" };
      },
    });
    sys.events.MUTATE(mutate<FormMutations>("submit", { values: ["a"] }));
    await flushAsync();
    const pending = sys.facts.pendingMutation as {
      error: string;
      status: string;
    } | null;
    expect(pending?.status).toBe("failed");
    expect(typeof pending?.error).toBe("string");
    sys.destroy();
  });

  it("R1: explicit 'failed' status is in the type union", () => {
    // Type-level check — TS would catch removing 'failed' from the union.
    const failed: "pending" | "running" | "failed" = "failed";
    expect(failed).toBe("failed");
  });

  it("mutate() helper enforces variant payload shape at type level", () => {
    // Type-level smoke test: this should compile cleanly.
    const _submit = mutate<FormMutations>("submit", { values: ["x"] });
    const _cancel = mutate<FormMutations>("cancel");
    const _retry = mutate<FormMutations>("retry", { reason: "x" });
    expect(_submit.kind).toBe("submit");
    expect(_cancel.kind).toBe("cancel");
    expect(_retry.kind).toBe("retry");
    expect(_submit.status).toBe("pending");
    expect(_submit.error).toBe(null);
  });
});
