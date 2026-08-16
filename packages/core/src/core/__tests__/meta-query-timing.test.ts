/**
 * A plugin asking "does this carry pii?" during a fact write must be told about
 * the write it is being notified of.
 *
 * The unbatched path notified plugins and then invalidated the graph, so a
 * plugin reading metadata inside `onFactSet` saw the answer from before the
 * write it was reacting to. The batched path already invalidated first, so the
 * two disagreed with each other — a redactor got the right answer for a write
 * inside `system.batch()` and a stale one for the identical write outside it.
 *
 * The two tests below are the same scenario on the two paths. Before the fix
 * the batched one passed and the unbatched one did not.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";
import type { Plugin } from "../../index";

/** A derivation that reads a tagged fact only while a gate is open. */
function gatedModule() {
  return createModule("m", {
    schema: {
      facts: {
        consented: t.boolean(),
        email: t.string().meta({ tags: ["pii"] }),
        unrelated: t.number(),
      },
      derivations: { shown: t.string() },
    },
    init: (facts) => {
      facts.consented = false;
      facts.email = "a@b.test";
      facts.unrelated = 0;
    },
    derive: {
      shown: (facts) => (facts.consented ? facts.email : ""),
    },
  });
}

/**
 * Records what `byTag("pii")` answered during each fact write.
 *
 * Both hooks, because a batched write never reaches `onFactSet` — the store
 * announces the whole batch through `onFactsBatch` instead. A plugin that
 * implements only the first is silent for every event-handler, effect and
 * hydrate write.
 */
function probe(seen: Map<string, string[]>): Plugin {
  function record(key: string): void {
    const system = probeSystem;
    if (!system) {
      return;
    }
    seen.set(
      key,
      system.meta
        .byTag("pii")
        .map((m: { type: string; id: string }) => `${m.type}:${m.id}`)
        .sort(),
    );
  }

  return {
    name: "probe",
    onFactSet(key) {
      record(String(key));
    },
    onFactsBatch(changes) {
      for (const change of changes) {
        record(String(change.key));
      }
    },
    onInit(system) {
      probeSystem = system;
    },
  } as Plugin;
}

// biome-ignore lint/suspicious/noExplicitAny: test-local capture of the system
let probeSystem: any = null;

describe("metadata answers reflect the write being announced", () => {
  it("sees the derivation join the tagged set on the write that opens the gate", () => {
    const seen = new Map<string, string[]>();
    const system = createSystem({ module: gatedModule(), plugins: [probe(seen)] });
    system.start();

    // Opening the gate makes `shown` read `email`, so it starts carrying pii.
    system.facts.consented = true;

    expect(seen.get("consented")).toEqual([
      "derivation:shown",
      "fact:email",
    ]);

    system.stop();
    probeSystem = null;
  });

  it("agrees with the batched path", () => {
    const seen = new Map<string, string[]>();
    const system = createSystem({ module: gatedModule(), plugins: [probe(seen)] });
    system.start();

    system.batch(() => {
      system.facts.consented = true;
    });

    expect(seen.get("consented")).toEqual([
      "derivation:shown",
      "fact:email",
    ]);

    system.stop();
    probeSystem = null;
  });
});
