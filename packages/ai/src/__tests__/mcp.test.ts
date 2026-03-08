import { describe, expect, it, vi } from "vitest";
import { createMCPAdapter, convertToolsForLLM, mcpCallTool, mcpReadResource, mcpGetPrompt, mcpSyncResources } from "../mcp.js";
import type { MCPClient, MCPServerConfig, MCPTool, MCPResource, MCPToolResult, MCPResourceResult, MCPPromptResult } from "../mcp-types.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockClient(overrides: Partial<MCPClient> = {}): MCPClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({ tools: true, resources: true, prompts: true }),
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }] }),
    readResource: vi.fn().mockResolvedValue({ contents: [{ uri: "test", text: "data" }] }),
    listPrompts: vi.fn().mockResolvedValue([]),
    getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    ...overrides,
  };
}

function serverConfig(name: string, transport: "stdio" | "sse" = "stdio"): MCPServerConfig {
  return { name, transport, command: `mcp-server-${name}` };
}

// ============================================================================
// connect / disconnect
// ============================================================================

describe("connect / disconnect", () => {
  it("connects to all configured servers", async () => {
    const clientA = createMockClient();
    const clientB = createMockClient();
    const clients: Record<string, MCPClient> = { fs: clientA, db: clientB };

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs"), serverConfig("db")],
      clientFactory: (cfg) => clients[cfg.name]!,
    });

    await adapter.connect();

    expect(clientA.connect).toHaveBeenCalledOnce();
    expect(clientB.connect).toHaveBeenCalledOnce();
  });

  it("fetches tools and resources after connecting", async () => {
    const tools: MCPTool[] = [{ name: "read_file", inputSchema: { type: "object" } }];
    const resources: MCPResource[] = [{ uri: "file:///tmp", name: "tmp" }];
    const client = createMockClient({
      listTools: vi.fn().mockResolvedValue(tools),
      listResources: vi.fn().mockResolvedValue(resources),
    });

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
    });

    await adapter.connect();

    expect(client.listTools).toHaveBeenCalledOnce();
    expect(client.listResources).toHaveBeenCalledOnce();
    expect(adapter.getTools().get("fs")).toEqual(tools);
    expect(adapter.getResources().get("fs")).toEqual(resources);
  });

  it("disconnects from all servers", async () => {
    const client = createMockClient();
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
    });

    await adapter.connect();
    await adapter.disconnect();

    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("fires onConnect and onDisconnect events", async () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const client = createMockClient();

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      events: { onConnect, onDisconnect },
    });

    await adapter.connect();
    expect(onConnect).toHaveBeenCalledWith("fs");

    await adapter.disconnect();
    expect(onDisconnect).toHaveBeenCalledWith("fs");
  });

  it("sets status to 'connected' after successful connect", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    await adapter.connect();
    const status = adapter.getServerStatus("fs");

    expect(status?.status).toBe("connected");
  });
});

// ============================================================================
// connectServer / disconnectServer
// ============================================================================

describe("connectServer / disconnectServer", () => {
  it("connects to a single server by name", async () => {
    const clientA = createMockClient();
    const clientB = createMockClient();
    const clients: Record<string, MCPClient> = { fs: clientA, db: clientB };

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs"), serverConfig("db")],
      clientFactory: (cfg) => clients[cfg.name]!,
    });

    await adapter.connectServer("fs");

    expect(clientA.connect).toHaveBeenCalledOnce();
    expect(clientB.connect).not.toHaveBeenCalled();
  });

  it("throws for unknown server name", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    await expect(adapter.connectServer("unknown")).rejects.toThrow("Unknown MCP server: unknown");
  });

  it("disconnects a single server without affecting others", async () => {
    const clientA = createMockClient();
    const clientB = createMockClient();
    const clients: Record<string, MCPClient> = { fs: clientA, db: clientB };

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs"), serverConfig("db")],
      clientFactory: (cfg) => clients[cfg.name]!,
    });

    await adapter.connect();
    await adapter.disconnectServer("fs");

    expect(clientA.disconnect).toHaveBeenCalledOnce();
    expect(clientB.disconnect).not.toHaveBeenCalled();
    expect(adapter.getServerStatus("fs")?.status).toBe("disconnected");
    expect(adapter.getServerStatus("db")?.status).toBe("connected");
  });

  it("no-ops when disconnecting a server that is not connected", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    // Should not throw
    await adapter.disconnectServer("fs");
  });
});

// ============================================================================
// getTools
// ============================================================================

describe("getTools", () => {
  it("returns empty tool lists before connecting", () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    const tools = adapter.getTools();

    expect(tools.get("fs")).toEqual([]);
  });

  it("returns tools grouped by server", async () => {
    const toolsA: MCPTool[] = [{ name: "read_file", inputSchema: { type: "object" } }];
    const toolsB: MCPTool[] = [{ name: "query", inputSchema: { type: "object" } }];

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs"), serverConfig("db")],
      clientFactory: (cfg) =>
        createMockClient({
          listTools: vi.fn().mockResolvedValue(cfg.name === "fs" ? toolsA : toolsB),
        }),
    });

    await adapter.connect();
    const tools = adapter.getTools();

    expect(tools.get("fs")).toEqual(toolsA);
    expect(tools.get("db")).toEqual(toolsB);
  });
});

// ============================================================================
// getResources
// ============================================================================

describe("getResources", () => {
  it("returns resources grouped by server", async () => {
    const resources: MCPResource[] = [{ uri: "file:///etc/hosts", name: "hosts" }];
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () =>
        createMockClient({
          listResources: vi.fn().mockResolvedValue(resources),
        }),
    });

    await adapter.connect();

    expect(adapter.getResources().get("fs")).toEqual(resources);
  });
});

// ============================================================================
// callTool
// ============================================================================

describe("callTool", () => {
  it("calls tool on the correct server and returns result", async () => {
    const expectedResult: MCPToolResult = { content: [{ type: "text", text: "file contents" }] };
    const client = createMockClient({
      callTool: vi.fn().mockResolvedValue(expectedResult),
    });

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
    });

    await adapter.connect();
    const result = await adapter.callTool("fs", "read_file", { path: "/tmp" }, {});

    expect(client.callTool).toHaveBeenCalledWith("read_file", { path: "/tmp" });
    expect(result).toEqual(expectedResult);
  });

  it("throws when calling tool on unknown server", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    await adapter.connect();
    await expect(adapter.callTool("unknown", "read", {}, {})).rejects.toThrow("Unknown server 'unknown'");
  });

  it("throws when calling tool on disconnected server", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    // Never connected
    await expect(adapter.callTool("fs", "read", {}, {})).rejects.toThrow("not connected");
  });

  it("fires onToolCall and onToolResult events", async () => {
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      events: { onToolCall, onToolResult },
    });

    await adapter.connect();
    await adapter.callTool("fs", "read_file", { path: "/" }, {});

    expect(onToolCall).toHaveBeenCalledWith("fs", "read_file", { path: "/" });
    expect(onToolResult).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// callTool with constraints
// ============================================================================

describe("callTool with constraints", () => {
  it("blocks call when when() constraint returns false", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      toolConstraints: {
        "fs.write_file": {
          when: () => false,
        },
      },
    });

    await adapter.connect();
    await expect(
      adapter.callTool("fs", "write_file", { path: "/tmp", content: "x" }, {}),
    ).rejects.toThrow("Constraint not satisfied");
  });

  it("allows call when when() constraint returns true", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      toolConstraints: {
        "fs.write_file": {
          when: (facts) => facts.canWrite === true,
        },
      },
    });

    await adapter.connect();
    const result = await adapter.callTool("fs", "write_file", { path: "/tmp" }, { canWrite: true });

    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });

  it("enforces rate limiting", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      toolConstraints: {
        "fs.read_file": { rateLimit: 2 },
      },
    });

    await adapter.connect();

    // First two calls succeed
    await adapter.callTool("fs", "read_file", {}, {});
    await adapter.callTool("fs", "read_file", {}, {});

    // Third call exceeds rate limit
    await expect(adapter.callTool("fs", "read_file", {}, {})).rejects.toThrow("Rate limit exceeded");
  });

  it("enforces maxArgSize", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      toolConstraints: {
        "fs.write_file": { maxArgSize: 10 },
      },
    });

    await adapter.connect();
    await expect(
      adapter.callTool("fs", "write_file", { content: "a".repeat(100) }, {}),
    ).rejects.toThrow("Arguments exceed max size");
  });

  it("requireApproval blocks until approved", async () => {
    const onApprovalRequest = vi.fn();

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      toolConstraints: {
        "fs.delete_file": { requireApproval: true },
      },
      events: { onApprovalRequest },
    });

    await adapter.connect();

    const callPromise = adapter.callTool("fs", "delete_file", { path: "/tmp" }, {});

    // Wait a tick for the approval request to be emitted
    await new Promise((r) => setTimeout(r, 10));

    expect(onApprovalRequest).toHaveBeenCalledOnce();
    const request = onApprovalRequest.mock.calls[0]![0];
    expect(request.server).toBe("fs");
    expect(request.tool).toBe("delete_file");

    // Approve the request
    adapter.approve(request.id);

    const result = await callPromise;
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });

  it("requireApproval rejects when rejected", async () => {
    const onApprovalRequest = vi.fn();

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
      toolConstraints: {
        "fs.delete_file": { requireApproval: true },
      },
      events: { onApprovalRequest },
    });

    await adapter.connect();

    const callPromise = adapter.callTool("fs", "delete_file", { path: "/tmp" }, {});

    await new Promise((r) => setTimeout(r, 10));

    const request = onApprovalRequest.mock.calls[0]![0];
    adapter.reject(request.id, "too dangerous");

    await expect(callPromise).rejects.toThrow("rejected");
  });
});

// ============================================================================
// callToolDirect
// ============================================================================

describe("callToolDirect", () => {
  it("bypasses constraints and calls tool directly", async () => {
    const client = createMockClient();
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      toolConstraints: {
        "fs.write_file": { when: () => false },
      },
    });

    await adapter.connect();
    // callToolDirect bypasses the `when` constraint
    const result = await adapter.callToolDirect("fs", "write_file", { path: "/tmp" });

    expect(client.callTool).toHaveBeenCalledWith("write_file", { path: "/tmp" });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });
});

// ============================================================================
// readResource
// ============================================================================

describe("readResource", () => {
  it("reads resource from the correct server", async () => {
    const expectedResult: MCPResourceResult = { contents: [{ uri: "file:///etc/hosts", text: "127.0.0.1" }] };
    const client = createMockClient({
      readResource: vi.fn().mockResolvedValue(expectedResult),
    });

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      events: { onResourceUpdate: vi.fn() },
    });

    await adapter.connect();
    const result = await adapter.readResource("fs", "file:///etc/hosts");

    expect(client.readResource).toHaveBeenCalledWith("file:///etc/hosts");
    expect(result).toEqual(expectedResult);
  });

  it("throws when reading from unknown server", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    await adapter.connect();
    await expect(adapter.readResource("unknown", "file:///tmp")).rejects.toThrow("Unknown server 'unknown'");
  });

  it("throws when reading from disconnected server", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    await expect(adapter.readResource("fs", "file:///tmp")).rejects.toThrow("not connected");
  });
});

// ============================================================================
// getPrompt (via client)
// ============================================================================

describe("getPrompt", () => {
  it("delegates to the underlying client getPrompt", async () => {
    const promptResult: MCPPromptResult = {
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
    };
    const client = createMockClient({
      getPrompt: vi.fn().mockResolvedValue(promptResult),
    });

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
    });

    await adapter.connect();

    // Access the client through server status to call getPrompt
    const serverState = adapter.getServerStatus("fs");
    const result = await serverState!.client!.getPrompt("greeting", { name: "world" });

    expect(client.getPrompt).toHaveBeenCalledWith("greeting", { name: "world" });
    expect(result).toEqual(promptResult);
  });
});

// ============================================================================
// syncResources
// ============================================================================

describe("syncResources", () => {
  it("syncs matching resources to facts using string pattern", async () => {
    const resources: MCPResource[] = [
      { uri: "file:///config.json", name: "config" },
      { uri: "file:///data.csv", name: "data" },
    ];
    const client = createMockClient({
      listResources: vi.fn().mockResolvedValue(resources),
      readResource: vi.fn().mockImplementation(async (uri: string) => ({
        contents: [{ uri, text: `content of ${uri}` }],
      })),
    });

    const facts: Record<string, unknown> = {};

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      resourceMappings: [
        { pattern: "file:///*.json", factKey: "jsonConfig", mode: "manual" },
      ],
    });

    await adapter.connect();
    await adapter.syncResources(facts);

    expect(facts.jsonConfig).toBe("content of file:///config.json");
  });

  it("syncs matching resources using regex pattern", async () => {
    const resources: MCPResource[] = [
      { uri: "db://users", name: "users" },
      { uri: "db://orders", name: "orders" },
    ];
    const client = createMockClient({
      listResources: vi.fn().mockResolvedValue(resources),
      readResource: vi.fn().mockImplementation(async (uri: string) => ({
        contents: [{ uri, text: `data:${uri}` }],
      })),
    });

    const facts: Record<string, unknown> = {};

    const adapter = createMCPAdapter({
      servers: [serverConfig("db")],
      clientFactory: () => client,
      resourceMappings: [
        { pattern: /^db:\/\/users$/, factKey: "userData", mode: "manual" },
      ],
    });

    await adapter.connect();
    await adapter.syncResources(facts);

    expect(facts.userData).toBe("data:db://users");
    expect(facts).not.toHaveProperty("orderData");
  });

  it("applies transform function to synced content", async () => {
    const resources: MCPResource[] = [{ uri: "file:///config.json", name: "config" }];
    const client = createMockClient({
      listResources: vi.fn().mockResolvedValue(resources),
      readResource: vi.fn().mockResolvedValue({
        contents: [{ uri: "file:///config.json", text: '{"port":3000}' }],
      }),
    });

    const facts: Record<string, unknown> = {};

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      resourceMappings: [
        {
          pattern: "file:///*.json",
          factKey: "config",
          mode: "manual",
          transform: (content: string) => JSON.parse(content),
        },
      ],
    });

    await adapter.connect();
    await adapter.syncResources(facts);

    expect(facts.config).toEqual({ port: 3000 });
  });
});

// ============================================================================
// plugin
// ============================================================================

describe("plugin", () => {
  it("returns a valid Directive Plugin with name", () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    expect(adapter.plugin).toBeDefined();
    expect(adapter.plugin.name).toBe("mcp-adapter");
  });

  it("has onInit and onDestroy lifecycle hooks", () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => createMockClient(),
    });

    expect(adapter.plugin.onInit).toBeTypeOf("function");
    expect(adapter.plugin.onDestroy).toBeTypeOf("function");
  });

  it("autoConnect triggers connection on onInit", async () => {
    const client = createMockClient();
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      autoConnect: true,
    });

    await adapter.plugin.onInit!({} as any);

    expect(client.connect).toHaveBeenCalledOnce();
  });

  it("onDestroy disconnects all servers", async () => {
    const client = createMockClient();
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
    });

    await adapter.connect();
    await (adapter.plugin.onDestroy as () => Promise<void>)();

    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("error handling", () => {
  it("sets server status to 'error' on connect failure", async () => {
    const client = createMockClient({
      connect: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      autoReconnect: false,
    });

    await expect(adapter.connectServer("fs")).rejects.toThrow("Connection refused");
    expect(adapter.getServerStatus("fs")?.status).toBe("error");
    expect(adapter.getServerStatus("fs")?.error?.message).toBe("Connection refused");
  });

  it("fires onError event on connect failure", async () => {
    const onError = vi.fn();
    const client = createMockClient({
      connect: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    const adapter = createMCPAdapter({
      servers: [serverConfig("fs")],
      clientFactory: () => client,
      autoReconnect: false,
      events: { onError },
    });

    await expect(adapter.connectServer("fs")).rejects.toThrow("timeout");
    expect(onError).toHaveBeenCalledWith("fs", expect.any(Error));
  });
});

// ============================================================================
// getAllServerStatuses
// ============================================================================

describe("getAllServerStatuses", () => {
  it("returns a map of all server statuses", async () => {
    const adapter = createMCPAdapter({
      servers: [serverConfig("fs"), serverConfig("db")],
      clientFactory: () => createMockClient(),
    });

    await adapter.connectServer("fs");

    const statuses = adapter.getAllServerStatuses();

    expect(statuses.size).toBe(2);
    expect(statuses.get("fs")?.status).toBe("connected");
    expect(statuses.get("db")?.status).toBe("disconnected");
  });
});

// ============================================================================
// Requirement helper functions
// ============================================================================

describe("requirement helpers", () => {
  it("mcpCallTool creates a MCP_CALL_TOOL requirement", () => {
    const req = mcpCallTool("fs", "read_file", { path: "/tmp" });

    expect(req).toEqual({
      type: "MCP_CALL_TOOL",
      server: "fs",
      tool: "read_file",
      args: { path: "/tmp" },
    });
  });

  it("mcpReadResource creates a MCP_READ_RESOURCE requirement", () => {
    const req = mcpReadResource("fs", "file:///etc/hosts");

    expect(req).toEqual({
      type: "MCP_READ_RESOURCE",
      server: "fs",
      uri: "file:///etc/hosts",
    });
  });

  it("mcpGetPrompt creates a MCP_GET_PROMPT requirement", () => {
    const req = mcpGetPrompt("llm", "summarize", { text: "hello" });

    expect(req).toEqual({
      type: "MCP_GET_PROMPT",
      server: "llm",
      prompt: "summarize",
      args: { text: "hello" },
    });
  });

  it("mcpSyncResources creates a MCP_SYNC_RESOURCES requirement", () => {
    const req = mcpSyncResources("fs", "file:///*.json");

    expect(req).toEqual({
      type: "MCP_SYNC_RESOURCES",
      server: "fs",
      pattern: "file:///*.json",
    });
  });
});

// ============================================================================
// convertToolsForLLM
// ============================================================================

describe("convertToolsForLLM", () => {
  it("converts tools map to LLM function calling format", () => {
    const tools = new Map<string, MCPTool[]>();
    tools.set("fs", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
    ]);
    tools.set("db", [
      { name: "query", inputSchema: { type: "object" } },
    ]);

    const result = convertToolsForLLM(tools);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "fs.read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    });
    expect(result[1]).toEqual({
      type: "function",
      function: {
        name: "db.query",
        description: "Tool: query",
        parameters: { type: "object" },
      },
    });
  });

  it("returns empty array for empty tools map", () => {
    const result = convertToolsForLLM(new Map());

    expect(result).toEqual([]);
  });
});
