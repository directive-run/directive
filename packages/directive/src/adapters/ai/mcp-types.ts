/**
 * MCP Type Definitions
 *
 * Model Context Protocol types for Directive integration.
 * These types are compatible with the MCP specification but don't require
 * the MCP SDK as a dependency.
 *
 * @see https://modelcontextprotocol.io/
 */

// ============================================================================
// Core MCP Types
// ============================================================================

/** MCP Transport type */
export type MCPTransport = "stdio" | "sse" | "websocket";

/** MCP Server connection configuration */
export interface MCPServerConfig {
  /** Unique name for this server */
  name: string;
  /** Transport protocol */
  transport: MCPTransport;
  /** For stdio: command to run */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For stdio: environment variables */
  env?: Record<string, string>;
  /** For sse/websocket: URL to connect to */
  url?: string;
  /** Optional authentication */
  auth?: {
    type: "bearer" | "api-key" | "oauth";
    token?: string;
    apiKey?: string;
  };
  /** Connection timeout (ms) */
  timeout?: number;
  /** Retry configuration */
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
}

/** MCP Tool definition */
export interface MCPTool {
  /** Tool name (must be unique within server) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** JSON Schema for tool input */
  inputSchema: MCPJsonSchema;
}

/** MCP Resource definition */
export interface MCPResource {
  /** Resource URI */
  uri: string;
  /** Human-readable name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type */
  mimeType?: string;
}

/** MCP Prompt definition */
export interface MCPPrompt {
  /** Prompt name */
  name: string;
  /** Prompt description */
  description?: string;
  /** Arguments the prompt accepts */
  arguments?: MCPPromptArgument[];
}

/** MCP Prompt argument */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** JSON Schema type (subset used by MCP) */
export interface MCPJsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, MCPJsonSchema>;
  required?: string[];
  items?: MCPJsonSchema;
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

// ============================================================================
// MCP Client Types
// ============================================================================

/** Result from calling an MCP tool */
export interface MCPToolResult {
  /** Tool output content */
  content: MCPContent[];
  /** Whether the tool call failed */
  isError?: boolean;
}

/** MCP Content types */
export type MCPContent =
  | MCPTextContent
  | MCPImageContent
  | MCPResourceContent;

/** Text content */
export interface MCPTextContent {
  type: "text";
  text: string;
}

/** Image content */
export interface MCPImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** Resource reference content */
export interface MCPResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

/** Result from reading an MCP resource */
export interface MCPResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

/** Result from getting an MCP prompt */
export interface MCPPromptResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: MCPContent;
  }>;
}

// ============================================================================
// MCP Client Interface
// ============================================================================

/** MCP Client capabilities */
export interface MCPCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  sampling?: boolean;
  logging?: boolean;
}

/** MCP Client interface (for custom implementations) */
export interface MCPClient {
  /** Connect to the server */
  connect(): Promise<void>;
  /** Disconnect from the server */
  disconnect(): Promise<void>;
  /** Check if connected */
  isConnected(): boolean;
  /** Get server capabilities */
  getCapabilities(): MCPCapabilities;

  // Tools
  /** List available tools */
  listTools(): Promise<MCPTool[]>;
  /** Call a tool */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;

  // Resources
  /** List available resources */
  listResources(): Promise<MCPResource[]>;
  /** Read a resource */
  readResource(uri: string): Promise<MCPResourceResult>;
  /** Subscribe to resource changes */
  subscribeResource?(uri: string, callback: (resource: MCPResource) => void): () => void;

  // Prompts
  /** List available prompts */
  listPrompts(): Promise<MCPPrompt[]>;
  /** Get a prompt with arguments */
  getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptResult>;
}

// ============================================================================
// Directive Integration Types
// ============================================================================

/** Constraint configuration for an MCP tool */
export interface MCPToolConstraint {
  /** Require human approval before calling */
  requireApproval?: boolean;
  /** Maximum argument size (bytes) */
  maxArgSize?: number;
  /** Constraint that must be true to allow the tool */
  when?: (facts: Record<string, unknown>, args: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Requirement to emit when constraint is violated */
  require?: { type: string; [key: string]: unknown };
  /** Rate limit (calls per minute) */
  rateLimit?: number;
  /** Timeout for tool execution (ms) */
  timeout?: number;
}

/** Mapping of MCP resources to Directive facts */
export interface MCPResourceMapping {
  /** Resource URI pattern (glob or regex) */
  pattern: string | RegExp;
  /** Fact key to sync to */
  factKey: string;
  /** Transform resource content before setting fact */
  transform?: (content: string) => unknown;
  /** Sync mode */
  mode: "poll" | "subscribe" | "manual";
  /** Poll interval (ms) for 'poll' mode */
  pollInterval?: number;
}

/** MCP Approval request */
export interface MCPApprovalRequest {
  id: string;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  requestedAt: number;
}

/** MCP Adapter events */
export interface MCPAdapterEvents {
  /** Server connected */
  onConnect?: (server: string) => void;
  /** Server disconnected */
  onDisconnect?: (server: string, reason?: string) => void;
  /** Tool called */
  onToolCall?: (server: string, tool: string, args: Record<string, unknown>) => void;
  /** Tool result received */
  onToolResult?: (server: string, tool: string, result: MCPToolResult) => void;
  /** Resource updated */
  onResourceUpdate?: (server: string, uri: string, content: MCPResourceResult) => void;
  /** Error occurred */
  onError?: (server: string, error: Error) => void;
  /** Approval required for tool call */
  onApprovalRequest?: (request: MCPApprovalRequest) => void;
  /** Approval resolved */
  onApprovalResolved?: (requestId: string, approved: boolean) => void;
}

/** MCP Adapter configuration */
export interface MCPAdapterConfig {
  /** MCP servers to connect to */
  servers: MCPServerConfig[];
  /** Tool-specific constraints */
  toolConstraints?: Record<string, MCPToolConstraint>;
  /** Resource to fact mappings */
  resourceMappings?: MCPResourceMapping[];
  /** Event handlers */
  events?: MCPAdapterEvents;
  /** Auto-connect on adapter creation */
  autoConnect?: boolean;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Custom MCP client factory (for testing or custom implementations) */
  clientFactory?: (config: MCPServerConfig) => MCPClient;
  /** Enable debug logging for stub client (default: false) */
  debug?: boolean;
  /** Approval timeout in milliseconds (default: 300000 = 5 minutes) */
  approvalTimeoutMs?: number;
}

// ============================================================================
// Directive Requirement Types for MCP
// ============================================================================

/** Requirement to call an MCP tool */
export interface MCPCallToolRequirement {
  type: "MCP_CALL_TOOL";
  server: string;
  tool: string;
  args: Record<string, unknown>;
  [key: string]: unknown;
}

/** Requirement to read an MCP resource */
export interface MCPReadResourceRequirement {
  type: "MCP_READ_RESOURCE";
  server: string;
  uri: string;
  [key: string]: unknown;
}

/** Requirement to get an MCP prompt */
export interface MCPGetPromptRequirement {
  type: "MCP_GET_PROMPT";
  server: string;
  prompt: string;
  args?: Record<string, string>;
  [key: string]: unknown;
}

/** Requirement to sync MCP resources */
export interface MCPSyncResourcesRequirement {
  type: "MCP_SYNC_RESOURCES";
  server?: string;
  pattern?: string | RegExp;
  [key: string]: unknown;
}

/** Union of all MCP requirements */
export type MCPRequirement =
  | MCPCallToolRequirement
  | MCPReadResourceRequirement
  | MCPGetPromptRequirement
  | MCPSyncResourcesRequirement;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a requirement is an MCP requirement */
export function isMCPRequirement(req: { type: string }): req is MCPRequirement {
  return req.type.startsWith("MCP_");
}

/** Check if a requirement is to call an MCP tool */
export function isMCPCallToolRequirement(req: { type: string }): req is MCPCallToolRequirement {
  return req.type === "MCP_CALL_TOOL";
}

/** Check if a requirement is to read an MCP resource */
export function isMCPReadResourceRequirement(req: { type: string }): req is MCPReadResourceRequirement {
  return req.type === "MCP_READ_RESOURCE";
}

/** Check if a requirement is to get an MCP prompt */
export function isMCPGetPromptRequirement(req: { type: string }): req is MCPGetPromptRequirement {
  return req.type === "MCP_GET_PROMPT";
}

/** Check if a requirement is to sync MCP resources */
export function isMCPSyncResourcesRequirement(req: { type: string }): req is MCPSyncResourcesRequirement {
  return req.type === "MCP_SYNC_RESOURCES";
}
