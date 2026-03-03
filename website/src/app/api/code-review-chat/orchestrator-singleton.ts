/**
 * Code Review Board orchestrator singleton — supervisor pattern with 2 agents + 3 tasks.
 *
 * Persisted on globalThis to survive HMR re-evaluations.
 *
 * Supervisor delegates to:
 * - security-reviewer (agent)   — LLM analyzes code for security vulnerabilities
 * - style-reviewer (agent)      — LLM evaluates code style and readability
 * - lint-check (task)            — deterministic static analysis with progress reporting
 * - dependency-audit (task)      — simulated dep scanning with retry + timeout
 * - merge-decision (task)        — reads all node states, computes aggregate score
 *
 * Features wired for DevTools observability:
 * - 3 input guardrails + 1 output guardrail        → Guardrails tab
 * - Sliding-window memory (20 messages)              → Memory tab
 * - Circuit breaker                                  → Health tab
 * - 3 cross-agent derivations                        → State tab
 * - Scratchpad (4 keys)                              → State tab
 * - Audit trail                                      → Events tab
 * - Task lifecycle hooks (start/complete/error)      → Timeline tab
 */
import {
  type CheckpointStore,
  type CrossAgentSnapshot,
  InMemoryCheckpointStore,
  type InputGuardrailData,
  type MultiAgentOrchestrator,
  type NamedGuardrail,
  type OutputGuardrailData,
  type TaskRegistration,
  createAgentAuditHandlers,
  createAgentMemory,
  createAuditTrail,
  createLengthGuardrail,
  createMultiAgentOrchestrator,
  createPromptInjectionGuardrail,
  createSlidingWindowStrategy,
  supervisor,
  withBudget,
  withRetry,
} from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createCircuitBreaker } from "@directive-run/core/plugins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeReviewInstance {
  orchestrator: MultiAgentOrchestrator;
  memory: ReturnType<typeof createAgentMemory>;
  audit: ReturnType<typeof createAuditTrail>;
  inputGuardrails: NamedGuardrail<InputGuardrailData>[];
  checkpointStore: CheckpointStore;
}

// ---------------------------------------------------------------------------
// Singleton on globalThis (survives HMR)
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__directive_code_review_orchestrator" as const;
const g = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: CodeReviewInstance;
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const lintCheckTask: TaskRegistration = {
  run: async (input, _signal, context) => {
    context.reportProgress(0, "Starting lint analysis");

    const code = input.toLowerCase();

    context.reportProgress(15, "Checking naming conventions");
    const namingIssues: string[] = [];
    if (/var\s/.test(code)) {
      namingIssues.push("Uses `var` instead of `const`/`let`");
    }
    if (/any\b/.test(code)) {
      namingIssues.push("Contains `any` type annotations");
    }

    context.reportProgress(30, "Checking code complexity");
    const lines = input.split("\n");
    const complexityIssues: string[] = [];
    const longLines = lines.filter((l) => l.length > 120);
    if (longLines.length > 0) {
      complexityIssues.push(`${longLines.length} lines exceed 120 characters`);
    }
    const nestedDepth = (input.match(/\{/g) || []).length;
    if (nestedDepth > 10) {
      complexityIssues.push(`High nesting depth (${nestedDepth} blocks)`);
    }

    context.reportProgress(50, "Checking error handling");
    const errorIssues: string[] = [];
    if (/catch\s*\(\s*\w*\s*\)\s*\{[\s\n]*\}/.test(input)) {
      errorIssues.push("Empty catch block — errors silently swallowed");
    }
    if (/console\.(log|error|warn)/.test(input)) {
      errorIssues.push("Contains console statements");
    }

    context.reportProgress(70, "Checking import patterns");
    const importIssues: string[] = [];
    if (/require\(/.test(input)) {
      importIssues.push("Uses CommonJS `require()` instead of ES imports");
    }

    context.reportProgress(85, "Computing lint score");
    const totalIssues =
      namingIssues.length +
      complexityIssues.length +
      errorIssues.length +
      importIssues.length;
    const score = Math.max(0, 100 - totalIssues * 15);

    context.reportProgress(100, "Lint analysis complete");

    return JSON.stringify({
      score,
      totalIssues,
      categories: {
        naming: namingIssues,
        complexity: complexityIssues,
        errorHandling: errorIssues,
        imports: importIssues,
      },
    });
  },
  label: "Lint Check",
  description:
    "Deterministic static analysis — naming, complexity, error handling, imports",
  maxConcurrent: 2,
};

const dependencyAuditTask: TaskRegistration = {
  run: async (input, _signal, context) => {
    context.reportProgress(10, "Scanning dependencies");

    // Read the current review topic from scratchpad
    const topic = context.scratchpad.topic as string | undefined;

    context.reportProgress(30, "Checking known vulnerabilities");

    // Simulated dependency analysis based on input content
    const code = input.toLowerCase();
    const findings: string[] = [];
    const riskFactors: string[] = [];

    if (/eval\(/.test(code)) {
      findings.push("Uses eval() — critical security risk");
      riskFactors.push("code-injection");
    }
    if (/innerHTML/.test(code)) {
      findings.push("Direct innerHTML assignment — XSS risk");
      riskFactors.push("xss");
    }
    if (/http:\/\//.test(code)) {
      findings.push("Hardcoded HTTP URL — insecure transport");
      riskFactors.push("insecure-transport");
    }

    context.reportProgress(60, "Checking license compliance");

    if (/lodash/.test(code)) {
      findings.push("Uses lodash — consider tree-shakeable alternative");
    }
    if (/moment/.test(code)) {
      findings.push("Uses moment.js — deprecated, use date-fns or Temporal");
    }

    context.reportProgress(80, "Computing risk score");
    const riskScore = Math.min(
      100,
      riskFactors.length * 30 + findings.length * 10,
    );

    context.reportProgress(100, "Dependency audit complete");

    return JSON.stringify({
      riskScore,
      findings,
      riskFactors,
      scannedTopic: topic ?? "unknown",
      totalFindings: findings.length,
    });
  },
  label: "Dependency Audit",
  description:
    "Scans for vulnerable patterns, insecure dependencies, license issues",
  retry: { attempts: 3, backoff: "exponential", delayMs: 500 },
  timeout: 15_000,
};

const mergeDecisionTask: TaskRegistration = {
  run: async (input, _signal, context) => {
    context.reportProgress(10, "Reading reviewer states");

    // Read all upstream agent/task states
    const securityState = context.readAgentState("security-reviewer");
    const styleState = context.readAgentState("style-reviewer");
    const lintState = context.readAgentState("lint-check");
    const depState = context.readAgentState("dependency-audit");

    context.reportProgress(30, "Parsing review results");

    // Parse lint score
    let lintScore = 50;
    try {
      const lintOutput = lintState?.lastOutput
        ? JSON.parse(lintState.lastOutput)
        : null;
      if (lintOutput?.score != null) {
        lintScore = lintOutput.score;
      }
    } catch {
      // Use default
    }

    // Parse dependency risk
    let depRiskScore = 0;
    try {
      const depOutput = depState?.lastOutput
        ? JSON.parse(depState.lastOutput)
        : null;
      if (depOutput?.riskScore != null) {
        depRiskScore = depOutput.riskScore;
      }
    } catch {
      // Use default
    }

    context.reportProgress(50, "Computing aggregate scores");

    // Score each dimension (0-100, higher = better)
    const securityScore = securityState?.status === "completed" ? 70 : 50;
    const styleScore = styleState?.status === "completed" ? 75 : 50;
    const depScore = Math.max(0, 100 - depRiskScore);

    // Weighted aggregate
    const aggregate = Math.round(
      securityScore * 0.3 +
        styleScore * 0.2 +
        lintScore * 0.25 +
        depScore * 0.25,
    );

    context.reportProgress(75, "Determining verdict");

    let verdict: string;
    let recommendation: string;
    if (aggregate >= 80) {
      verdict = "APPROVE";
      recommendation = "Code meets quality standards. Safe to merge.";
    } else if (aggregate >= 60) {
      verdict = "APPROVE_WITH_COMMENTS";
      recommendation = "Code is acceptable with minor improvements suggested.";
    } else if (aggregate >= 40) {
      verdict = "REQUEST_CHANGES";
      recommendation = "Significant issues found. Address before merging.";
    } else {
      verdict = "REJECT";
      recommendation = "Critical issues detected. Major rework needed.";
    }

    context.reportProgress(100, "Merge decision complete");

    // Read conversation memory for context
    const messageCount = context.memory.length;

    return JSON.stringify({
      verdict,
      aggregate,
      recommendation,
      scores: {
        security: securityScore,
        style: styleScore,
        lint: lintScore,
        dependencies: depScore,
      },
      reviewersCompleted: {
        security: securityState?.status === "completed",
        style: styleState?.status === "completed",
        lint: lintState?.status === "completed",
        dependencies: depState?.status === "completed",
      },
      conversationMessages: messageCount,
    });
  },
  label: "Merge Decision",
  description:
    "Aggregates all review scores and computes final approve/reject verdict",
};

// ---------------------------------------------------------------------------
// Input guardrails (exported for route to run manually)
// ---------------------------------------------------------------------------

const inputGuardrails: NamedGuardrail<InputGuardrailData>[] = [
  {
    name: "rate-limit",
    fn: (() => {
      const timestamps: number[] = [];
      let startIdx = 0;
      const MAX = 20;

      return () => {
        const now = Date.now();
        const windowStart = now - 60_000;
        while (
          startIdx < timestamps.length &&
          timestamps[startIdx]! < windowStart
        ) {
          startIdx++;
        }
        if (startIdx > timestamps.length / 2 && startIdx > 100) {
          timestamps.splice(0, startIdx);
          startIdx = 0;
        }
        const active = timestamps.length - startIdx;
        if (active >= MAX) {
          return { passed: false, reason: `Rate limit exceeded (${MAX}/min)` };
        }
        timestamps.push(now);

        return { passed: true };
      };
    })(),
  },
  { name: "prompt-injection", fn: createPromptInjectionGuardrail() },
  {
    name: "content-filter",
    fn: (data) => {
      const patterns = [
        /\bpassword\b/i,
        /\bsecret\s*key\b/i,
        /\bapi[_\s]*key\b/i,
      ];
      for (const p of patterns) {
        if (p.test(data.input)) {
          return {
            passed: false,
            reason: "Content filter: blocked sensitive keyword",
          };
        }
      }

      return { passed: true };
    },
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getCodeReviewOrchestrator(): CodeReviewInstance | null {
  if (g[GLOBAL_KEY]) {
    return g[GLOBAL_KEY];
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  let runner = createAnthropicRunner({
    apiKey,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 500,
  });

  runner = withRetry(runner, {
    maxRetries: 2,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
  });

  const haikuPricing = { inputPerMillion: 0.8, outputPerMillion: 4 };
  runner = withBudget(runner, {
    budgets: [{ window: "hour" as const, maxCost: 5.0, pricing: haikuPricing }],
  });

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  const memory = createAgentMemory({
    strategy: createSlidingWindowStrategy(),
    strategyConfig: { maxMessages: 20, preserveRecentCount: 4 },
    autoManage: true,
  });

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  const audit = createAuditTrail({
    maxEntries: 5000,
    sessionId: "code-review-demo",
  });
  const auditHandlers = createAgentAuditHandlers(audit);

  // ---------------------------------------------------------------------------
  // Checkpoint store
  // ---------------------------------------------------------------------------

  const checkpointStore = new InMemoryCheckpointStore({ maxCheckpoints: 50 });

  // ---------------------------------------------------------------------------
  // Circuit breaker
  // ---------------------------------------------------------------------------

  const cb = createCircuitBreaker({
    failureThreshold: 5,
    recoveryTimeMs: 30_000,
  });

  // ---------------------------------------------------------------------------
  // Output guardrails
  // ---------------------------------------------------------------------------

  const outputGuardrails: NamedGuardrail<OutputGuardrailData>[] = [
    {
      name: "output-length",
      fn: createLengthGuardrail({ maxCharacters: 3000 }),
    },
  ];

  // ---------------------------------------------------------------------------
  // Orchestrator
  // ---------------------------------------------------------------------------

  const orchestrator = createMultiAgentOrchestrator({
    runner,
    agents: {
      supervisor: {
        agent: {
          name: "supervisor",
          model: "claude-haiku-4-5-20251001",
          instructions: `You are a lead code reviewer managing a review board. You receive code or a code review request and must delegate analysis to your specialist team, then compile a final review report.

IMPORTANT: You MUST respond with ONLY a single raw JSON object on each turn. No other text, no explanation, no markdown, no XML, no function calls, no tool use — just the JSON object. Your entire response must be parseable by JSON.parse().

Available reviewers:
- security-reviewer: Analyzes code for security vulnerabilities (XSS, injection, auth issues)
- style-reviewer: Evaluates code style, readability, and best practices
- lint-check: Runs deterministic static analysis (naming, complexity, error handling)
- dependency-audit: Scans for vulnerable patterns and insecure dependencies
- merge-decision: Aggregates all scores into a final approve/reject verdict

To delegate to a reviewer, respond with ONLY this JSON (no other text):
{ "action": "delegate", "worker": "<reviewer-id>", "workerInput": "<what to review>" }

Delegate to each reviewer as needed, then delegate to merge-decision last to get the final verdict. When you've gathered all findings, respond with ONLY this JSON:
{ "action": "complete" }`,
        },
        capabilities: ["supervision", "code-review", "reporting"],
      },
      "security-reviewer": {
        agent: {
          name: "security-reviewer",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a security-focused code reviewer. Analyze code for vulnerabilities: XSS, injection attacks, insecure authentication, exposed secrets, unsafe deserialization, missing input validation, and OWASP Top 10 issues. Respond in 2-3 sentences with specific findings and severity ratings (Critical/High/Medium/Low).",
        },
        capabilities: ["security-analysis", "vulnerability-detection"],
      },
      "style-reviewer": {
        agent: {
          name: "style-reviewer",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a code style and readability reviewer. Evaluate naming conventions, function length, code organization, documentation quality, TypeScript best practices, and adherence to clean code principles. Respond in 2-3 sentences with specific observations and improvement suggestions.",
        },
        capabilities: ["style-analysis", "readability"],
      },
    },
    tasks: {
      "lint-check": lintCheckTask,
      "dependency-audit": dependencyAuditTask,
      "merge-decision": mergeDecisionTask,
    },
    patterns: {
      codeReview: supervisor<string>(
        "supervisor",
        [
          "security-reviewer",
          "style-reviewer",
          "lint-check",
          "dependency-audit",
          "merge-decision",
        ],
        {
          maxRounds: 8,
          extract: (supervisorOutput) => String(supervisorOutput),
        },
      ),
    },

    guardrails: {
      input: inputGuardrails,
      output: outputGuardrails,
    },

    memory,
    circuitBreaker: cb,
    checkpointStore,

    // Cross-agent derivations → State tab
    derive: {
      allComplete: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        if (agents.length === 0) {
          return false;
        }

        return agents.every((a) => a.status === "completed");
      },
      totalCost: (snap: CrossAgentSnapshot) => {
        const tokens = snap.coordinator.globalTokens;
        const inputTokens = tokens * 0.6;
        const outputTokens = tokens * 0.4;

        return (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
      },
      reviewProgress: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        const completed = agents.filter((a) => a.status === "completed").length;

        return `${completed}/${agents.length}`;
      },
    },

    // Scratchpad → State tab
    scratchpad: {
      init: {
        topic: "",
        reviewType: "general",
        lastError: null as string | null,
        requestCount: 0,
      },
    },

    // Lifecycle hooks
    hooks: {
      onAgentStart: ({ agentId }) => {
        auditHandlers.onAgentStart(agentId, "");
      },
      onAgentComplete: ({ agentId, tokenUsage }) => {
        auditHandlers.onAgentComplete(agentId, "", tokenUsage ?? 0, 0);
      },
      onAgentError: ({ agentId, error }) => {
        auditHandlers.onAgentError(
          agentId,
          error instanceof Error ? error : new Error(String(error)),
        );
      },
      onTaskStart: (event) => {
        audit.addEntry("agent.run.start", {
          taskId: event.taskId,
          label: event.label,
          patternId: event.patternId,
        });
      },
      onTaskComplete: (event) => {
        audit.addEntry("agent.run.complete", {
          taskId: event.taskId,
          label: event.label,
          patternId: event.patternId,
          durationMs: event.durationMs,
        });
      },
      onTaskError: (event) => {
        audit.addEntry("agent.run.error", {
          taskId: event.taskId,
          label: event.label,
          patternId: event.patternId,
          error: event.error.message,
        });
      },
      onPatternStart: () => {
        const orch = g[GLOBAL_KEY]?.orchestrator;
        if (orch?.scratchpad) {
          const count = (orch.scratchpad.get("requestCount") as number) ?? 0;

          orch.scratchpad.set("requestCount", count + 1);
        }
      },
    },

    // Budget
    maxTokenBudget: 50_000,
    budgetWarningThreshold: 0.8,

    // Plugins
    plugins: [audit.createPlugin()],

    // Debug — verbose timeline includes prompt/completion text
    debug: { verboseTimeline: true },
  });

  g[GLOBAL_KEY] = {
    orchestrator,
    memory,
    audit,
    inputGuardrails,
    checkpointStore,
  };

  return g[GLOBAL_KEY];
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getCodeReviewTimeline() {
  return g[GLOBAL_KEY]?.orchestrator.timeline ?? null;
}

export function getCodeReviewMemory() {
  return g[GLOBAL_KEY]?.memory ?? null;
}

export function getCodeReviewAudit() {
  return g[GLOBAL_KEY]?.audit ?? null;
}

export function getCodeReviewInputGuardrails() {
  return g[GLOBAL_KEY]?.inputGuardrails ?? [];
}

export function getCodeReviewCheckpointStore() {
  return g[GLOBAL_KEY]?.checkpointStore ?? null;
}
