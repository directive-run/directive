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
 * A turn and the closing document have different token caps, and the Anthropic
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
 * ## The rates are part of the interface
 *
 * They are returned rather than kept private, because the chain has to cost a
 * call it has not made yet: what the closing document will run to, and whether
 * a budget is large enough to produce one at all. Doing that from a second copy
 * of the rate table would put the reserve and the bill on different numbers.
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
import { QUOTED_MATERIAL_NOTICE } from "./safety.js";

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
  /**
   * The rates the ledger prices at.
   *
   * Handed to the module so the chain can cost a call it has not made yet.
   * Reserving for the closing document is arithmetic, not a guess — the
   * synthesizer's `maxTokens` is a hard ceiling on its output and the transcript
   * is a measured length — but only if the same rates that will bill it are the
   * ones doing the reserving.
   */
  pricing: TokenPricing;
}

/** Characters per token, matching `withBudget`'s own default. */
export const CHARS_PER_TOKEN = 4;

/**
 * The rates a preset's calls will be priced at.
 *
 * One resolution path, so a caller deciding whether a budget is big enough and
 * the ledger deciding what a call cost cannot be working from different numbers.
 */
export function resolvePresetPricing(
  preset: PresetConfig,
  override?: TokenPricing,
): TokenPricing {
  return override ?? requireModelPricing(ANTHROPIC_PRICING, preset.model);
}

/**
 * The least a chain can cost and still produce a closing document.
 *
 * The synthesizer's output cap, at the output rate, and nothing else — no
 * turns, no transcript, no input. A budget below this cannot pay for the one
 * thing every run is supposed to end with, so the chain would spend whatever it
 * had on turns and then stop with nothing to show for them.
 *
 * A floor rather than an estimate: `maxTokens` is enforced by the provider, so
 * no synthesis can come in under it by more than the model chose to write.
 */
export function minimumBudgetUsd(
  preset: PresetConfig,
  pricing: TokenPricing,
): number {
  return (preset.synthesizer.maxTokens / 1_000_000) * pricing.outputPerMillion;
}

/**
 * Refuse a budget that cannot pay for the closing document.
 *
 * Refused at construction rather than discovered four turns in. A budget that
 * cannot cover the closing document buys turns nobody will ever read a summary
 * of: the chain spends what it has, reaches synthesis, finds it unaffordable,
 * and stops with a transcript and no conclusion. That is a correct outcome of
 * the rules and a useless outcome for the operator, and it is knowable before a
 * single call — the synthesizer's `maxTokens` and the model's output rate are
 * both in hand.
 */
export function assertBudgetCoversSynthesis(
  preset: PresetConfig,
  pricing: TokenPricing,
): void {
  const floor = minimumBudgetUsd(preset, pricing);

  if (preset.budgetUsd < floor) {
    throw new Error(
      `[ai-harness] budgetUsd of $${preset.budgetUsd.toFixed(4)} cannot pay for this preset's closing document, which prices at $${floor.toFixed(4)} (${preset.synthesizer.maxTokens} output tokens at $${pricing.outputPerMillion}/M). The chain would spend the budget on turns and then have nothing left to summarise them with. Raise the budget above $${floor.toFixed(4)}, or lower \`synthesizer.maxTokens\`.`,
    );
  }
}

/**
 * The least a chain is *worth* starting on.
 *
 * {@link minimumBudgetUsd} plus one turn's output. A budget between the two
 * produces a run that is legal and pointless: the chain affords a turn or two,
 * the transcript grows, the reserve grows with it, and the closing document goes
 * from affordable to not while the turns that were supposed to feed it sit
 * there unsummarised.
 *
 * Used where declining is an option — a composition can simply not start the
 * step. `createHarnessSystem` holds to the narrower floor, because a caller who
 * asked for one chain at one budget should get the run rather than a refusal
 * over a judgement call.
 */
export function minimumStepBudgetUsd(
  preset: PresetConfig,
  pricing: TokenPricing,
): number {
  return (
    minimumBudgetUsd(preset, pricing) +
    (preset.tokensPerTurn / 1_000_000) * pricing.outputPerMillion
  );
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
  const rates = resolvePresetPricing(preset, pricing);

  // A ledger, and a floor under it.
  //
  // The floor is not a second copy of the chain's ceiling. `canAffordTurn`
  // decides whether to *start* another turn, from what the chain has spent and
  // what it still owes the closing document; it is predictive, and prediction is
  // the part that can be wrong. `maxTotalCost` decides nothing — it refuses to
  // dispatch once the ledger has already reached `budgetUsd`. One stops the
  // chain cleanly and reports `"budget"`; the other catches the case where the
  // first one's arithmetic was off, and bounds the damage to a single call.
  //
  // An earlier version of this file left the cap off, reasoning that two
  // ceilings at the same number disagree at the boundary. That reasoning was
  // about a *per-call* cap, which really is a duplicate: it gates a prediction
  // about one call against a number the chain is already gating a prediction
  // about the whole run against, so whichever is more pessimistic fires and the
  // run is reported twice, two different ways. A lifetime floor is layered
  // rather than duplicated. It cannot fire before the derivation does, because
  // the derivation stops while money is left and the floor only speaks when
  // there is none — and when it does fire the chain records it as a budget stop
  // (see the `budgetHalted` fact), so the two agree about what happened.
  const budgetRunner = withBudget(withRetry(base, retry ?? DEFAULT_RETRY), {
    pricing: rates,
    maxTotalCost: preset.budgetUsd,
  });

  const orchestrator = createMultiAgentOrchestrator({
    runner: budgetRunner,
    agents: buildRegistry(preset),
    plugins,
  });

  return { orchestrator, budgetRunner, pricing: rates };
}

// ============================================================================
// Registry
// ============================================================================

/**
 * A preset's system prompt, plus the one thing the harness always says.
 *
 * The notice is appended here rather than written into each preset, for two
 * reasons. A preset loaded off disk has never heard of it and gets it anyway,
 * which is the case that matters — that is the surface an untrusted preset
 * arrives through. And the presets that already scope themselves carefully do
 * not have to be rewritten to be covered: their scoping is prompt-level, so it
 * inherits whatever weakness the prompt has, and this is what closes the gap
 * between "the persona was told to stay defensive" and "the artefact it is
 * reading cannot talk it out of that".
 *
 * Appended rather than prepended, so a preset's own framing is what the model
 * reads first and the harness's rule is the last word.
 *
 * Exported because it is not free. The notice is sent on every call, so the
 * chain has to be able to cost it — the synthesis reserve measures the prompt
 * it is about to send, and measuring the preset's system prompt rather than the
 * one that actually goes out would under-reserve by the length of this text on
 * a budget the chain spends down to the last cent.
 */
export function harnessSystemPrompt(systemPrompt: string): string {
  return `${systemPrompt}\n\n${QUOTED_MATERIAL_NOTICE}`;
}

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
        instructions: harnessSystemPrompt(persona.systemPrompt),
        model: preset.model,
      },
      description: persona.meta?.description ?? persona.meta?.label,
    };
  }

  registry[preset.synthesizer.name] = {
    agent: {
      name: preset.synthesizer.name,
      instructions: harnessSystemPrompt(preset.synthesizer.systemPrompt),
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
 * memoized — a preset with one turn cap and one synthesis cap builds two, and
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
        : preset.tokensPerTurn;

    return adapterFor(maxTokens)(agent, input, runOptions);
  };
}
