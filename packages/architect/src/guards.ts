/**
 * Rate limiter, circuit breaker, cascade depth cap, and budget alerts.
 *
 * All guards are synchronous checks that return allow/deny decisions.
 * The pipeline calls these before making LLM calls or applying actions.
 */

import type {
  ArchitectBudget,
  ArchitectEvent,
  CircuitBreakerState,
  GuardConfig,
} from "./types.js";
import type { MetricsProvider } from "./metrics.js";
import type { GuardStateSnapshot } from "./persistence.js";

// ============================================================================
// Defaults
// ============================================================================

const DEFAULTS: Required<GuardConfig> = {
  debounceMs: 3000,
  maxCallsPerMinute: 6,
  circuitBreakerThreshold: 3,
  circuitBreakerWindowMs: 60_000,
  maxCascadeDepth: 3,
  maxExecutionTimeMs: 50,
  maxDefinitions: 50,
  maxPending: 10,
  maxPerHour: 20,
};

// ============================================================================
// Guard System
// ============================================================================

export interface GuardCheckResult {
  allowed: boolean;
  reason?: string;
}

export function createGuards(
  config: GuardConfig,
  budget: ArchitectBudget,
  emitEvent: (event: ArchitectEvent) => void,
  metrics?: MetricsProvider,
) {
  const cfg = { ...DEFAULTS, ...config };

  // ---- Rate limiter (sliding window) ----
  const callTimestamps: number[] = [];
  const hourlyTimestamps: number[] = [];

  // ---- Circuit breaker ----
  let cbState: CircuitBreakerState = "closed";
  const failureTimestamps: number[] = [];
  let halfOpenAttempted = false;
  // E14: track half-open timer for cleanup
  let halfOpenTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- Cascade depth ----
  let currentCascadeDepth = 0;

  // ---- Debounce ----
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---- Budget tracking ----
  let tokensUsed = 0;
  let dollarsUsed = 0;
  const alertedThresholds = new Set<number>();

  // ---- Definition count ----
  let activeDefinitionCount = 0;
  let pendingCount = 0;

  function checkRateLimit(): GuardCheckResult {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;

    // Clean old entries
    while (callTimestamps.length > 0 && callTimestamps[0]! < oneMinuteAgo) {
      callTimestamps.shift();
    }

    while (hourlyTimestamps.length > 0 && hourlyTimestamps[0]! < oneHourAgo) {
      hourlyTimestamps.shift();
    }

    if (callTimestamps.length >= cfg.maxCallsPerMinute) {
      // Item 15: include current values + recovery guidance
      const oldestCall = callTimestamps[0]!;
      const waitMs = Math.max(0, 60_000 - (now - oldestCall));
      const waitSec = Math.ceil(waitMs / 1000);

      return { allowed: false, reason: `Rate limit: ${callTimestamps.length}/${cfg.maxCallsPerMinute} calls/minute. Wait ~${waitSec}s or increase maxCallsPerMinute.` };
    }

    if (hourlyTimestamps.length >= cfg.maxPerHour) {
      const oldestHourly = hourlyTimestamps[0]!;
      const waitMs = Math.max(0, 3_600_000 - (now - oldestHourly));
      const waitMin = Math.ceil(waitMs / 60_000);

      return { allowed: false, reason: `Rate limit: ${hourlyTimestamps.length}/${cfg.maxPerHour} actions/hour. Wait ~${waitMin}m or increase maxPerHour.` };
    }

    return { allowed: true };
  }

  function recordCall(): void {
    const now = Date.now();
    callTimestamps.push(now);
    hourlyTimestamps.push(now);
  }

  function checkCircuitBreaker(): GuardCheckResult {
    if (cbState === "open") {
      return { allowed: false, reason: "Circuit breaker is open — too many recent failures" };
    }

    if (cbState === "half-open" && halfOpenAttempted) {
      return { allowed: false, reason: "Circuit breaker is half-open — waiting for probe result" };
    }

    return { allowed: true };
  }

  function recordFailure(): void {
    const now = Date.now();
    failureTimestamps.push(now);

    // Clean old failures outside window
    const windowStart = now - cfg.circuitBreakerWindowMs;
    while (failureTimestamps.length > 0 && failureTimestamps[0]! < windowStart) {
      failureTimestamps.shift();
    }

    if (failureTimestamps.length >= cfg.circuitBreakerThreshold) {
      cbState = "open";

      // E14: clear previous timer, track new one for cleanup
      if (halfOpenTimer) {
        clearTimeout(halfOpenTimer);
      }

      halfOpenTimer = setTimeout(() => {
        cbState = "half-open";
        halfOpenAttempted = false;
        halfOpenTimer = undefined;
      }, cfg.circuitBreakerWindowMs);
    }
  }

  function recordSuccess(): void {
    if (cbState === "half-open") {
      cbState = "closed";
      failureTimestamps.length = 0;
      halfOpenAttempted = false;
    }
  }

  function markHalfOpenAttempted(): void {
    if (cbState === "half-open") {
      halfOpenAttempted = true;
    }
  }

  function checkCascadeDepth(): GuardCheckResult {
    if (currentCascadeDepth >= cfg.maxCascadeDepth) {
      return {
        allowed: false,
        reason: `Cascade depth limit (${cfg.maxCascadeDepth}) reached`,
      };
    }

    return { allowed: true };
  }

  function incrementCascade(): void {
    currentCascadeDepth++;
  }

  function resetCascade(): void {
    currentCascadeDepth = 0;
  }

  function checkDefinitionCount(): GuardCheckResult {
    if (activeDefinitionCount >= cfg.maxDefinitions) {
      return {
        allowed: false,
        reason: `Definition limit: ${activeDefinitionCount}/${cfg.maxDefinitions} definitions active. Remove unused definitions or increase maxDefinitions.`,
      };
    }

    return { allowed: true };
  }

  function checkPendingCount(): GuardCheckResult {
    if (pendingCount >= cfg.maxPending) {
      return {
        allowed: false,
        reason: `Pending action limit: ${pendingCount}/${cfg.maxPending} pending. Approve or reject pending actions first.`,
      };
    }

    return { allowed: true };
  }

  function setDefinitionCount(count: number): void {
    activeDefinitionCount = count;
  }

  function setPendingCount(count: number): void {
    pendingCount = count;
  }

  function checkBudget(): GuardCheckResult {
    if (tokensUsed >= budget.tokens) {
      return { allowed: false, reason: `Token budget: ${tokensUsed}/${budget.tokens} used. Call resetBudget() or increase budget.tokens.` };
    }

    if (dollarsUsed >= budget.dollars) {
      return { allowed: false, reason: `Dollar budget: $${dollarsUsed.toFixed(2)}/$${budget.dollars.toFixed(2)} used. Call resetBudget() or increase budget.dollars.` };
    }

    return { allowed: true };
  }

  function recordTokens(tokens: number, dollars: number): void {
    tokensUsed += tokens;
    dollarsUsed += dollars;
    metrics?.gauge("architect.budget.tokens_used", tokensUsed);
    metrics?.gauge("architect.budget.dollars_used", dollarsUsed);

    // Check alert thresholds
    for (const threshold of [50, 80, 95]) {
      const tokenPercent = (tokensUsed / budget.tokens) * 100;
      const dollarPercent = (dollarsUsed / budget.dollars) * 100;

      if (
        (tokenPercent >= threshold || dollarPercent >= threshold) &&
        !alertedThresholds.has(threshold)
      ) {
        alertedThresholds.add(threshold);

        if (tokenPercent >= 100 || dollarPercent >= 100) {
          emitEvent({
            type: "budget-exceeded",
            timestamp: Date.now(),
            budgetUsed: { tokens: tokensUsed, dollars: dollarsUsed },
            budgetPercent: Math.max(tokenPercent, dollarPercent),
          });
        } else {
          emitEvent({
            type: "budget-warning",
            timestamp: Date.now(),
            budgetUsed: { tokens: tokensUsed, dollars: dollarsUsed },
            budgetPercent: threshold,
          });
        }
      }
    }
  }

  function resetBudget(): void {
    tokensUsed = 0;
    dollarsUsed = 0;
    alertedThresholds.clear();
  }

  function getBudgetUsage() {
    return {
      tokens: tokensUsed,
      dollars: dollarsUsed,
      percent: {
        tokens: budget.tokens > 0 ? (tokensUsed / budget.tokens) * 100 : 0,
        dollars: budget.dollars > 0 ? (dollarsUsed / budget.dollars) * 100 : 0,
      },
    };
  }

  /** Run all pre-LLM-call checks. */
  function checkAll(): GuardCheckResult {
    const checks: Array<{ result: GuardCheckResult; type: string }> = [
      { result: checkRateLimit(), type: "rate_limit" },
      { result: checkCircuitBreaker(), type: "circuit_breaker" },
      { result: checkCascadeDepth(), type: "cascade_depth" },
      { result: checkBudget(), type: "budget" },
      { result: checkPendingCount(), type: "pending_count" },
    ];

    for (const check of checks) {
      if (!check.result.allowed) {
        metrics?.counter("architect.guard.blocked", 1, { guard_type: check.type });

        return check.result;
      }
    }

    return { allowed: true };
  }

  function debounce(
    triggerType: string,
    callback: () => void,
  ): void {
    const existing = debounceTimers.get(triggerType);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(triggerType);
      callback();
    }, cfg.debounceMs);

    debounceTimers.set(triggerType, timer);
  }

  function getCircuitBreakerState(): CircuitBreakerState {
    return cbState;
  }

  function destroy(): void {
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }

    debounceTimers.clear();

    // E14: clear half-open timer
    if (halfOpenTimer) {
      clearTimeout(halfOpenTimer);
      halfOpenTimer = undefined;
    }
  }

  /** Export guard state for checkpoint persistence. */
  function exportState(): GuardStateSnapshot {
    return {
      tokensUsed,
      dollarsUsed,
      alertedThresholds: [...alertedThresholds],
      circuitBreakerState: cbState,
      failureCount: failureTimestamps.length,
    };
  }

  /** Import guard state from a checkpoint. */
  function importState(snapshot: GuardStateSnapshot): void {
    tokensUsed = snapshot.tokensUsed;
    dollarsUsed = snapshot.dollarsUsed;
    alertedThresholds.clear();
    for (const t of snapshot.alertedThresholds) {
      alertedThresholds.add(t);
    }

    cbState = snapshot.circuitBreakerState;
    failureTimestamps.length = 0;
    for (let i = 0; i < snapshot.failureCount; i++) {
      failureTimestamps.push(Date.now());
    }
  }

  return {
    checkAll,
    checkRateLimit,
    checkCircuitBreaker,
    checkCascadeDepth,
    checkDefinitionCount,
    checkPendingCount,
    checkBudget,
    recordCall,
    recordFailure,
    recordSuccess,
    recordTokens,
    resetBudget,
    getBudgetUsage,
    markHalfOpenAttempted,
    incrementCascade,
    resetCascade,
    setDefinitionCount,
    setPendingCount,
    debounce,
    getCircuitBreakerState,
    exportState,
    importState,
    destroy,
  };
}

export type Guards = ReturnType<typeof createGuards>;
