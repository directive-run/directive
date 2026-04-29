// @vitest-environment node
import { describe, expect, it } from "vitest";
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
    expect(pending?.status).toBe("running");
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
