/**
 * Mock AgentRunner — deterministic intent → predicate mapping so the
 * demo works in StackBlitz / no-API-key environments. Real apps swap
 * this for a real runner from `@directive-run/ai/openai` or similar.
 */

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
    output:
      '{"$any":[{"region":{"$eq":"US"}},{"region":{"$eq":"EU"}}]}',
  },
];

const FALLBACK = '{"cartTotal":{"$gte":1}}';

export const mockPredicateRunner: AgentRunner = (async (
  _agent,
  input,
  _options,
) => {
  const intent = input.match(/Intent:\s*([^\n]+)/)?.[1] ?? input;
  const found = CANNED.find((c) => c.match.test(intent));

  return {
    output: (found?.output ?? FALLBACK) as unknown as string,
    messages: [],
    toolCalls: [],
    totalTokens: 0,
  };
}) as AgentRunner;
