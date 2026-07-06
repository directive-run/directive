/**
 * Shared bridge accessors and constraint/resolver converters.
 *
 * Used by both `agent-orchestrator.ts` (single-agent) and `multi-agent-orchestrator.ts` (multi-agent)
 * to read/write the bridge schema facts (agent state, approval, conversation,
 * tool calls) and convert user-facing OrchestratorConstraint/OrchestratorResolver
 * types into the Directive core format.
 *
 * Extracted to prevent drift between the two orchestrator implementations.
 * Internal module — not a public subpath export.
 *
 * @module
 */

import type { Facts, Requirement, Schema } from "@directive-run/core";
import {
  getBridgeFact,
  setBridgeFact,
} from "@directive-run/core/adapter-utils";

import type {
  AgentHealthState,
  AgentLike,
  AgentState,
  ApprovalState,
  BreakpointState,
  Message,
  OrchestratorConstraint,
  OrchestratorResolver,
  OrchestratorResolverContext,
  OrchestratorState,
  RunOptions,
  RunResult,
  ToolCall,
} from "./types.js";

import {
  AGENT_KEY,
  APPROVAL_KEY,
  BREAKPOINT_KEY,
  CONVERSATION_KEY,
  HEALTH_KEY,
  TOOL_CALLS_KEY,
} from "./types.js";

// ============================================================================
// Bridge Accessors
// ============================================================================

/** @internal Read the agent state from bridge facts. */
export function getAgentState(facts: Facts<Schema>): AgentState {
  return getBridgeFact<AgentState>(facts, AGENT_KEY);
}

/** @internal Write the agent state to bridge facts. */
export function setAgentState(facts: Facts<Schema>, state: AgentState): void {
  setBridgeFact(facts, AGENT_KEY, state);
}

/** @internal Read the approval state from bridge facts. */
export function getApprovalState(facts: Facts<Schema>): ApprovalState {
  return getBridgeFact<ApprovalState>(facts, APPROVAL_KEY);
}

/** @internal Write the approval state to bridge facts. */
export function setApprovalState(
  facts: Facts<Schema>,
  state: ApprovalState,
): void {
  setBridgeFact(facts, APPROVAL_KEY, state);
}

/** @internal Read the conversation messages from bridge facts. */
export function getConversation(facts: Facts<Schema>): Message[] {
  return getBridgeFact<Message[]>(facts, CONVERSATION_KEY);
}

/** @internal Write conversation messages to bridge facts. */
export function setConversation(
  facts: Facts<Schema>,
  messages: Message[],
): void {
  setBridgeFact(facts, CONVERSATION_KEY, messages);
}

/** @internal Read the tool calls from bridge facts. */
export function getToolCalls(facts: Facts<Schema>): ToolCall[] {
  return getBridgeFact<ToolCall[]>(facts, TOOL_CALLS_KEY);
}

/** @internal Write tool calls to bridge facts. */
export function setToolCalls(
  facts: Facts<Schema>,
  toolCalls: ToolCall[],
): void {
  setBridgeFact(facts, TOOL_CALLS_KEY, toolCalls);
}

/** @internal Read the health state map from bridge facts. */
export function getHealthState(
  facts: Facts<Schema>,
): Record<string, AgentHealthState> {
  return getBridgeFact<Record<string, AgentHealthState>>(facts, HEALTH_KEY);
}

/** @internal Write the health state map to bridge facts. */
export function setHealthState(
  facts: Facts<Schema>,
  state: Record<string, AgentHealthState>,
): void {
  setBridgeFact(facts, HEALTH_KEY, state);
}

/** @internal Read the breakpoint state from bridge facts. */
export function getBreakpointState(facts: Facts<Schema>): BreakpointState {
  return getBridgeFact<BreakpointState>(facts, BREAKPOINT_KEY);
}

/** @internal Write the breakpoint state to bridge facts. */
export function setBreakpointState(
  facts: Facts<Schema>,
  state: BreakpointState,
): void {
  setBridgeFact(facts, BREAKPOINT_KEY, state);
}

/** Get full orchestrator state from facts */
export function getOrchestratorState(facts: Facts<Schema>): OrchestratorState {
  return {
    agent: getAgentState(facts),
    approval: getApprovalState(facts),
    conversation: getConversation(facts),
    toolCalls: getToolCalls(facts),
  };
}

// ============================================================================
// Constraint/Resolver Converters
// ============================================================================

/** Convert user-facing OrchestratorConstraint objects into Directive core constraint format */
export function convertOrchestratorConstraints<
  F extends Record<string, unknown>,
>(constraints: Record<string, OrchestratorConstraint<F>>): Record<string, any> {
  const result: Record<string, any> = Object.create(null);

  for (const [id, constraint] of Object.entries(constraints)) {
    result[id] = {
      priority: constraint.priority ?? 0,
      when: (facts: any) => {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F &
          OrchestratorState;

        return constraint.when(combinedFacts);
      },
      require: (facts: any) => {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F &
          OrchestratorState;

        return typeof constraint.require === "function"
          ? constraint.require(combinedFacts)
          : constraint.require;
      },
    };
  }

  return result;
}

/** Convert user-facing OrchestratorResolver objects into Directive core resolver format */
export function convertOrchestratorResolvers<F extends Record<string, unknown>>(
  resolvers: Record<string, OrchestratorResolver<F, Requirement>>,
  runAgentWithGuardrails: <T>(
    agent: AgentLike,
    input: string,
    currentFacts: F & OrchestratorState,
    opts?: RunOptions,
  ) => Promise<RunResult<T>>,
  getSystemFacts: () => any,
): Record<string, any> {
  const result: Record<string, any> = Object.create(null);

  for (const [id, resolver] of Object.entries(resolvers)) {
    result[id] = {
      requirement: resolver.requirement,
      key: resolver.key,
      resolve: async (req: Requirement, context: any) => {
        const state = getOrchestratorState(context.facts);
        const combinedFacts = { ...context.facts, ...state } as unknown as F &
          OrchestratorState;

        const orchestratorContext: OrchestratorResolverContext<F> = {
          facts: combinedFacts,
          runAgent: async <T>(
            agent: AgentLike,
            input: string,
            opts?: RunOptions,
          ) => {
            return runAgentWithGuardrails<T>(
              agent,
              input,
              getOrchestratorState(getSystemFacts()) as unknown as F &
                OrchestratorState,
              opts,
            );
          },
          signal: context.signal,
        };
        await resolver.resolve(req, orchestratorContext);
      },
    };
  }

  return result;
}
