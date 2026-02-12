---
title: MCP Integration
description: Connect Directive to Model Context Protocol servers for tool and resource access.
---

Bridge MCP servers into Directive with constraint-driven tool access control. {% .lead %}

---

## Setup

The `createMCPAdapter` function connects to MCP servers and provides a Directive plugin for tool constraints, resource syncing, and approval workflows:

{% callout type="note" title="Import Path" %}
The `directive/mcp` entry point must be configured in your project. See the [installation docs](/docs/installation) for subpath setup.
{% /callout %}

```typescript
import { createMCPAdapter } from 'directive/mcp';
import { createModule, createSystem, t } from 'directive';

const adapter = createMCPAdapter({
  servers: [
    // Local server via stdin/stdout
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'mcp-server-filesystem',
      args: ['--root', '/workspace'],
    },

    // Remote server via Server-Sent Events
    {
      name: 'github',
      transport: 'sse',
      url: 'https://mcp.github.com',
      auth: { type: 'bearer', token: process.env.GITHUB_TOKEN },
    },
  ],
});

// Register the adapter as a Directive plugin for constraint integration
const system = createSystem({
  module: myModule,
  plugins: [adapter.plugin],
});

// Open connections to all configured servers
await adapter.connect();
```

In production, provide a real MCP client via `clientFactory`. Without it, a stub client is used for development:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Provide a real MCP client for production (without this, a stub is used)
const adapter = createMCPAdapter({
  servers: [...],
  clientFactory: (config) => new Client(config),
});
```

---

## Calling Tools

Call MCP tools with automatic constraint checking (rate limits, approval, argument size limits):

```typescript
// Call a tool with constraint checking (rate limits, approval, size limits)
const result = await adapter.callTool('filesystem', 'read_file', {
  path: '/workspace/config.json',
}, system.facts.$store.toObject());

// Iterate over the response – content can be text, image, or resource
for (const content of result.content) {
  if (content.type === 'text') {
    console.log(content.text);
  }
}

// Bypass all constraints for trusted internal calls
const raw = await adapter.callToolDirect('filesystem', 'read_file', {
  path: '/workspace/config.json',
});
```

---

## Tool Constraints

Control tool access with per-tool constraints:

```typescript
const adapter = createMCPAdapter({
  servers: [
    { name: 'fs', transport: 'stdio', command: 'mcp-server-filesystem' },
  ],

  // Define per-tool access rules
  toolConstraints: {
    // Require human approval before any write operation
    'fs.write_file': {
      requireApproval: true,
      maxArgSize: 10000,     // Reject arguments larger than 10KB
      timeout: 30000,        // 30s timeout per call
    },

    // Throttle read operations to prevent abuse
    'fs.read_file': {
      rateLimit: 60,         // Max 60 calls per minute
    },

    // Only allow deletes for admin users
    'fs.delete_file': {
      requireApproval: true,
      when: (facts, args) => facts.userRole === 'admin',
    },
  },
});
```

---

## Approval Workflow

When a tool has `requireApproval: true`, calls pause until approved:

```typescript
const adapter = createMCPAdapter({
  servers: [...],
  toolConstraints: {
    'fs.write_file': { requireApproval: true },
  },
  approvalTimeoutMs: 60000,  // Fail after 60s with no decision (default: 5 minutes)

  events: {
    // Fires when a constrained tool call needs human approval
    onApprovalRequest: (request) => {
      console.log(`Approval needed: ${request.server}.${request.tool}`);
      console.log('Arguments:', request.args);
      notifyApprover(request);  // Push to your approval UI
    },

    onApprovalResolved: (requestId, approved) => {
      console.log(`${requestId}: ${approved ? 'approved' : 'rejected'}`);
    },
  },
});

// Wire these into your approval UI handler
adapter.approve(requestId);
adapter.reject(requestId, 'Not authorized');

// Query all pending approvals at any time
const pending = adapter.getPendingApprovals();
```

---

## Resource Syncing

Map MCP resources to Directive facts. Resources can be polled, subscribed to, or synced manually:

```typescript
const adapter = createMCPAdapter({
  servers: [
    { name: 'fs', transport: 'stdio', command: 'mcp-server-filesystem' },
  ],

  // Map MCP resources to Directive facts
  resourceMappings: [
    {
      pattern: 'file://*.json',
      factKey: 'jsonFiles',
      mode: 'poll',                                       // Check for changes on a timer
      pollInterval: 5000,                                  // Sync every 5 seconds
      transform: (content) => JSON.parse(content),         // Parse raw content into objects
    },
    {
      pattern: /^file:\/\/.*\.md$/,
      factKey: 'markdownFiles',
      mode: 'subscribe',                                   // Receive real-time push updates
    },
    {
      pattern: 'file:///workspace/config.yaml',
      factKey: 'config',
      mode: 'manual',                                      // Only sync on explicit call
    },
  ],
});

// Trigger a manual sync for resources with mode: 'manual'
await adapter.syncResources(system.facts.$store.toObject());

// Read a single resource directly by URI
const resource = await adapter.readResource('fs', 'file:///workspace/README.md');
```

---

## Server Management

Connect, disconnect, and monitor individual servers:

```typescript
// Manage individual server connections
await adapter.connectServer('github');
await adapter.disconnectServer('github');

// Inspect a single server
const status = adapter.getServerStatus('filesystem');
console.log(status?.status);     // 'disconnected' | 'connecting' | 'connected' | 'error'
console.log(status?.tools);      // Tools exposed by this server
console.log(status?.resources);  // Resources exposed by this server

// Enumerate all server statuses at once
const all = adapter.getAllServerStatuses();
for (const [name, s] of all) {
  console.log(`${name}: ${s.status}`);
}
```

---

## Discovery

List available tools and resources across all connected servers:

```typescript
// List all tools exposed by connected servers
const tools = adapter.getTools();
for (const [server, serverTools] of tools) {
  for (const tool of serverTools) {
    console.log(`${server}.${tool.name}: ${tool.description}`);
  }
}

// List all resources exposed by connected servers
const resources = adapter.getResources();
for (const [server, serverResources] of resources) {
  for (const resource of serverResources) {
    console.log(`${server}: ${resource.uri} (${resource.mimeType})`);
  }
}
```

---

## Event Hooks

Observe all MCP activity:

```typescript
const adapter = createMCPAdapter({
  servers: [...],

  // Hook into every MCP lifecycle event for logging or metrics
  events: {
    onConnect: (server) => console.log(`Connected: ${server}`),
    onDisconnect: (server) => console.log(`Disconnected: ${server}`),
    onToolCall: (server, tool, args) => console.log(`Calling: ${server}.${tool}`),
    onToolResult: (server, tool, result) => console.log(`Result: ${server}.${tool}`),
    onResourceUpdate: (server, uri, content) => console.log(`Resource updated: ${uri}`),
    onError: (server, error) => console.error(`Error on ${server}:`, error),
  },
});
```

---

## Framework Integration

MCP is primarily server-side, but you can display tool status and approval requests through the orchestrator's `.system` bridge keys.

### React

```tsx
import { useAgentOrchestrator, useFact } from 'directive/react';

function MCPToolPanel() {
  // Approval mode – tool calls require explicit sign-off
  const orchestrator = useAgentOrchestrator({ runner, autoApproveToolCalls: false });
  const { system } = orchestrator;

  // Subscribe to agent status, pending approvals, and tool call history
  const agent = useFact(system, '__agent');
  const approval = useFact(system, '__approval');
  const toolCalls = useFact(system, '__toolCalls');

  return (
    <div>
      <p>Status: {agent?.status}</p>
      <p>Pending approvals: {approval?.pending?.length ?? 0}</p>
      <ul>
        {toolCalls?.map((tc) => <li key={tc.id}>{tc.tool}: {tc.status}</li>)}
      </ul>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { createAgentOrchestrator } from 'directive/ai';
import { useFact } from 'directive/vue';
import { onUnmounted } from 'vue';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: false });
onUnmounted(() => orchestrator.dispose());

// Reactive refs for approval queue and tool call history
const approval = useFact(orchestrator.system, '__approval');
const toolCalls = useFact(orchestrator.system, '__toolCalls');
</script>

<template>
  <p>Pending approvals: {{ approval?.pending?.length ?? 0 }}</p>
  <ul>
    <li v-for="tc in toolCalls" :key="tc.id">{{ tc.tool }}: {{ tc.status }}</li>
  </ul>
</template>
```

### Svelte

```html
<script>
import { createAgentOrchestrator } from 'directive/ai';
import { useFact } from 'directive/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: false });
onDestroy(() => orchestrator.dispose());

// Svelte stores for approval queue and tool calls
const approval = useFact(orchestrator.system, '__approval');
const toolCalls = useFact(orchestrator.system, '__toolCalls');
</script>

<p>Pending approvals: {$approval?.pending?.length ?? 0}</p>
<ul>
  {#each $toolCalls ?? [] as tc (tc.id)}
    <li>{tc.tool}: {tc.status}</li>
  {/each}
</ul>
```

### Solid

```tsx
import { createAgentOrchestrator } from 'directive/ai';
import { useFact } from 'directive/solid';
import { onCleanup, For } from 'solid-js';

function MCPToolPanel() {
  const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: false });
  onCleanup(() => orchestrator.dispose());

  // Solid signals – call approval() and toolCalls() to read current values
  const approval = useFact(orchestrator.system, '__approval');
  const toolCalls = useFact(orchestrator.system, '__toolCalls');

  return (
    <div>
      <p>Pending approvals: {approval()?.pending?.length ?? 0}</p>
      <ul>
        <For each={toolCalls() ?? []}>{(tc) => <li>{tc.tool}: {tc.status}</li>}</For>
      </ul>
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createAgentOrchestrator } from 'directive/ai';
import { FactController } from 'directive/lit';

class MCPToolPanel extends LitElement {
  private orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: false });

  // Reactive controllers – trigger re-render when approval or tool state changes
  private approval = new FactController(this, this.orchestrator.system, '__approval');
  private toolCalls = new FactController(this, this.orchestrator.system, '__toolCalls');

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  render() {
    return html`
      <p>Pending approvals: ${this.approval.value?.pending?.length ?? 0}</p>
      <ul>
        ${(this.toolCalls.value ?? []).map((tc) => html`<li>${tc.tool}: ${tc.status}</li>`)}
      </ul>
    `;
  }
}
```

---

## Next Steps

- See [Agent Orchestrator](/docs/ai/orchestrator) for AI agent orchestration
- See [Guardrails](/docs/ai/guardrails) for input/output validation
- See [Multi-Agent](/docs/ai/multi-agent) for coordinating multiple agents
