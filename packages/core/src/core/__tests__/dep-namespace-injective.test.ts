/**
 * The dependency-set namespace, held to its own promise.
 *
 * A tracked dependency set is one flat `Set<string>` holding both fact keys and
 * derivation IDs. `DERIVATION_DEP_PREFIX` — U+001F, the unit separator — is
 * what keeps the two apart: a derivation goes in as the separator followed by
 * its ID, a fact as its key verbatim. That works only while no fact key starts
 * with the separator. One that does is byte-for-byte the recorded form of the
 * same-named derivation, which is the exact collision the separator was
 * introduced to eliminate, moved one character to the right.
 *
 * The comment on that constant used to claim a control character could not
 * appear in a property name written in source. It can. So the namespace is now
 * injective by enforcement, and these tests are what enforce the enforcement.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

const SEP = String.fromCharCode(0x1f);

describe("the derivation dependency namespace", () => {
  it("rejects a fact key carrying the separator", () => {
    expect(() =>
      createModule("m", {
        schema: {
          facts: { [`${SEP}ready`]: t.boolean() },
          derivations: { ready: t.boolean() },
        },
        derive: { ready: () => true },
      }),
    ).toThrow(/U\+001F/);
  });

  it("rejects a derivation carrying the separator", () => {
    expect(() =>
      createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: { [`${SEP}big`]: t.boolean() },
        },
        derive: { [`${SEP}big`]: (facts) => facts.n > 2 },
      }),
    ).toThrow(/U\+001F/);
  });

  it("rejects it mid-name, not only in front", () => {
    // Only a leading separator collides today. The character has no legitimate
    // use in an identifier, and a rule that turns on position would leave the
    // next reader to work out why.
    expect(() =>
      createModule("m", {
        schema: { facts: { [`is${SEP}ready`]: t.boolean() } },
      }),
    ).toThrow(/U\+001F/);
  });

  // There is deliberately no "throws in production too" test here. The check is
  // outside the `isDevelopment` gate on purpose — a wrong invalidation set is
  // not a dev-mode concern — but `#is-development` is a package export
  // condition resolved at build time, so under the test build it is a constant
  // `true`. A test that flipped `process.env.NODE_ENV` would pass whether or
  // not the call sat inside the gate, which is worse than no test: it reads as
  // coverage. The placement is held by the comment at the call site instead.

  it("leaves an ordinary fact-and-derivation name pair alone", () => {
    // The namespace's actual job: a fact and a derivation may share a name, and
    // writing the fact must not wake a reader of the derivation.
    let runs = 0;
    const m = createModule("m", {
      schema: {
        facts: { ready: t.boolean(), other: t.number() },
        derivations: { ready: t.boolean() },
      },
      init: (facts) => {
        facts.ready = false;
        facts.other = 0;
      },
      derive: { ready: (facts) => facts.other > 5 },
      effects: {
        watch: {
          run: (_facts, _prev, derived) => {
            void derived.ready;
            runs++;
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();

    return (async () => {
      await system.settle();
      const before = runs;

      // The effect reads only the derivation, whose only input is `other`.
      system.facts.ready = true;
      await system.settle();

      expect(runs).toBe(before);
      system.stop();
    })();
  });
});
