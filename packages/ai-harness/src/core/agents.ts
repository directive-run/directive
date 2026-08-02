/**
 * The agents the resolvers call, and the runner chain underneath them.
 *
 * ## The composition order, and why it is that order
 *
 * ```
 * withBudget( withRetry( dispatch → adapter ) )
 * ```
 *
 * Retry sits *inside* the budget so a retried call is billed once per attempt,
 * which is what the provider does. Inverting them would meter the successful
 * attempt and give away the failed ones — an outage would then cost real money
 * against a ledger reading zero.
 *
 * ## One ledger, one retry policy, several adapters
 *
 * A burst and the closing document have different token caps, and the Anthropic
 * adapter takes `maxTokens` at construction. The obvious response — build two
 * runners and wrap each — gives the chain two independent ledgers and two
 * independent retry budgets, so neither knows what the other spent and the
 * preset's dollar ceiling is enforced twice at half strength.
 *
 * So the wrappers go on once, around a dispatcher, and the only thing that
 * varies per agent is which adapter instance the dispatcher reaches for. Spend
 * accrues in one place regardless of who is speaking, which is what makes
 * `getSpent("total")` an answer the chain can be terminated on.
 *
 * ## No pricing conversion
 *
 * `ANTHROPIC_PRICING` entries are already the shape `withBudget` reads. There is
 * no mapping step below, and there should never be one — a function that turns
 * one pricing shape into another is a second list of rates that can drift from
 * the first.
 *
 * @module
 */

import {
  type AgentRegistry,
  type AgentRunner,
  type MultiAgentOrchestrator,
  type RetryConfig,
  type TokenPricing,
  createMultiAgentOrchestrator,
  requireModelPricing,
  withBudget,
  withRetry,
} from "@directive-run/ai";
import type { BudgetRunner } from "@directive-run/ai";
import {
  ANTHROPIC_PRICING,
  createAnthropicRunner,
} from "@directive-run/ai/anthropic";
import type { Plugin } from "@directive-run/core";
import type { PresetConfig } from "./preset-types.js";

export interface HarnessAgentsOptions {
  preset: PresetConfig;
  /**
   * Stand in for the provider entirely — the offline path, or a fake in a test.
   *
   * Supplied at the *base* of the chain, not in place of it: the retry policy
   * and the ledger still wrap it, so an offline run terminates on the same
   * condition an online one does.
   */
  runner?: AgentRunner;
  /** Required when `runner` is not supplied. */
  apiKey?: string;
  /**
   * Rates for `preset.model`. Defaults to the published Anthropic table, which
   * fails loudly for a model it has no row for rather than pricing it at zero.
   */
  pricing?: TokenPricing;
  /** Overrides the default retry policy. */
  retry?: RetryConfig;
  /** Plugins for the orchestrator's own Directive system. */
  plugins?: Plugin[];
  baseURL?: string;
}

export interface HarnessAgents {
  orchestrator: MultiAgentOrchestrator;
  /**
   * The chain's single cost ledger.
   *
   * `getSpent("total")` is the harness's accumulated-cost fact. The resolvers
   * read it rather than pricing calls themselves, because a second cost
   * calculation is a second answer to the same question, and the budget can
   * only be enforced against one of them.
   */
  budgetRunner: BudgetRunner;
}

/** Retry policy when the caller does not supply one. */
const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

export function createHarnessAgents(
  options: HarnessAgentsOptions,
): HarnessAgents {
  const {
    preset,
    runner,
    apiKey,
    pricing,
    retry,
    plugins = [],
    baseURL,
  } = options;

  if (runner === undefined && apiKey === undefined) {
    throw new Error(
      "[ai-harness] createHarnessAgents needs either an `apiKey` for the Anthropic adapter or a `runner` to stand in for it (see createMockRunner for the offline path).",
    );
  }

  const base = runner ?? createAnthropicDispatcher(preset, apiKey!, baseURL);
  const rates = pricing ?? requireModelPricing(ANTHROPIC_PRICING, preset.model);

  // A ledger, deliberately without a cap.
  //
  // `withBudget` can enforce a ceiling itself, and configuring one here at
  // `preset.budgetUsd` was the obvious thing to do — it is also the mistake
  // this package exists to avoid. The chain already has a ceiling, in
  // `canAffordBurst`, one derivation composed from what the chain has spent.
  // A second ceiling at the same number sits one level below where the
  // decision is made, and the two do not agree about what happens at the
  // boundary: the derivation stops the chain cleanly and reports `"budget"`,
  // while the cap throws mid-call and surfaces as a resolver failure reported
  // as `"error"`. Same money, same limit, two different accounts of the run.
  //
  // So the cap lives in exactly one place and this is not it. What `withBudget`
  // contributes is the thing there should only be one of: the ledger.
  // `getSpent("total")` is the chain's accumulated cost, and the resolvers copy
  // it into a fact rather than pricing anything themselves.
  const budgetRunner = withBudget(withRetry(base, retry ?? DEFAULT_RETRY), {
    pricing: rates,
  });

  const orchestrator = createMultiAgentOrchestrator({
    runner: budgetRunner,
    agents: buildRegistry(preset),
    plugins,
  });

  return { orchestrator, budgetRunner };
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Every persona plus the synthesizer, as orchestrator agents.
 *
 * The preset's `meta.description` rides along on each registration so the
 * orchestrator's own inspection surface names the persona rather than the
 * agent ID.
 */
function buildRegistry(preset: PresetConfig): AgentRegistry {
  const registry: AgentRegistry = {};

  for (const persona of preset.personas) {
    registry[persona.name] = {
      agent: {
        name: persona.name,
        instructions: persona.systemPrompt,
        model: preset.model,
      },
      description: persona.meta?.description ?? persona.meta?.label,
    };
  }

  registry[preset.synthesizer.name] = {
    agent: {
      name: preset.synthesizer.name,
      instructions: preset.synthesizer.systemPrompt,
      model: preset.model,
    },
    description:
      preset.synthesizer.meta?.description ?? preset.synthesizer.meta?.label,
  };

  return registry;
}

// ============================================================================
// Adapter dispatch
// ============================================================================

/**
 * One runner over several adapter instances, keyed by token cap.
 *
 * The dispatcher is what the retry policy and the ledger wrap, so every agent
 * shares both no matter which adapter answers. Adapters are built lazily and
 * memoized — a preset with one burst cap and one synthesis cap builds two, and
 * a run that never synthesizes builds one.
 */
function createAnthropicDispatcher(
  preset: PresetConfig,
  apiKey: string,
  baseURL: string | undefined,
): AgentRunner {
  const adapters = new Map<number, AgentRunner>();

  function adapterFor(maxTokens: number): AgentRunner {
    const existing = adapters.get(maxTokens);
    if (existing !== undefined) {
      return existing;
    }

    const created = createAnthropicRunner({
      apiKey,
      model: preset.model,
      maxTokens,
      ...(preset.temperature !== undefined
        ? { temperature: preset.temperature }
        : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
    });
    adapters.set(maxTokens, created);

    return created;
  }

  return (agent, input, runOptions) => {
    const maxTokens =
      agent.name === preset.synthesizer.name
        ? preset.synthesizer.maxTokens
        : preset.tokensPerBurst;

    return adapterFor(maxTokens)(agent, input, runOptions);
  };
}
