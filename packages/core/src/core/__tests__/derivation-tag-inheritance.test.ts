/**
 * A tag on a fact is a claim about the value, and a derivation carries the
 * value forward.
 *
 * Before this, it did not carry the claim. `email` tagged `pii` and
 * `domain: (facts) => facts.email` returning it verbatim meant
 * `meta.byTag("pii")` answered with the fact alone — so the audit ledger, the
 * clobber alerts, and any redactor written against the tag all treated a
 * verbatim copy of PII as non-sensitive, by construction. The graph that could
 * answer the question was already being maintained for invalidation. Nothing
 * asked it.
 *
 * The question this now answers: "you tagged email as PII — show me every
 * computed value that contains it." With one honest limit, pinned below: the
 * answer is about the state the system is in, not every state it could reach.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

function ids(matches: Array<{ kind: string; id: string }>): string[] {
  return matches.map((m) => `${m.kind}:${m.id}`).sort();
}

describe("tags along the derivation graph", () => {
  it("reports a derivation that reads a tagged fact", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { email: t.string().meta({ tags: ["pii"] }) },
          derivations: { domain: t.string() },
        },
        init: (facts) => {
          facts.email = "a@b.test";
        },
        derive: { domain: (facts) => facts.email },
      }),
    });
    system.start();

    expect(ids(system.meta.byTag("pii"))).toEqual([
      "derivation:domain",
      "fact:email",
    ]);
    // And it says which of the two someone actually wrote.
    const derived = system.meta.byTag("pii").find((m) => m.id === "domain");
    expect(derived?.tagOrigin).toBe("inherited");

    system.stop();
  });

  it("carries through composition", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { email: t.string().meta({ tags: ["pii"] }) },
          derivations: { domain: t.string(), banner: t.string() },
        },
        init: (facts) => {
          facts.email = "a@b.test";
        },
        derive: {
          domain: (facts) => facts.email,
          banner: (_facts, derived) => `signed in as ${derived.domain}`,
        },
      }),
    });
    system.start();

    expect(ids(system.meta.byTag("pii"))).toEqual([
      "derivation:banner",
      "derivation:domain",
      "fact:email",
    ]);

    system.stop();
  });

  it("exposes what a derivation picked up, separately from what was authored", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { email: t.string().meta({ tags: ["pii"] }) },
          derivations: { domain: t.string() },
        },
        init: (facts) => {
          facts.email = "a@b.test";
        },
        derive: {
          domain: {
            compute: (facts) => facts.email,
            meta: { label: "Email domain", tags: ["ui"] },
          },
        },
      }),
    });
    system.start();

    const meta = system.meta.derivation("domain");
    expect(meta?.label).toBe("Email domain");
    // Authored stays authored...
    expect(meta?.tags).toEqual(["ui"]);
    // ...and inherited is reported as its own thing, not merged into it.
    expect(meta?.inheritedTags).toEqual(["pii"]);

    system.stop();
  });

  it("stops where the author says the claim stops holding", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { email: t.string().meta({ tags: ["pii"] }) },
          derivations: {
            bucket: t.number(),
            report: t.string(),
            passthrough: t.string(),
          },
        },
        init: (facts) => {
          facts.email = "a@b.test";
        },
        derive: {
          bucket: {
            compute: (facts) => facts.email.length,
            // A length is not an email. Saying so stops the walk here...
            meta: { tagBoundary: true },
          },
          // ...and for anything reading it, which is the part that matters:
          // overruling a stated boundary from downstream would make the
          // statement worthless.
          report: (_facts, derived) => `bucket ${derived.bucket}`,
          // The sibling that says nothing. Without it, this test would pass on
          // a build where inheritance does not happen at all, which is exactly
          // the build it is here to distinguish from.
          passthrough: (facts) => facts.email,
        },
      }),
    });
    system.start();

    expect(ids(system.meta.byTag("pii"))).toEqual([
      "derivation:passthrough",
      "fact:email",
    ]);
    expect(system.meta.derivation("bucket")?.inheritedTags).toBeUndefined();
    expect(system.meta.derivation("report")?.inheritedTags).toBeUndefined();

    system.stop();
  });

  it("answers about the state the system is in, not every state it could reach", () => {
    // The honest limit, pinned so nobody reads byTag() as an exhaustive audit.
    // Dependencies are what the last computation actually read, so a body that
    // branches records the branch taken.
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: {
            consented: t.boolean(),
            email: t.string().meta({ tags: ["pii"] }),
          },
          derivations: { shown: t.string() },
        },
        init: (facts) => {
          facts.consented = true;
          facts.email = "a@b.test";
        },
        derive: { shown: (facts) => (facts.consented ? facts.email : "") },
      }),
    });
    system.start();

    expect(ids(system.meta.byTag("pii"))).toContain("derivation:shown");

    // Flip the branch: the derivation no longer reads the tagged fact, and the
    // report follows the value rather than the source text.
    system.facts.consented = false;
    expect(ids(system.meta.byTag("pii"))).not.toContain("derivation:shown");

    system.stop();
  });

  it("leaves an untagged graph alone", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: { doubled: t.number() },
        },
        init: (facts) => {
          facts.n = 1;
        },
        derive: { doubled: (facts) => facts.n * 2 },
      }),
    });
    system.start();

    expect(system.meta.byTag("pii")).toEqual([]);
    expect(system.meta.derivation("doubled")).toBeUndefined();

    system.stop();
  });
});
