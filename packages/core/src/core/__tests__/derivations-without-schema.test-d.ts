/**
 * `schema.derivations` is documented as optional. It was not.
 *
 * `GetDerivationsSchema` fell back to `Record<string, never>` when the section
 * was omitted, so a derivation's expected return type resolved to `never` and
 * nothing you could return type-checked:
 *
 *     Type 'boolean' is not assignable to type 'never'.
 *
 * The runtime has always inferred these — only the types refused. This file is
 * checked by `tsc`, not run by vitest: every declaration below fails to compile
 * if the fallback goes back to `never`, which is the whole point of keeping it.
 */

import { createModule, t } from "../../index";

type Item = { id: string };

// A module that omits `schema.derivations` entirely.
export const inferred = createModule("inferred", {
  schema: { facts: { count: t.number(), label: t.string() } },
  derive: {
    isBig: (facts) => facts.count >= 3,
    labelLength: (facts) => facts.label.length,
    summary: (facts) => `${facts.label}: ${facts.count}`,
  },
});

// The same, with the shapes that the suppression comments in one consumer
// blamed for this — arrays and nullable objects. They were never the cause; a
// schema of two primitives failed identically.
export const inferredWithComplexFacts = createModule("complex", {
  schema: {
    facts: {
      count: t.number(),
      items: t.array<Item>(),
      current: t.nullable(t.object<Item>()),
    },
  },
  derive: {
    itemCount: (facts) => facts.items.length,
    hasCurrent: (facts) => facts.current !== null,
  },
});

// Declaring the section still constrains the return type exactly, which is the
// half that must not regress while making the other half optional.
export const declared = createModule("declared", {
  schema: {
    facts: { count: t.number() },
    derivations: { isBig: t.boolean() },
  },
  derive: {
    isBig: (facts) => facts.count >= 3,
  },
});
