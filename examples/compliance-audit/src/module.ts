import { createModule, t } from "@directive-run/core";

/**
 * Checkout module — three facts, one data-form constraint with three
 * clauses. The constraint's whenSpec is what the audit ledger captures
 * and what predicateFromIntent emits a candidate replacement for.
 */
export const checkoutModule = createModule("checkout", {
  schema: {
    facts: {
      cartTotal: t.number(),
      region: t.string<"US" | "EU" | "ASIA" | "OTHER">(),
      tier: t.string<"free" | "pro" | "enterprise">().meta({ tags: ["pii"] }),
    },
    derivations: {},
    events: {},
    requirements: { CHECKOUT: {} },
  },
  init: (facts) => {
    facts.cartTotal = 30;
    facts.region = "US";
    facts.tier = "free";
  },
  constraints: {
    canCheckout: {
      // Data-form `when` — JSON. This is what the audit ledger captures,
      // what doctor compares candidates against, and what predict() runs.
      when: {
        cartTotal: { $gte: 50 },
        region: { $in: ["US", "EU"] },
      },
      require: { type: "CHECKOUT" },
    },
  },
});
