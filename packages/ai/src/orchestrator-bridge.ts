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

import type { Requirement } from "@directive-run/core";
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

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getAgentState(facts: any): AgentState {
  return getBridgeFact<AgentState>(facts, AGENT_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setAgentState(facts: any, state: AgentState): void {
  setBridgeFact(facts, AGENT_KEY, state);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getApprovalState(facts: any): ApprovalState {
  return getBridgeFact<ApprovalState>(facts, APPROVAL_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setApprovalState(facts: any, state: ApprovalState): void {
  setBridgeFact(facts, APPROVAL_KEY, state);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getConversation(facts: any): Message[] {
  return getBridgeFact<Message[]>(facts, CONVERSATION_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setConversation(facts: any, messages: Message[]): void {
  setBridgeFact(facts, CONVERSATION_KEY, messages);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getToolCalls(facts: any): ToolCall[] {
  return getBridgeFact<ToolCall[]>(facts, TOOL_CALLS_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setToolCalls(facts: any, toolCalls: ToolCall[]): void {
  setBridgeFact(facts, TOOL_CALLS_KEY, toolCalls);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getHealthState(facts: any): Record<string, AgentHealthState> {
  return getBridgeFact<Record<string, AgentHealthState>>(facts, HEALTH_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setHealthState(
  facts: any,
  state: Record<string, AgentHealthState>,
): void {
  setBridgeFact(facts, HEALTH_KEY, state);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getBreakpointState(facts: any): BreakpointState {
  return getBridgeFact<BreakpointState>(facts, BREAKPOINT_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setBreakpointState(facts: any, state: BreakpointState): void {
  setBridgeFact(facts, BREAKPOINT_KEY, state);
}

/** Get full orchestrator state from facts */
// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getOrchestratorState(facts: any): OrchestratorState {
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
// biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
export function convertOrchestratorConstraints<
  F extends Record<string, unknown>,
>(constraints: Record<string, OrchestratorConstraint<F>>): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: Result type is complex
  const result: Record<string, any> = Object.create(null);

  for (const [id, constraint] of Object.entries(constraints)) {
    result[id] = {
      priority: constraint.priority ?? 0,
      // biome-ignore lint/suspicious/noExplicitAny: Facts type varies
      when: (facts: any) => {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F &
          OrchestratorState;

        return constraint.when(combinedFacts);
      },
      // biome-ignore lint/suspicious/noExplicitAny: Facts type varies
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
// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
export function convertOrchestratorResolvers<F extends Record<string, unknown>>(
  resolvers: Record<string, OrchestratorResolver<F, Requirement>>,
  runAgentWithGuardrails: <T>(
    agent: AgentLike,
    input: string,
    currentFacts: F & OrchestratorState,
    opts?: RunOptions,
  ) => Promise<RunResult<T>>,
  // biome-ignore lint/suspicious/noExplicitAny: Facts getter type varies
  getSystemFacts: () => any,
): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: Result type is complex
  const result: Record<string, any> = Object.create(null);

  for (const [id, resolver] of Object.entries(resolvers)) {
    result[id] = {
      requirement: resolver.requirement,
      key: resolver.key,
      // biome-ignore lint/suspicious/noExplicitAny: Context type varies
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
