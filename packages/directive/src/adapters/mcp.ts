/**
 * MCP Adapter - Model Context Protocol Integration for Directive
 *
 * Provides seamless integration between Directive's constraint system and MCP servers:
 * - MCP tools become Directive resolvers with constraint-driven access control
 * - MCP resources sync to Directive facts
 * - MCP prompts available through requirements
 *
 * @example
 * ```typescript
 * import { createMCPAdapter } from 'directive/mcp';
 *
 * const mcpAdapter = createMCPAdapter({
 *   servers: [
 *     { name: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem' },
 *     { name: 'github', transport: 'sse', url: 'https://mcp.github.com' }
 *   ],
 *   toolConstraints: {
 *     'filesystem.write': { requireApproval: true },
 *     'github.create_pr': { when: (facts) => facts.reviewComplete }
 *   }
 * });
 *
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [mcpAdapter.plugin]
 * });
 * ```
 */

import type { Plugin } from "../core/types.js";
import type {
  MCPAdapterConfig,
  MCPClient,
  MCPServerConfig,
  MCPTool,
  MCPResource,
  MCPToolConstraint,
  MCPToolResult,
  MCPResourceResult,
  MCPResourceMapping,
  MCPCallToolRequirement,
  MCPReadResourceRequirement,
  MCPGetPromptRequirement,
  MCPSyncResourcesRequirement,
  MCPApprovalRequest,
} from "./mcp-types.js";

// ============================================================================
// MCP Adapter State
// ============================================================================

/** State of an MCP server connection */
interface MCPServerState {
  config: MCPServerConfig;
  client: MCPClient | null;
  tools: MCPTool[];
  resources: MCPResource[];
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: Error;
  lastSync?: number;
}

/** Internal state for the adapter */
interface MCPAdapterState {
  servers: Map<string, MCPServerState>;
  toolConstraints: Map<string, MCPToolConstraint>;
  resourceMappings: MCPResourceMapping[];
  rateLimiters: Map<string, { count: number; resetTime: number }>;
  /** Pending approval requests */
  pendingApprovals: Map<string, MCPApprovalRequest>;
  /** Approved request IDs */
  approvedRequests: Set<string>;
  /** Rejected request IDs */
  rejectedRequests: Set<string>;
}

// ============================================================================
// MCP Adapter Instance
// ============================================================================

/** MCP Adapter instance */
export interface MCPAdapter {
  /** Plugin to add to Directive system */
  plugin: Plugin;
  /** Connect to all configured servers */
  connect(): Promise<void>;
  /** Connect to a specific server */
  connectServer(name: string): Promise<void>;
  /** Disconnect from all servers */
  disconnect(): Promise<void>;
  /** Disconnect from a specific server */
  disconnectServer(name: string): Promise<void>;
  /** Get all available tools across all servers */
  getTools(): Map<string, MCPTool[]>;
  /** Get all available resources across all servers */
  getResources(): Map<string, MCPResource[]>;
  /**
   * Call a tool with constraint checking (recommended).
   * Applies rate limits, argument size limits, approval workflow, and custom constraints.
   * @param server - Server name
   * @param tool - Tool name
   * @param args - Tool arguments
   * @param facts - Current facts for constraint evaluation
   */
  callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    facts: Record<string, unknown>
  ): Promise<MCPToolResult>;
  /**
   * Call a tool directly, bypassing all constraints (rate limits, approvals, etc.).
   * Use only for trusted internal calls where constraint checking is not needed.
   */
  callToolDirect(server: string, tool: string, args: Record<string, unknown>): Promise<MCPToolResult>;
  /** Read a resource directly */
  readResource(server: string, uri: string): Promise<MCPResourceResult>;
  /** Sync resources to facts */
  syncResources(facts: Record<string, unknown>): Promise<void>;
  /** Get server status */
  getServerStatus(name: string): MCPServerState | undefined;
  /** Get all server statuses */
  getAllServerStatuses(): Map<string, MCPServerState>;
  /** Approve a pending tool call request */
  approve(requestId: string): void;
  /** Reject a pending tool call request */
  reject(requestId: string, reason?: string): void;
  /** Get pending approval requests */
  getPendingApprovals(): MCPApprovalRequest[];
  /** Get the rejection reason for a request (if available) */
  getRejectionReason(requestId: string): string | undefined;
}

// ============================================================================
// Default MCP Client (Stub)
// ============================================================================

/**
 * Create a stub MCP client for development/testing.
 *
 * **Important:** This stub is for development only. In production, provide
 * a real MCP client via the `clientFactory` option:
 *
 * @example
 * ```typescript
 * import { Client } from "@modelcontextprotocol/sdk/client/index.js";
 *
 * const adapter = createMCPAdapter({
 *   servers: [...],
 *   clientFactory: (config) => new Client(config),
 * });
 * ```
 *
 * @param config - Server configuration
 * @param debug - Enable debug logging (default: false)
 */
function createStubClient(config: MCPServerConfig, debug = false): MCPClient {
  let connected = false;
  const tools: MCPTool[] = [];
  const resources: MCPResource[] = [];

  const log = debug
    ? (msg: string, ...args: unknown[]) => console.debug(`[MCP Stub] ${msg}`, ...args)
    : () => {};

  return {
    async connect() {
      log(`Connecting to ${config.name} (${config.transport})`);
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    isConnected() {
      return connected;
    },
    getCapabilities() {
      return { tools: true, resources: true, prompts: true };
    },
    async listTools() {
      return tools;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      log(`Calling tool ${name}`, args);
      return {
        content: [{ type: "text" as const, text: `Stub result for ${name}` }],
      };
    },
    async listResources() {
      return resources;
    },
    async readResource(uri: string) {
      log(`Reading resource ${uri}`);
      return {
        contents: [{ uri, text: `Stub content for ${uri}` }],
      };
    },
    async listPrompts() {
      return [];
    },
    async getPrompt(name: string) {
      return {
        messages: [{ role: "user" as const, content: { type: "text" as const, text: `Stub prompt ${name}` } }],
      };
    },
  };
}

// ============================================================================
// Rate Limiter
// ============================================================================

function checkRateLimit(
  rateLimiters: Map<string, { count: number; resetTime: number }>,
  key: string,
  limit: number
): boolean {
  const now = Date.now();
  const limiter = rateLimiters.get(key);

  if (!limiter || now > limiter.resetTime) {
    rateLimiters.set(key, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (limiter.count >= limit) {
    return false;
  }

  limiter.count++;
  return true;
}

// ============================================================================
// MCP Adapter Factory
// ============================================================================

/**
 * Create an MCP adapter for Directive integration.
 *
 * @example
 * ```typescript
 * const adapter = createMCPAdapter({
 *   servers: [
 *     { name: 'fs', transport: 'stdio', command: 'mcp-server-filesystem' },
 *   ],
 *   toolConstraints: {
 *     'fs.write_file': {
 *       requireApproval: true,
 *       maxArgSize: 10000,
 *       timeout: 30000,
 *     },
 *   },
 *   resourceMappings: [
 *     {
 *       pattern: 'file://*.json',
 *       factKey: 'jsonFiles',
 *       mode: 'poll',
 *       pollInterval: 5000,
 *     },
 *   ],
 * });
 *
 * // Add to system
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [adapter.plugin],
 * });
 *
 * // Connect to servers
 * await adapter.connect();
 * ```
 */
export function createMCPAdapter(config: MCPAdapterConfig): MCPAdapter {
  const {
    servers,
    toolConstraints = {},
    resourceMappings = [],
    events = {},
    autoConnect = false,
    autoReconnect = true,
    debug = false,
  } = config;

  // Warn if using stub client in production
  const usingStubClient = !config.clientFactory;
  if (usingStubClient) {
    const isProduction = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
    if (isProduction) {
      console.warn(
        "[Directive MCP] WARNING: Using stub MCP client in production!\n" +
        "The stub client returns mock data and does not connect to real MCP servers.\n" +
        "Provide a real 'clientFactory' option to connect to actual MCP servers:\n\n" +
        "  import { Client } from '@modelcontextprotocol/sdk/client/index.js';\n\n" +
        "  const adapter = createMCPAdapter({\n" +
        "    servers: [...],\n" +
        "    clientFactory: (config) => new Client(config),\n" +
        "  });"
      );
    } else if (debug) {
      console.debug(
        "[Directive MCP] Using stub client for development. " +
        "Provide 'clientFactory' for production use."
      );
    }
  }

  const clientFactory = config.clientFactory ?? ((serverConfig: MCPServerConfig) => createStubClient(serverConfig, debug));
  const approvalTimeoutMs = config.approvalTimeoutMs ?? 300000;

  // Initialize state
  const state: MCPAdapterState = {
    servers: new Map(),
    toolConstraints: new Map(Object.entries(toolConstraints)),
    resourceMappings,
    rateLimiters: new Map(),
    pendingApprovals: new Map(),
    approvedRequests: new Set(),
    rejectedRequests: new Set(),
  };

  // Approval ID counter
  let approvalCounter = 0;

  // Promise-based approval waiting (no polling)
  const approvalWaiters = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();

  // Rejection reasons storage
  const rejectionReasons = new Map<string, string>();

  // Wait for approval with timeout - Promise-based, no polling
  function waitForApproval(requestId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already resolved
      if (state.approvedRequests.has(requestId)) {
        state.approvedRequests.delete(requestId);
        state.pendingApprovals.delete(requestId);
        events.onApprovalResolved?.(requestId, true);
        resolve();
        return;
      }
      if (state.rejectedRequests.has(requestId)) {
        state.rejectedRequests.delete(requestId);
        state.pendingApprovals.delete(requestId);
        const reason = rejectionReasons.get(requestId);
        rejectionReasons.delete(requestId);
        events.onApprovalResolved?.(requestId, false);
        reject(new Error(
          `[Directive MCP] Tool call request ${requestId} was rejected${reason ? `: ${reason}` : ""}`
        ));
        return;
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        approvalWaiters.delete(requestId);
        state.pendingApprovals.delete(requestId);
        reject(new Error(
          `[Directive MCP] Approval timeout: Request ${requestId} was not approved or rejected within ${approvalTimeoutMs}ms. ` +
          `Call adapter.approve("${requestId}") or adapter.reject("${requestId}") to resolve.`
        ));
      }, approvalTimeoutMs);

      // Store waiter for later resolution
      approvalWaiters.set(requestId, { resolve, reject, timeoutId });
    });
  }

  // Resolve an approval (called by approve/reject)
  function resolveApproval(requestId: string, approved: boolean, reason?: string): void {
    const waiter = approvalWaiters.get(requestId);
    if (waiter) {
      clearTimeout(waiter.timeoutId);
      approvalWaiters.delete(requestId);
      state.pendingApprovals.delete(requestId);
      events.onApprovalResolved?.(requestId, approved);

      if (approved) {
        waiter.resolve();
      } else {
        waiter.reject(new Error(
          `[Directive MCP] Tool call request ${requestId} was rejected${reason ? `: ${reason}` : ""}`
        ));
      }
    } else {
      // Waiter not yet created, store for immediate resolution with TTL cleanup
      if (approved) {
        state.approvedRequests.add(requestId);
      } else {
        state.rejectedRequests.add(requestId);
        if (reason) {
          rejectionReasons.set(requestId, reason);
        }
      }
      // Auto-cleanup pre-resolved state after approval timeout to prevent memory leaks
      setTimeout(() => {
        state.approvedRequests.delete(requestId);
        state.rejectedRequests.delete(requestId);
        rejectionReasons.delete(requestId);
        state.pendingApprovals.delete(requestId);
      }, approvalTimeoutMs);
    }
  }

  // Track reconnect state per server
  const reconnectState = new Map<string, {
    timer: ReturnType<typeof setTimeout> | null;
    attempts: number;
    maxAttempts: number;
    baseDelay: number;
  }>();

  // Initialize server states
  for (const serverConfig of servers) {
    state.servers.set(serverConfig.name, {
      config: serverConfig,
      client: null,
      tools: [],
      resources: [],
      status: "disconnected",
    });
    reconnectState.set(serverConfig.name, {
      timer: null,
      attempts: 0,
      maxAttempts: serverConfig.retry?.maxAttempts ?? 10,
      baseDelay: serverConfig.retry?.backoffMs ?? 5000,
    });
  }

  // Connect to a server
  async function connectServer(name: string): Promise<void> {
    const serverState = state.servers.get(name);
    if (!serverState) {
      throw new Error(`Unknown MCP server: ${name}`);
    }

    if (serverState.status === "connected") {
      return;
    }

    serverState.status = "connecting";

    try {
      const client = clientFactory(serverState.config);
      await client.connect();

      serverState.client = client;
      serverState.status = "connected";

      // Reset reconnect state on successful connection
      const rState = reconnectState.get(name);
      if (rState) {
        rState.attempts = 0;
        if (rState.timer) {
          clearTimeout(rState.timer);
          rState.timer = null;
        }
      }

      // Fetch available tools and resources
      if (client.getCapabilities().tools) {
        serverState.tools = await client.listTools();
      }
      if (client.getCapabilities().resources) {
        serverState.resources = await client.listResources();
      }

      serverState.lastSync = Date.now();
      events.onConnect?.(name);
    } catch (error) {
      serverState.status = "error";
      serverState.error = error instanceof Error ? error : new Error(String(error));
      events.onError?.(name, serverState.error);

      if (autoReconnect) {
        const rState = reconnectState.get(name);
        if (rState && rState.attempts < rState.maxAttempts) {
          rState.attempts++;
          // Exponential backoff with jitter, capped at 60s
          const delay = Math.min(
            rState.baseDelay * Math.pow(2, rState.attempts - 1) + Math.random() * 1000,
            60000
          );
          rState.timer = setTimeout(() => {
            rState.timer = null;
            connectServer(name).catch(() => {}); // Error handled in next iteration
          }, delay);
        } else if (rState) {
          console.error(
            `[Directive MCP] Max reconnect attempts (${rState.maxAttempts}) reached for server '${name}'. ` +
            `Call adapter.connectServer("${name}") to retry manually.`
          );
        }
      }

      throw serverState.error;
    }
  }

  // Disconnect from a server
  async function disconnectServer(name: string): Promise<void> {
    // Clear any pending reconnect timer
    const rState = reconnectState.get(name);
    if (rState?.timer) {
      clearTimeout(rState.timer);
      rState.timer = null;
      rState.attempts = 0;
    }

    const serverState = state.servers.get(name);
    if (!serverState || !serverState.client) {
      return;
    }

    try {
      await serverState.client.disconnect();
    } finally {
      serverState.status = "disconnected";
      serverState.client = null;
      events.onDisconnect?.(name);
    }
  }

  // Call a tool with constraint checking
  async function callToolWithConstraints(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    facts: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const serverState = state.servers.get(server);
    if (!serverState) {
      throw new Error(
        `[Directive MCP] Unknown server '${server}'. ` +
        `Available servers: ${Array.from(state.servers.keys()).join(", ") || "(none)"}`
      );
    }
    if (!serverState.client) {
      throw new Error(
        `[Directive MCP] Server '${server}' is not connected. ` +
        `Call 'adapter.connect()' or 'adapter.connectServer("${server}")' first.`
      );
    }

    const constraintKey = `${server}.${tool}`;
    const constraint = state.toolConstraints.get(constraintKey);

    // Check constraints
    if (constraint) {
      // Check rate limit
      if (constraint.rateLimit) {
        const limiter = state.rateLimiters.get(constraintKey);
        if (!checkRateLimit(state.rateLimiters, constraintKey, constraint.rateLimit)) {
          const resetAt = limiter?.resetTime ? new Date(limiter.resetTime).toISOString() : "unknown";
          throw new Error(
            `[Directive MCP] Rate limit exceeded for '${constraintKey}': ` +
            `${limiter?.count ?? 0}/${constraint.rateLimit} requests per minute. ` +
            `Resets at ${resetAt}.`
          );
        }
      }

      // Check max arg size
      if (constraint.maxArgSize) {
        const argSize = JSON.stringify(args).length;
        if (argSize > constraint.maxArgSize) {
          throw new Error(`Arguments exceed max size (${argSize} > ${constraint.maxArgSize})`);
        }
      }

      // Check custom constraint
      if (constraint.when) {
        const allowed = await constraint.when(facts, args);
        if (!allowed) {
          throw new Error(`Constraint not satisfied for ${constraintKey}`);
        }
      }

      // Check if approval is required
      if (constraint.requireApproval) {
        const requestId = `approval-${++approvalCounter}-${Date.now()}`;
        const approvalRequest: MCPApprovalRequest = {
          id: requestId,
          server,
          tool,
          args,
          requestedAt: Date.now(),
        };

        state.pendingApprovals.set(requestId, approvalRequest);
        events.onApprovalRequest?.(approvalRequest);

        // Wait for approval or rejection
        await waitForApproval(requestId);
      }
    }

    events.onToolCall?.(server, tool, args);

    // Call the tool
    const result = await Promise.race([
      serverState.client.callTool(tool, args),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool call timeout: ${constraintKey}`)),
          constraint?.timeout ?? 30000
        )
      ),
    ]);

    events.onToolResult?.(server, tool, result);

    return result;
  }

  // Create plugin
  const plugin: Plugin = {
    name: "mcp-adapter",

    onInit: async () => {
      if (autoConnect) {
        await Promise.all(
          Array.from(state.servers.keys()).map((name) =>
            connectServer(name).catch((e) => console.error(`Failed to connect to ${name}:`, e))
          )
        );
      }
    },

    onDestroy: async () => {
      // Clear all reconnect timers
      for (const rState of reconnectState.values()) {
        if (rState.timer) {
          clearTimeout(rState.timer);
          rState.timer = null;
        }
      }

      // Reject all pending approval waiters
      for (const [, waiter] of approvalWaiters) {
        clearTimeout(waiter.timeoutId);
        waiter.reject(new Error("[Directive MCP] Adapter destroyed while awaiting approval"));
      }
      approvalWaiters.clear();

      await Promise.all(
        Array.from(state.servers.keys()).map((name) =>
          disconnectServer(name).catch((e) => console.error(`Failed to disconnect from ${name}:`, e))
        )
      );
    },
  };

  // Sync resources to facts
  async function syncResources(facts: Record<string, unknown>): Promise<void> {
    for (const mapping of resourceMappings) {
      for (const [serverName, serverState] of state.servers) {
        if (!serverState.client) continue;

        for (const resource of serverState.resources) {
          // Check if resource matches pattern
          const matches =
            typeof mapping.pattern === "string"
              ? matchGlob(resource.uri, mapping.pattern)
              : mapping.pattern.test(resource.uri);

          if (matches) {
            try {
              const result = await serverState.client.readResource(resource.uri);
              const content = result.contents[0]?.text ?? "";
              const value = mapping.transform ? mapping.transform(content) : content;

              facts[mapping.factKey] = value;
              events.onResourceUpdate?.(serverName, resource.uri, result);
            } catch (error) {
              console.error(`Failed to sync resource ${resource.uri}:`, error);
            }
          }
        }
      }
    }
  }

  return {
    plugin,

    async connect() {
      await Promise.all(Array.from(state.servers.keys()).map(connectServer));
    },

    connectServer,

    async disconnect() {
      await Promise.all(Array.from(state.servers.keys()).map(disconnectServer));
    },

    disconnectServer,

    getTools() {
      const tools = new Map<string, MCPTool[]>();
      for (const [name, serverState] of state.servers) {
        tools.set(name, serverState.tools);
      }
      return tools;
    },

    getResources() {
      const resources = new Map<string, MCPResource[]>();
      for (const [name, serverState] of state.servers) {
        resources.set(name, serverState.resources);
      }
      return resources;
    },

    async callTool(server, tool, args, facts) {
      return callToolWithConstraints(server, tool, args, facts);
    },

    async callToolDirect(server, tool, args) {
      const serverState = state.servers.get(server);
      if (!serverState) {
        throw new Error(
          `[Directive MCP] Unknown server '${server}'. ` +
          `Available servers: ${Array.from(state.servers.keys()).join(", ") || "(none)"}`
        );
      }
      if (!serverState.client) {
        throw new Error(
          `[Directive MCP] Server '${server}' is not connected. ` +
          `Call 'adapter.connect()' or 'adapter.connectServer("${server}")' first.`
        );
      }
      events.onToolCall?.(server, tool, args);
      const result = await serverState.client.callTool(tool, args);
      events.onToolResult?.(server, tool, result);
      return result;
    },

    async readResource(server, uri) {
      const serverState = state.servers.get(server);
      if (!serverState) {
        throw new Error(
          `[Directive MCP] Unknown server '${server}'. ` +
          `Available servers: ${Array.from(state.servers.keys()).join(", ") || "(none)"}`
        );
      }
      if (!serverState.client) {
        throw new Error(
          `[Directive MCP] Server '${server}' is not connected. ` +
          `Call 'adapter.connect()' or 'adapter.connectServer("${server}")' first.`
        );
      }
      const result = await serverState.client.readResource(uri);
      events.onResourceUpdate?.(server, uri, result);
      return result;
    },

    syncResources,

    getServerStatus(name) {
      return state.servers.get(name);
    },

    getAllServerStatuses() {
      return new Map(state.servers);
    },

    approve(requestId: string) {
      const request = state.pendingApprovals.get(requestId);
      if (!request && !approvalWaiters.has(requestId)) {
        throw new Error(
          `[Directive MCP] No pending approval request with ID '${requestId}'. ` +
          `Pending requests: ${Array.from(state.pendingApprovals.keys()).join(", ") || "(none)"}`
        );
      }
      resolveApproval(requestId, true);
    },

    reject(requestId: string, reason?: string) {
      const request = state.pendingApprovals.get(requestId);
      if (!request && !approvalWaiters.has(requestId)) {
        throw new Error(
          `[Directive MCP] No pending approval request with ID '${requestId}'. ` +
          `Pending requests: ${Array.from(state.pendingApprovals.keys()).join(", ") || "(none)"}`
        );
      }
      resolveApproval(requestId, false, reason);
    },

    getPendingApprovals() {
      return Array.from(state.pendingApprovals.values());
    },

    getRejectionReason(requestId: string): string | undefined {
      return rejectionReasons.get(requestId);
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Cache for compiled glob patterns to avoid repeated regex compilation */
const globCache = new Map<string, RegExp>();
const MAX_GLOB_CACHE_SIZE = 200;

/** Simple glob matching (supports * and **) with caching */
function matchGlob(str: string, pattern: string): boolean {
  let regex = globCache.get(pattern);
  if (!regex) {
    // Escape all regex metacharacters first, then convert glob wildcards
    const regexPattern = pattern
      .replace(/\*\*/g, "\0GLOBSTAR\0")
      .replace(/\*/g, "\0STAR\0")
      .replace(/\?/g, "\0QUESTION\0")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\0GLOBSTAR\0/g, ".*")
      .replace(/\0STAR\0/g, "[^/]*")
      .replace(/\0QUESTION\0/g, ".");
    regex = new RegExp(`^${regexPattern}$`);

    // LRU eviction: delete oldest entry when cache is full
    if (globCache.size >= MAX_GLOB_CACHE_SIZE) {
      const firstKey = globCache.keys().next().value;
      if (firstKey !== undefined) globCache.delete(firstKey);
    }
    globCache.set(pattern, regex);
  }
  return regex.test(str);
}

/**
 * Convert MCP tools to a format suitable for LLM tool calling.
 *
 * @example
 * ```typescript
 * const adapter = createMCPAdapter({ servers: [...] });
 * await adapter.connect();
 *
 * const tools = adapter.getTools();
 * const llmTools = convertToolsForLLM(tools);
 * // Use with OpenAI/Anthropic/etc.
 * ```
 */
export function convertToolsForLLM(
  tools: Map<string, MCPTool[]>
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  const result: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> = [];

  for (const [server, serverTools] of tools) {
    for (const tool of serverTools) {
      result.push({
        type: "function",
        function: {
          name: `${server}.${tool.name}`,
          description: tool.description ?? `Tool: ${tool.name}`,
          parameters: tool.inputSchema,
        },
      });
    }
  }

  return result;
}

/**
 * Create a requirement to call an MCP tool.
 *
 * @example
 * ```typescript
 * const req = mcpCallTool('filesystem', 'read_file', { path: '/etc/hosts' });
 * // { type: 'MCP_CALL_TOOL', server: 'filesystem', tool: 'read_file', args: { path: '/etc/hosts' } }
 * ```
 */
export function mcpCallTool(
  server: string,
  tool: string,
  args: Record<string, unknown>
): MCPCallToolRequirement {
  return { type: "MCP_CALL_TOOL", server, tool, args };
}

/**
 * Create a requirement to read an MCP resource.
 */
export function mcpReadResource(server: string, uri: string): MCPReadResourceRequirement {
  return { type: "MCP_READ_RESOURCE", server, uri };
}

/**
 * Create a requirement to get an MCP prompt.
 */
export function mcpGetPrompt(
  server: string,
  prompt: string,
  args?: Record<string, string>
): MCPGetPromptRequirement {
  return { type: "MCP_GET_PROMPT", server, prompt, args };
}

/**
 * Create a requirement to sync MCP resources.
 */
export function mcpSyncResources(
  server?: string,
  pattern?: string | RegExp
): MCPSyncResourcesRequirement {
  return { type: "MCP_SYNC_RESOURCES", server, pattern };
}

// Re-export types
export * from "./mcp-types.js";
