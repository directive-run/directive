/**
 * Architect Policies — meta-constraints on the architect itself.
 *
 * Item 33: The architect governed by the same paradigm it manages.
 * Policies are evaluated before every action is applied.
 */

import type {
  ArchitectPolicy,
  PolicyContext,
} from "./types.js";

// ============================================================================
// Policy Evaluation
// ============================================================================

export interface PolicyViolation {
  /** The policy that was violated. */
  policy: ArchitectPolicy;
  /** What the policy says to do. */
  action: "block" | "warn" | "require-approval";
}

/**
 * Evaluate all policies against the current context.
 *
 * @param policies - Array of ArchitectPolicy rules to check.
 * @param context - Current action and system state context.
 * @returns Array of violations (empty if all policies pass).
 */
export function evaluatePolicies(
  policies: ArchitectPolicy[],
  context: PolicyContext,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    try {
      if (policy.when(context)) {
        violations.push({ policy, action: policy.action });
      }
    } catch {
      // Policy evaluation errors are swallowed — a failing policy should not crash the pipeline
    }
  }

  return violations;
}

/**
 * Check if any violations block the action.
 *
 * @param violations - Array of policy violations to check.
 * @returns The first blocking violation, or null if no blocks.
 */
export function getBlockingViolation(violations: PolicyViolation[]): PolicyViolation | null {
  return violations.find((v) => v.action === "block") ?? null;
}

/**
 * Check if any violations require approval override.
 *
 * @param violations - Array of policy violations to check.
 * @returns True if any violation has action `"require-approval"`.
 */
export function requiresApprovalOverride(violations: PolicyViolation[]): boolean {
  return violations.some((v) => v.action === "require-approval");
}

// ============================================================================
// Built-in Policy Helpers
// ============================================================================

/**
 * Block creation of more than `n` constraints per hour.
 *
 * @param n - Maximum constraints allowed per hour.
 * @returns An ArchitectPolicy that blocks when the limit is exceeded.
 */
export function maxConstraintsPerHour(n: number): ArchitectPolicy {
  return {
    id: `max-constraints-per-hour-${n}`,
    description: `Block if more than ${n} constraints created this hour`,
    when: (ctx: PolicyContext) => {
      if (ctx.currentAction.tool !== "create_constraint") {
        return false;
      }

      return ctx.constraintsCreated >= n;
    },
    action: "block",
  };
}

/**
 * Protect specific fact keys from modification.
 * Patterns support simple glob-style `*` at the end (e.g., `"auth.*"` matches `"auth.token"`, `"auth.user"`).
 *
 * @param patterns - Fact key patterns to protect (supports trailing `*` glob).
 * @returns An ArchitectPolicy that requires approval for matching modifications.
 */
export function protectFactKeys(patterns: string[]): ArchitectPolicy {
  return {
    id: `protect-fact-keys`,
    description: `Require approval when modifying fact keys matching: ${patterns.join(", ")}`,
    when: (ctx: PolicyContext) => {
      if (ctx.factKeysModified.length === 0) {
        return false;
      }

      return ctx.factKeysModified.some((key) =>
        patterns.some((pattern) => matchPattern(pattern, key)),
      );
    },
    action: "require-approval",
  };
}

/**
 * Require approval for actions above a given risk level.
 *
 * @param level - Risk threshold (`"low"`, `"medium"`, or `"high"`).
 * @returns An ArchitectPolicy that requires approval for higher-risk actions.
 */
export function requireApprovalAboveRisk(
  level: "low" | "medium" | "high",
): ArchitectPolicy {
  const riskOrder = { low: 0, medium: 1, high: 2 };
  const threshold = riskOrder[level];

  return {
    id: `require-approval-above-risk-${level}`,
    description: `Require approval for actions with risk > ${level}`,
    when: (ctx: PolicyContext) => {
      const actionRisk = riskOrder[ctx.currentAction.risk] ?? 0;

      return actionRisk > threshold;
    },
    action: "require-approval",
  };
}

// ============================================================================
// Helpers
// ============================================================================

function matchPattern(pattern: string, key: string): boolean {
  if (pattern === key) {
    return true;
  }

  // Simple glob: "auth.*" matches "auth.token"
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);

    return key.startsWith(prefix);
  }

  return false;
}
