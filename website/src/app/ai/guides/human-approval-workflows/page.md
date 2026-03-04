---
title: Human Approval Workflows
description: Require human review before AI agents take dangerous actions like sending emails or deleting data.
---

Require human review before agents take dangerous actions. {% .lead %}

---

## The Problem

Your agent decides to send an email to 10,000 customers, delete a database record, or charge a credit card. These actions are irreversible. You need a human in the loop before the agent executes them.

## The Solution

Use `onApprovalRequest` to intercept tool calls, then `approve()` or `reject()` to control execution:

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: false,
  onApprovalRequest: (request) => {
    console.log(`Agent wants to call: ${request.description}`);
    console.log(`Request ID: ${request.id}`);
    // Show this to a human in your UI
  },
});

// Later, when the human decides:
orchestrator.approve(requestId);
// or
orchestrator.reject(requestId, 'Too risky');
```

## How It Works

- **`autoApproveToolCalls: false`** tells the orchestrator to pause on every tool call and wait for approval.
- **`onApprovalRequest`** fires with an `ApprovalRequest` containing the request `id`, `type`, `agentName`, `description`, and `data`.
- **The agent pauses** until you call `approve(requestId)` or `reject(requestId, reason?)`.
- **Rejected tool calls** return the rejection reason to the agent, which can adjust its approach or inform the user.
- **Timeout** defaults to 300 seconds. Customize with `approvalTimeoutMs`.

## Full Example

A support agent that auto-approves read operations but requires human review for writes:

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';

const readOnlyTools = new Set(['search_docs', 'get_account', 'list_orders']);

const pendingApprovals = new Map();

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,
  onApprovalRequest: (request) => {
    const toolName = request.description;

    // Auto-approve safe operations
    if (readOnlyTools.has(toolName)) {
      orchestrator.approve(request.id);

      return;
    }

    // Queue dangerous operations for human review
    pendingApprovals.set(request.id, request);
    notifyHuman({ // Your notification function – Directive doesn't provide this
      id: request.id,
      agent: request.agentName,
      action: request.description,
      details: request.data,
    });
  },
});

// Your UI handler – wire this to your approval UI
function handleHumanDecision(requestId: string, approved: boolean, reason?: string) {
  if (approved) {
    orchestrator.approve(requestId);
  } else {
    orchestrator.reject(requestId, reason ?? 'Rejected by reviewer');
  }
  pendingApprovals.delete(requestId);
}
```

## Related

- [Orchestrator reference](/ai/orchestrator) – full orchestrator options including approval configuration
- [Guardrails reference](/ai/guardrails) – tool guardrails for allowlist/denylist control
