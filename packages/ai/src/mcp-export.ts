/**
 * MCP (Model Context Protocol) subpath export.
 *
 * Tree-shakable entry for MCP client + types: connect to MCP servers,
 * call tools, read resources, fetch prompts, sync resources.
 *
 * @example
 * ```typescript
 * import { createMCPAdapter, mcpCallTool } from "@directive-run/ai/mcp";
 * ```
 */

export {
  createMCPAdapter,
  convertToolsForLLM,
  mcpCallTool,
  mcpReadResource,
  mcpGetPrompt,
  mcpSyncResources,
  type MCPAdapter,
} from "./mcp.js";

export type {
  MCPAdapterConfig,
  MCPTool,
  MCPToolResult,
  MCPToolConstraint,
  MCPServerConfig,
  MCPResource,
  MCPApprovalRequest,
  MCPCallToolRequirement,
  MCPReadResourceRequirement,
  MCPGetPromptRequirement,
  MCPSyncResourcesRequirement,
  MCPRequirement,
} from "./mcp-types.js";
