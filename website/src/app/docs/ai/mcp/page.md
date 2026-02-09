---
title: MCP Integration
description: Connect Directive to Model Context Protocol servers for tool and resource access.
---

Bridge MCP servers into Directive with constraint-driven tool access control. {% .lead %}

---

## Setup

The `createMCPAdapter` function connects to MCP servers and provides a Directive plugin for tool constraints, resource syncing, and approval workflows:

```typescript
import { createMCPAdapter } from 'directive/mcp';
import { createModule, createSystem, t } from 'directive';

const adapter = createMCPAdapter({
  servers: [
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'mcp-server-filesystem',
      args: ['--root', '/workspace'],
    },
    {
      name: 'github',
      transport: 'sse',
      url: 'https://mcp.github.com',
      auth: { type: 'bearer', token: process.env.GITHUB_TOKEN },
    },
  ],
});

// Add to your Directive system as a plugin
const system = createSystem({
  module: myModule,
  plugins: [adapter.plugin],
});

// Connect to all servers
await adapter.connect();
```

In production, provide a real MCP client via `clientFactory`. Without it, a stub client is used for development:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const adapter = createMCPAdapter({
  servers: [...],
  clientFactory: (config) => new Client(config),
});
```

---

## Calling Tools

Call MCP tools with automatic constraint checking (rate limits, approval, argument size limits):

```typescript
// With constraints applied
const result = await adapter.callTool('filesystem', 'read_file', {
  path: '/workspace/config.json',
}, system.facts.$store.toObject());

// result.content is an array of MCPContent (text, image, or resource)
for (const content of result.content) {
  if (content.type === 'text') {
    console.log(content.text);
  }
}

// Direct call (bypasses all constraints — for trusted internal use)
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
  toolConstraints: {
    // Require approval before writing files
    'fs.write_file': {
      requireApproval: true,
      maxArgSize: 10000,     // Max 10KB arguments
      timeout: 30000,        // 30s timeout
    },

    // Rate limit read operations
    'fs.read_file': {
      rateLimit: 60,  // 60 calls per minute
    },

    // Conditional access based on system state
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
  approvalTimeoutMs: 60000,  // 60s timeout (default: 5 minutes)
  events: {
    onApprovalRequest: (request) => {
      console.log(`Approval needed: ${request.server}.${request.tool}`);
      console.log('Arguments:', request.args);

      // Show in your UI
      notifyApprover(request);
    },
    onApprovalResolved: (requestId, approved) => {
      console.log(`${requestId}: ${approved ? 'approved' : 'rejected'}`);
    },
  },
});

// In your approval handler:
adapter.approve(requestId);
// or
adapter.reject(requestId, 'Not authorized');

// Check pending approvals
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
  resourceMappings: [
    {
      pattern: 'file://*.json',
      factKey: 'jsonFiles',
      mode: 'poll',
      pollInterval: 5000,  // Sync every 5 seconds
      transform: (content) => JSON.parse(content),
    },
    {
      pattern: /^file:\/\/.*\.md$/,
      factKey: 'markdownFiles',
      mode: 'subscribe',  // Real-time updates via MCP subscription
    },
    {
      pattern: 'file:///workspace/config.yaml',
      factKey: 'config',
      mode: 'manual',  // Only sync when you call adapter.syncResources()
    },
  ],
});

// Manual sync
await adapter.syncResources(system.facts.$store.toObject());

// Read a resource directly
const resource = await adapter.readResource('fs', 'file:///workspace/README.md');
```

---

## Server Management

Connect, disconnect, and monitor individual servers:

```typescript
// Connect to a specific server
await adapter.connectServer('github');

// Disconnect a specific server
await adapter.disconnectServer('github');

// Check server status
const status = adapter.getServerStatus('filesystem');
console.log(status?.status);  // 'disconnected' | 'connecting' | 'connected' | 'error'
console.log(status?.tools);   // Available tools
console.log(status?.resources); // Available resources

// Get all statuses
const all = adapter.getAllServerStatuses();
for (const [name, s] of all) {
  console.log(`${name}: ${s.status}`);
}
```

---

## Discovery

List available tools and resources across all connected servers:

```typescript
// Tools grouped by server
const tools = adapter.getTools();
for (const [server, serverTools] of tools) {
  for (const tool of serverTools) {
    console.log(`${server}.${tool.name}: ${tool.description}`);
  }
}

// Resources grouped by server
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

## Next Steps

- See [OpenAI Agents](/docs/ai/openai-agents) for AI agent orchestration
- See [Guardrails](/docs/ai/guardrails) for input/output validation
- See [Multi-Agent](/docs/ai/multi-agent) for coordinating multiple agents
