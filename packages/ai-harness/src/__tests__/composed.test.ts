/**
 * The chain, running inside somebody else's system.
 *
 * This is the arrangement the package's headline claim is about: the module
 * factory exists so a caller can put the chain next to their own modules,
 * sharing their plugins and their devtools session, instead of accepting the
 * system `createHarness` builds for them. It is also the arrangement that was
 * broken, and broken in the worst available way — `createSystem({ modules })`
 * namespaces derivations, an unnamespaced read of the derive proxy resolves a
 * *module name* rather than a derivation, so the gating derivation came back
 * `undefined`, the constraint went falsy, and the chain sat there. No error, no
 * output, nothing to search for.
 *
 * So the second module here is not scenery. It is what forces the namespaced
 * form, and it deliberately declares a `phase` and a `turnPending` of its own —
 * a binding that resolved the wrong namespace would read *those*, and the test
 * would catch it rather than passing on a coincidence.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";
import { createHarnessAgents } from "../core/agents.js";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import { createHarnessChain } from "../core/module.js";
import { createMemoryTranscriptStore } from "../core/transcript.js";
import { cannedResponses, testPreset } from "./fixtures.js";

/**
 * A module with nothing to do with the chain, and names that collide with it.
 *
 * `phase` and `turnPending` are the chain's own. Both mean something else here,
 * which is exactly the point: two modules in one system may each declare them,
 * and the chain must read its own.
 */
const bystander = createModule("bystander", {
  schema: {
    facts: { ticks: t.number() },
    derivations: { phase: t.string(), turnPending: t.boolean() },
  },
  init: (facts) => {
    facts.ticks = 0;
  },
  derive: {
    phase: () => "not-the-chain",
    // False forever. A chain bound to this namespace would never take a turn.
    turnPending: () => false,
  },
});

interface ComposedRun {
  events: HarnessEvent[];
  documents: ReadonlyMap<string, string>;
}

/** Build the chain by hand, compose it, run it, and hand back what happened. */
async function runComposed(namespace: "chain"): Promise<ComposedRun> {
  const preset = testPreset({ maxIterations: 3, budgetUsd: 5 });
  const events: HarnessEvent[] = [];
  const store = createMemoryTranscriptStore();
  const transcript = store.open({ runId: "composed" });

  const chain = createHarnessChain({
    preset,
    runId: "composed",
    transcript,
    agents: createHarnessAgents({
      preset,
      runner: createMockRunner({ responses: cannedResponses() }),
      retry: { maxRetries: 0 },
    }),
    emit: (event) => events.push(event),
  });

  const system = createSystem({
    modules: { [namespace]: chain.module, bystander },
  });

  chain.bind(system, namespace);
  system.start();

  const finished = new Promise<void>((resolve) => {
    events.push = ((event: HarnessEvent) => {
      const length = Array.prototype.push.call(events, event);
      if (event.type === "chain:complete") {
        resolve();
      }

      return length;
    }) as typeof events.push;
  });

  system.events[namespace].start({ input: "review this diff" });
  await finished;

  system.destroy();

  return { events, documents: store.documents() };
}

describe("the chain composed into a system it does not own", () => {
  it("runs to completion beside another module", async () => {
    const { events } = await runComposed("chain");

    const complete = events.find((event) => event.type === "chain:complete");
    expect(complete).toBeDefined();
    expect(complete?.type === "chain:complete" && complete.phase).toBe(
      "complete",
    );
    expect(complete?.type === "chain:complete" && complete.stopReason).toBe(
      "max-iterations",
    );
    expect(complete?.type === "chain:complete" && complete.iterations).toBe(3);
    expect(complete?.type === "chain:complete" && complete.synthesis).toContain(
      "SYNTHESIS",
    );

    // Turn order wrapped over the preset's personas, which is only true if the
    // chain read its own `nextPersona` rather than the bystander's namespace.
    const personas = events
      .filter((event) => event.type === "turn:completed")
      .map((event) => (event.type === "turn:completed" ? event.persona : ""));
    expect(personas).toEqual(["alpha", "beta", "gamma"]);

    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("mirrors the transcript through the store it was given", async () => {
    const { documents } = await runComposed("chain");

    const markdown = documents.get("composed.md") ?? "";
    // The input reached the header without anyone calling `setInput` — the
    // effect carries the fact across, so dispatching `start` is the whole of
    // driving the chain from outside.
    expect(markdown).toContain("**Input:** review this diff");
    expect(markdown).toContain("## 1. alpha");
    expect(markdown).toContain("# Synthesis");

    const sidecar = documents.get("composed.jsonl") ?? "";
    expect(sidecar.trim().split("\n")).toHaveLength(3);
  });
});

describe("binding refuses what it cannot resolve", () => {
  function build() {
    const preset = testPreset({ maxIterations: 1 });

    return createHarnessChain({
      preset,
      runId: "unbound",
      transcript: createMemoryTranscriptStore().open({ runId: "unbound" }),
      agents: createHarnessAgents({
        preset,
        runner: createMockRunner({ responses: cannedResponses() }),
      }),
      emit: () => {},
    });
  }

  it("names the system's modules when the namespace is missing", () => {
    const chain = build();
    const system = createSystem({
      modules: { chain: chain.module, bystander },
    });

    expect(() => chain.bind(system)).toThrow(/chain, bystander/);
    system.destroy();
  });

  it("names the system's modules when the namespace is wrong", () => {
    const chain = build();
    const system = createSystem({
      modules: { chain: chain.module, bystander },
    });

    expect(() => chain.bind(system, "nope")).toThrow(
      /"nope", which names no module/,
    );
    system.destroy();
  });

  it("refuses a namespace on a single-module system", () => {
    const chain = build();
    const system = createSystem({ module: chain.module });

    expect(() => chain.bind(system, "chain")).toThrow(/has none/);
    system.destroy();
  });

  it("says so when a derivation is read before the chain is bound", () => {
    const chain = build();
    // The gating constraint, evaluated without a system behind it. The engine
    // catches what a constraint throws, so the message has to be worth reading
    // where it lands rather than where it is raised.
    const when = chain.module.constraints?.runTurn?.when;

    expect(typeof when).toBe("function");
    expect(() => (when as () => boolean)()).toThrow(
      /before the chain was bound/,
    );
  });
});
