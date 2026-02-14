---
title: "Declarative AI Guardrails: Why Your Agent Framework Needs a Constraint Layer"
description: Budget blowouts, PII leaks, and destructive API calls are real production failures. Learn how declarative constraints enforce safety rules that imperative checks miss.
layout: blog
date: 2026-02-03
dateModified: 2026-02-12
slug: declarative-ai-guardrails
author: directive-labs
categories: [AI, Architecture]
---

An agent spent $2,000 in a single night. It was a support agent with access to a search tool and an email tool, running in a loop. A malformed query triggered a retry cascade &ndash; each retry consumed tokens, generated a new search, and fired another email. By the time the on-call engineer noticed, the LLM bill had passed four figures and the support inbox had 400 duplicate messages.

A different team shipped an agent that helped users draft documents. It worked well in demos. In production, a user pasted a spreadsheet containing customer SSNs, phone numbers, and home addresses into the chat. The agent dutifully summarized the spreadsheet and forwarded the summary &ndash; PII included &ndash; to a third-party analytics tool.

A third team gave their agent access to a database management tool. The agent was supposed to run read-only queries. During a routine interaction, the model hallucinated a `DROP TABLE` statement, passed it to the tool, and the tool executed it. The staging database was gone. It could have been production.

These are not hypotheticals. They are the failure modes that separate demo agents from production agents. The fix isn't better prompts. It's a runtime that enforces safety rules whether or not your code remembers to check them.

---

## How frameworks handle safety today

Most agent frameworks treat safety as application code. You write checks in your handler functions, wire up middleware, and hope every path through your system hits the right validation at the right time.

Here's what that looks like in practice:

```typescript
async function handleAgentTurn(input: string, context: AgentContext) {
  // Check 1: PII filtering (did you remember this one?)
  if (detectPII(input)) {
    input = redactPII(input);
  }

  // Check 2: Budget enforcement (manual tracking)
  if (context.totalTokens > TOKEN_LIMIT) {
    return { error: 'Budget exceeded' };
  }

  const result = await llm.chat({
    messages: context.messages.concat({ role: 'user', content: input }),
    tools: context.tools,
  });

  // Check 3: Tool denylist (after the model already decided to call it)
  for (const call of result.toolCalls ?? []) {
    if (BLOCKED_TOOLS.includes(call.name)) {
      throw new Error(`Blocked tool: ${call.name}`);
    }
  }

  // Check 4: Output PII filtering (did you remember this one too?)
  if (detectPII(result.content)) {
    result.content = redactPII(result.content);
  }

  context.totalTokens += result.usage.total_tokens;

  return result;
}
```

Four safety checks, four different places in the function, four things a developer can forget when adding a new code path. And this is the *simple* version. Real applications have retry loops, streaming responses, multi-agent handoffs, and tool chains where each step needs its own validation.

The problems compound:

**Checks are opt-in.** Nothing forces a new endpoint or a new agent flow to include the same safety checks. A developer adds a "quick" agent route for an internal tool, skips the PII filter because "it's internal," and six months later that route is exposed to customers.

**Order matters but isn't enforced.** Budget checking before the LLM call prevents overspend. Budget checking after is just logging. The code doesn't distinguish between the two &ndash; both compile, both run, one works.

**No composition.** Each check is independent imperative code. There's no way to ask "what safety rules are active right now?" or "which guardrails did this request pass through?" The safety posture of your system is implicit, scattered across files, and invisible at runtime.

**No recovery.** When a check fails, you throw an error or return early. There's no structured way to pause, escalate, retry with different parameters, or route to a human reviewer. Each failure mode gets its own ad-hoc handling.

This is the same pattern from [constraint-driven architecture](/blog/constraint-driven-architecture) &ndash; imperative checks that work in isolation but break down as the system grows. The solution is the same too: stop writing checks and start declaring rules.

---

## Constraints as guardrails

A constraint is a declarative rule: when this condition is true, this requirement must be fulfilled. The runtime evaluates all constraints on every cycle. You don't call them. You don't order them. You don't remember to include them. They run because they exist.

This changes the nature of safety from "did I remember to add a check?" to "did I declare the rule?" Once declared, the rule is enforced everywhere, every time, without exception.

In [Building AI Agents with Directive](/blog/building-ai-agents), we showed how the orchestrator wraps guardrails around agent execution. This article goes deeper &ndash; building a complete safety layer from individual constraints that compose into a unified enforcement system.

---

## Budget enforcement

The $2,000 overnight bill happened because budget tracking was a variable that got checked sometimes. With Directive, the budget is a constraint. When it's violated, the runtime requires action.

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const agentSafety = createModule('agent-safety', {
  schema: {
    totalTokens: t.number(),
    tokenBudget: t.number(),
    totalCost: t.number(),
    costBudget: t.number(),
    agentStatus: t.string<'running' | 'paused' | 'stopped'>(),
    pauseReason: t.string().optional(),
  },

  init: (facts) => {
    facts.totalTokens = 0;
    facts.tokenBudget = 50_000;
    facts.totalCost = 0;
    facts.costBudget = 5.0;
    facts.agentStatus = 'running';
  },

  derive: {
    tokenUsagePercent: (facts) =>
      (facts.totalTokens / facts.tokenBudget) * 100,
    costUsagePercent: (facts) =>
      (facts.totalCost / facts.costBudget) * 100,
    isOverBudget: (facts) =>
      facts.totalTokens >= facts.tokenBudget ||
      facts.totalCost >= facts.costBudget,
  },

  constraints: {
    tokenBudgetExceeded: {
      priority: 100,
      when: (facts) => facts.totalTokens >= facts.tokenBudget,
      require: { type: 'PAUSE_AGENT', reason: 'Token budget exceeded' },
    },
    costBudgetExceeded: {
      priority: 100,
      when: (facts) => facts.totalCost >= facts.costBudget,
      require: { type: 'PAUSE_AGENT', reason: 'Cost budget exceeded' },
    },
    approachingLimit: {
      priority: 50,
      when: (facts) =>
        facts.totalTokens >= facts.tokenBudget * 0.8 &&
        facts.agentStatus === 'running',
      require: { type: 'WARN_BUDGET', percent: 80 },
    },
  },

  resolvers: {
    pauseAgent: {
      requirement: 'PAUSE_AGENT',
      resolve: async (req, ctx) => {
        ctx.facts.agentStatus = 'paused';
        ctx.facts.pauseReason = req.reason;
      },
    },
    warnBudget: {
      requirement: 'WARN_BUDGET',
      resolve: async (req, ctx) => {
        await notifyOpsChannel(
          `Agent at ${req.percent}% of token budget`
        );
      },
    },
  },
});
```

Three things are different from the imperative version. First, the 80% warning and the hard stop at 100% are both declared in the same place &ndash; you can see the full budget policy by reading the constraints. Second, priority values make the relationship explicit: `costBudgetExceeded` at priority 100 overrides the warning at priority 50. Third, the pause is a fact mutation, not a thrown error. The system moves to a known state (`agentStatus: 'paused'`) that other constraints can react to.

---

## PII detection

The PII leak happened because output filtering was a function call that one code path missed. As a constraint, PII detection runs on every cycle regardless of which code path produced the data.

```typescript
const piiGuardrail = createModule('pii-guardrail', {
  schema: {
    lastInput: t.string(),
    lastOutput: t.string(),
    piiDetectedIn: t.string<'none' | 'input' | 'output' | 'both'>(),
    redactionApplied: t.boolean(),
  },

  init: (facts) => {
    facts.lastInput = '';
    facts.lastOutput = '';
    facts.piiDetectedIn = 'none';
    facts.redactionApplied = false;
  },

  derive: {
    inputHasPII: (facts) => scanForPII(facts.lastInput).found,
    outputHasPII: (facts) => scanForPII(facts.lastOutput).found,
  },

  constraints: {
    inputPII: {
      priority: 90,
      when: (_facts, derive) => derive.inputHasPII,
      require: { type: 'REDACT_PII', target: 'input' },
    },
    outputPII: {
      priority: 90,
      when: (_facts, derive) => derive.outputHasPII,
      require: { type: 'REDACT_PII', target: 'output' },
    },
  },

  resolvers: {
    redactPII: {
      requirement: 'REDACT_PII',
      resolve: async (req, ctx) => {
        if (req.target === 'input') {
          ctx.facts.lastInput = scanForPII(ctx.facts.lastInput).redacted;
        } else {
          ctx.facts.lastOutput = scanForPII(ctx.facts.lastOutput).redacted;
        }
        ctx.facts.piiDetectedIn = req.target;
        ctx.facts.redactionApplied = true;
      },
    },
  },
});
```

The derivation `inputHasPII` is auto-tracked. When `lastInput` changes, the derivation recomputes. When it becomes `true`, the constraint fires. When the resolver runs, it mutates the fact, which triggers re-evaluation, and the constraint settles once PII is gone. The reconciliation loop does the work that imperative code does with careful sequencing.

---

## Tool access control

The `DROP TABLE` incident happened because the agent had access to a tool it should never have been able to call. Denylists in middleware work until someone adds a tool and forgets to update the list. A constraint inverts the model: declare what's blocked, and the runtime enforces it before execution.

```typescript
const toolGuardrail = createModule('tool-guardrail', {
  schema: {
    pendingToolCall: t.string().optional(),
    pendingToolArgs: t.string().optional(),
    toolCallBlocked: t.boolean(),
    blockReason: t.string().optional(),
  },

  init: (facts) => {
    facts.toolCallBlocked = false;
  },

  constraints: {
    blockDestructiveTools: {
      priority: 100,
      when: (facts) => {
        const tool = facts.pendingToolCall;
        if (!tool) {
          return false;
        }

        const blocked = ['shell', 'eval', 'filesystem_write', 'db_execute'];

        return blocked.includes(tool);
      },
      require: (facts) => ({
        type: 'BLOCK_TOOL_CALL',
        tool: facts.pendingToolCall!,
        reason: `Tool "${facts.pendingToolCall}" is on the denylist`,
      }),
    },
    blockSQLMutations: {
      priority: 100,
      when: (facts) => {
        if (facts.pendingToolCall !== 'db_query') {
          return false;
        }

        const args = facts.pendingToolArgs ?? '';

        return /\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT)\b/i.test(args);
      },
      require: (facts) => ({
        type: 'BLOCK_TOOL_CALL',
        tool: 'db_query',
        reason: 'Mutation detected in read-only query tool',
      }),
    },
  },

  resolvers: {
    blockTool: {
      requirement: 'BLOCK_TOOL_CALL',
      resolve: async (req, ctx) => {
        ctx.facts.toolCallBlocked = true;
        ctx.facts.blockReason = req.reason;
        ctx.facts.pendingToolCall = undefined;
        ctx.facts.pendingToolArgs = undefined;
        await logSecurityEvent('tool_blocked', {
          tool: req.tool,
          reason: req.reason,
        });
      },
    },
  },
});
```

Notice `blockSQLMutations`. This isn't just a name-based denylist &ndash; it inspects the arguments. The constraint checks whether a "read-only" tool is being asked to run a mutation. This kind of content-aware filtering is natural in a constraint because the `when` function has access to all facts. In middleware, you'd need to parse the tool call payload in a separate layer and somehow thread the result back to the blocking decision.

---

## Human-in-the-loop approval

Some actions shouldn't be blocked outright &ndash; they should be held for human review. A constraint can require approval, and the resolver can pause execution until a human responds.

```typescript
const approvalGuardrail = createModule('approval-guardrail', {
  schema: {
    pendingAction: t.string().optional(),
    pendingPayload: t.string().optional(),
    approvalStatus: t.string<'none' | 'pending' | 'approved' | 'rejected'>(),
    approvalId: t.string().optional(),
    agentPaused: t.boolean(),
  },

  init: (facts) => {
    facts.approvalStatus = 'none';
    facts.agentPaused = false;
  },

  constraints: {
    sensitiveAction: {
      priority: 95,
      when: (facts) => {
        const sensitive = ['send_email', 'create_invoice', 'deploy', 'transfer_funds'];

        return sensitive.includes(facts.pendingAction ?? '');
      },
      require: (facts) => ({
        type: 'REQUEST_HUMAN_APPROVAL',
        action: facts.pendingAction!,
        payload: facts.pendingPayload,
      }),
    },
    enforceRejection: {
      priority: 100,
      when: (facts) => facts.approvalStatus === 'rejected',
      require: {
        type: 'CANCEL_ACTION',
        reason: 'Human reviewer rejected the action',
      },
    },
  },

  resolvers: {
    requestApproval: {
      requirement: 'REQUEST_HUMAN_APPROVAL',
      resolve: async (req, ctx) => {
        const id = crypto.randomUUID();
        ctx.facts.approvalId = id;
        ctx.facts.approvalStatus = 'pending';
        ctx.facts.agentPaused = true;

        // Push to your review queue – Slack, dashboard, email
        await sendApprovalRequest({
          id,
          action: req.action,
          payload: req.payload,
          reviewUrl: `https://dashboard.example.com/approvals/${id}`,
        });

        // Execution stops here. The agent is paused.
        // When a human calls approve(id), the fact updates
        // and the reconciliation loop resumes.
      },
    },
    cancelAction: {
      requirement: 'CANCEL_ACTION',
      resolve: async (req, ctx) => {
        ctx.facts.pendingAction = undefined;
        ctx.facts.pendingPayload = undefined;
        ctx.facts.approvalStatus = 'none';
        ctx.facts.agentPaused = false;
        await logSecurityEvent('action_rejected', { reason: req.reason });
      },
    },
  },
});
```

The approval flow has two constraints working together. `sensitiveAction` fires when a dangerous action is detected and pauses the agent. `enforceRejection` fires if the human says no. When the human approves, `approvalStatus` changes to `'approved'`, neither constraint is satisfied, and the reconciliation loop allows the action to proceed. The state machine for "pause, wait, resume or cancel" emerges from two independent constraints &ndash; no explicit state machine definition required.

---

## Composing guardrails into a system

Each guardrail above is an independent module. They don't know about each other. They don't import each other. They don't coordinate explicitly. But Directive's engine evaluates all of them together in a single reconciliation loop.

```typescript
import { createSystem } from '@directive-run/core';
import { loggingPlugin } from '@directive-run/core/plugins';

const system = createSystem({
  modules: [agentSafety, piiGuardrail, toolGuardrail, approvalGuardrail],
  plugins: [
    loggingPlugin({
      logConstraints: true,
      logRequirements: true,
      logResolutions: true,
    }),
  ],
});

system.start();
```

Four modules, four independent safety concerns, one unified engine. The budget module doesn't know about PII. The tool guardrail doesn't know about approvals. But the engine evaluates all their constraints on every cycle. If a tool call triggers both a denylist block *and* a budget warning, both constraints fire. If a PII-containing output also needs human approval, both requirements are emitted and resolved.

This is the property that imperative checks lack: **guaranteed composition**. Adding a fifth guardrail &ndash; say, rate limiting or content moderation &ndash; means adding a fifth module. Existing modules don't change. The engine handles the interplay.

And because constraints are declarative data structures, you can inspect them at runtime:

```typescript
// What safety rules are active right now?
const active = system.getActiveConstraints();
// Which requirements are pending?
const pending = system.getPendingRequirements();
// What did the last reconciliation cycle do?
const history = system.getResolutionHistory();
```

Compare this to grepping your codebase for `if (detectPII` to understand your safety posture.

---

## Provider-agnostic by design

Directive's constraint layer is not an LLM wrapper. It doesn't call OpenAI or Anthropic or Ollama directly. It manages facts, evaluates constraints, and dispatches resolvers. Your LLM calls happen in resolvers or in the orchestrator's runner function &ndash; Directive doesn't care which provider you use.

This means the same safety constraints work regardless of which model is behind the agent. Switch from GPT-4 to Claude to a local Llama model, and the budget enforcement, PII detection, tool blocking, and approval workflows don't change. The constraints evaluate facts, not API responses. As long as your runner updates the facts, the guardrails enforce.

This is especially important for teams running multiple models. Your production agent uses GPT-4 for quality. Your batch processing agent uses a cheaper model for cost. Your on-device agent uses a local model for latency. The same constraint modules protect all three. Write the safety rules once. Deploy them everywhere.

---

## What this gets you

Declarative guardrails change the properties of your safety layer:

**Guaranteed execution.** Constraints run because they exist in the module definition, not because a developer remembered to call a function. There is no code path that bypasses them.

**Visible policy.** Your entire safety posture is readable in one place &ndash; the constraint definitions. A security review reads the constraints, not the entire codebase.

**Independent evolution.** Adding a new guardrail doesn't touch existing ones. Modifying PII patterns doesn't affect budget logic. Each concern is isolated.

**Runtime introspection.** You can query which constraints are active, which fired, and what they required. Audit logs write themselves.

**Testable in isolation.** Each constraint is a pure function of facts. "Given these facts, does this constraint emit a requirement?" is a unit test, not an integration test.

---

## Getting started

Install Directive:

```bash
npm install @directive-run/core
```

Explore the AI safety documentation:

- **[Guardrails & Safety](/docs/ai/guardrails)** &ndash; built-in guardrails for PII, tool access, content moderation, and rate limiting
- **[Agent Orchestrator](/docs/ai/orchestrator)** &ndash; the orchestrator API with approval workflows and budget enforcement
- **[Building AI Agents](/blog/building-ai-agents)** &ndash; the full tutorial on orchestrating agents with Directive
- **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** &ndash; the paradigm behind all of this

Your agent framework already handles the happy path. Directive handles everything else &ndash; the budget that shouldn't be exceeded, the PII that shouldn't leak, the tool that shouldn't execute, the action that needs a human to say yes. Declare the rules. Let the runtime enforce them.
