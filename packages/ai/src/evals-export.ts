/**
 * Evaluation framework subpath export.
 *
 * Tree-shakable entry for the eval harness: cost, latency, length, safety,
 * structure, match, judge, faithfulness, relevance, coherence, assertion checks.
 *
 * @example
 * ```typescript
 * import { createEvalSuite, evalCost, evalJudge } from "@directive-run/ai/evals";
 * ```
 */

export {
  createEvalSuite,
  evalCost,
  evalLatency,
  evalOutputLength,
  evalSafety,
  evalStructure,
  evalMatch,
  evalJudge,
  evalFaithfulness,
  evalRelevance,
  evalCoherence,
  evalAssert,
  type EvalCase,
  type EvalScore,
  type EvalContext,
  type EvalCriterionFn,
  type EvalCriterion,
  type EvalCaseResult,
  type EvalAgentSummary,
  type EvalResults,
  type EvalSuiteConfig,
  type EvalSuite,
  type EvalCostOptions,
  type EvalLatencyOptions,
  type EvalOutputLengthOptions,
  type EvalSafetyOptions,
  type EvalStructureOptions,
  type EvalJudgeOptions,
  type EvalMatchOptions,
  type EvalSemanticOptions,
  type EvalAssertOptions,
} from "./evals.js";
