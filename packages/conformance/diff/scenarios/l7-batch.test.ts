/** L7: batched resolvers — a window of requirements, and the resolve() fallback. */

import { type BuildContext, scenario, suite } from "../scenario.js";

function items(
  { core: { createModule, t }, external }: BuildContext,
  resolver: Record<string, unknown>,
) {
  return createModule("m", {
    schema: {
      facts: {
        wanted: t.array<string>(),
        have: t.object<Record<string, string>>(),
      },
      derivations: {},
      events: {},
      requirements: { ITEM: { id: t.string() } },
    },
    init: (facts: any) => {
      facts.wanted = [];
      facts.have = {};
    },
    constraints: {
      need: {
        when: (facts: any) =>
          facts.wanted.some((id: string) => !(id in facts.have)),
        require: (facts: any) =>
          facts.wanted
            .filter((id: string) => !(id in facts.have))
            .map((id: string) => ({ type: "ITEM", id })),
      },
    },
    resolvers: {
      item: {
        requirement: "ITEM",
        key: (req: any) => `item-${req.id}`,
        ...resolver,
        ...(resolver.resolveBatch
          ? {}
          : {
              resolve: async (req: any, context: any) => {
                external(["single", req.id]);
                context.facts.have = {
                  ...context.facts.have,
                  [req.id]: `one:${req.id}`,
                };
              },
            }),
      },
    },
  } as any);
}

suite("L7 batched resolvers", () => {
  scenario(
    "a batch window collects requirements into one resolveBatch",
    (ctx) => ({
      module: items(ctx, {
        batch: { enabled: true, windowMs: 10, maxSize: 3 },
        resolveBatch: async (reqs: any[], context: any) => {
          ctx.external(["batch", reqs.map((r) => r.id)]);
          await new Promise((resolve) => setTimeout(resolve, 2));
          const have = { ...context.facts.have };
          for (const r of reqs) {
            have[r.id] = `batch:${r.id}`;
          }
          context.facts.have = have;
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "wanted", value: ["a", "b"] },
      { op: "advance", ms: 3 },
      { op: "set", key: "wanted", value: ["a", "b", "c", "d", "e"] },
      { op: "settle" },
    ],
  );

  scenario(
    "batch enabled with only resolve() falls back to one call each",
    (ctx) => ({
      module: items(ctx, { batch: { enabled: true, windowMs: 5 } }),
    }),
    [
      { op: "start" },
      { op: "set", key: "wanted", value: ["x", "y", "z"] },
      { op: "settle" },
    ],
  );

  scenario(
    "a failing batch retries and reports per batch",
    (ctx) => {
      let calls = 0;

      return {
        module: items(ctx, {
          batch: { enabled: true, windowMs: 0 },
          retry: { attempts: 2, backoff: "none" },
          resolveBatch: async (reqs: any[], context: any) => {
            calls += 1;
            ctx.external(["batch attempt", calls, reqs.map((r) => r.id)]);
            if (calls === 1) {
              throw new Error("batch down");
            }
            const have = { ...context.facts.have };
            for (const r of reqs) {
              have[r.id] = "ok";
            }
            context.facts.have = have;
          },
        }),
      };
    },
    [
      { op: "start" },
      { op: "set", key: "wanted", value: ["p", "q"] },
      { op: "settle" },
    ],
  );
});
