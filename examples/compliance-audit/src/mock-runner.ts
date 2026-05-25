/**
 * **DEMO ONLY — DO NOT USE IN PRODUCTION**
 *
 * Deterministic intent → predicate mapping so the demo works in
 * StackBlitz / no-API-key environments. Regex-matches the intent
 * string against a tiny canned table and ALWAYS returns something —
 * a real LLM this is not.
 *
 * For production, swap for a real runner from
 * `@directive-run/ai/openai`, `@directive-run/ai/anthropic`, or
 * `@directive-run/ai/ollama`.
 *
 * For tests, prefer `createMockAgentRunner` from
 * `@directive-run/ai/testing` — it records calls, supports per-agent
 * responses, simulated delays, and error injection.
 */

// ⚠ DEMO ONLY — DO NOT IMPORT IN PRODUCTION
// This runner regex-matches intents to canned predicates and ALWAYS returns
// something. In production, swap for @directive-run/ai/openai or similar.
//
// `import.meta.env.PROD` and `import.meta.env.VITE_ALLOW_MOCK_RUNNER` are
// referenced via direct property access (not via a typed cast) so Vite's
// `define`-style replacement substitutes them at build time. Wrapping the
// access in `(import.meta as { env?: ... }).env` would defeat the
// substitution and the guard would throw on every production build.
declare global {
  interface ImportMeta {
    env: {
      PROD: boolean;
      VITE_ALLOW_MOCK_RUNNER?: string;
    };
  }
}

if (
  import.meta.env.PROD === true &&
  import.meta.env.VITE_ALLOW_MOCK_RUNNER !== "true"
) {
  throw new Error(
    "[Directive demo] mockPredicateRunner is for demo only. Set VITE_ALLOW_MOCK_RUNNER=true to override.",
  );
}

import { createMockAgentRunner } from "@directive-run/ai/testing";
import type { AgentRunner } from "@directive-run/ai";

const CANNED: Array<{ match: RegExp; output: string }> = [
  {
    match: /cart.*(50|fifty)/i,
    output: '{"cartTotal":{"$gte":50},"region":{"$in":["US","EU"]}}',
  },
  {
    match: /cart.*(100|hundred)/i,
    output: '{"cartTotal":{"$gte":100},"region":{"$in":["US","EU"]}}',
  },
  {
    match: /cart.*empty/i,
    output: '{"cartTotal":{"$eq":0}}',
  },
  {
    match: /(US|EU)/i,
    output: '{"region":{"$in":["US","EU"]}}',
  },
  {
    match: /pro.*tier|tier.*pro/i,
    output: '{"tier":{"$eq":"pro"}}',
  },
  {
    match: /enterprise/i,
    output: '{"tier":{"$eq":"enterprise"}}',
  },
  {
    match: /(any|either).*(US|EU)/i,
    output: '{"$any":[{"region":{"$eq":"US"}},{"region":{"$eq":"EU"}}]}',
  },
];

const FALLBACK = '{"cartTotal":{"$gte":1}}';

// Use @directive-run/ai/testing's createMockAgentRunner so the demo
// shares one mock-runner implementation with the test suite. The
// dynamic `generate()` hook lets us preserve the regex → canned-output
// mapping that makes the demo deterministic.
const mock = createMockAgentRunner({
  defaultResponse: {
    output: FALLBACK,
    totalTokens: 0,
    generate: (input) => {
      const intent = input.match(/Intent:\s*([^\n]+)/)?.[1] ?? input;
      const found = CANNED.find((c) => c.match.test(intent));

      return { output: found?.output ?? FALLBACK };
    },
  },
  recordCalls: false,
});

export const mockPredicateRunner: AgentRunner = mock.run;
