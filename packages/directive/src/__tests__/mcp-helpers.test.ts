import { describe, expect, it } from "vitest";
import {
	convertToolsForLLM,
	mcpCallTool,
	mcpReadResource,
	mcpGetPrompt,
	mcpSyncResources,
} from "../adapters/ai/mcp.js";

// ============================================================================
// Requirement Factory Functions
// ============================================================================

describe("MCP Requirement Factories", () => {
	it("mcpCallTool should create correct requirement", () => {
		const req = mcpCallTool("filesystem", "read_file", { path: "/etc/hosts" });

		expect(req).toEqual({
			type: "MCP_CALL_TOOL",
			server: "filesystem",
			tool: "read_file",
			args: { path: "/etc/hosts" },
		});
	});

	it("mcpReadResource should create correct requirement", () => {
		const req = mcpReadResource("github", "repo://main/README.md");

		expect(req).toEqual({
			type: "MCP_READ_RESOURCE",
			server: "github",
			uri: "repo://main/README.md",
		});
	});

	it("mcpGetPrompt should create correct requirement", () => {
		const req = mcpGetPrompt("prompts", "summarize", { style: "brief" });

		expect(req).toEqual({
			type: "MCP_GET_PROMPT",
			server: "prompts",
			prompt: "summarize",
			args: { style: "brief" },
		});
	});

	it("mcpGetPrompt should work without args", () => {
		const req = mcpGetPrompt("prompts", "default");

		expect(req).toEqual({
			type: "MCP_GET_PROMPT",
			server: "prompts",
			prompt: "default",
			args: undefined,
		});
	});

	it("mcpSyncResources should create correct requirement", () => {
		const req = mcpSyncResources("github", "*.json");

		expect(req).toEqual({
			type: "MCP_SYNC_RESOURCES",
			server: "github",
			pattern: "*.json",
		});
	});

	it("mcpSyncResources should work without args", () => {
		const req = mcpSyncResources();

		expect(req).toEqual({
			type: "MCP_SYNC_RESOURCES",
			server: undefined,
			pattern: undefined,
		});
	});

	it("mcpSyncResources should accept RegExp pattern", () => {
		const req = mcpSyncResources("fs", /\.json$/);

		expect(req.type).toBe("MCP_SYNC_RESOURCES");
		expect(req.pattern).toBeInstanceOf(RegExp);
	});
});

// ============================================================================
// convertToolsForLLM
// ============================================================================

describe("convertToolsForLLM", () => {
	it("should convert tools map to LLM function format", () => {
		const tools = new Map([
			[
				"filesystem",
				[
					{
						name: "read_file",
						description: "Read a file",
						inputSchema: {
							type: "object",
							properties: { path: { type: "string" } },
						},
					},
					{
						name: "write_file",
						description: "Write a file",
						inputSchema: {
							type: "object",
							properties: {
								path: { type: "string" },
								content: { type: "string" },
							},
						},
					},
				],
			],
		]);

		const result = convertToolsForLLM(tools);

		expect(result.length).toBe(2);
		expect(result[0]).toEqual({
			type: "function",
			function: {
				name: "filesystem.read_file",
				description: "Read a file",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
				},
			},
		});
	});

	it("should namespace tool names with server prefix", () => {
		const tools = new Map([
			["server1", [{ name: "tool1", inputSchema: {} }]],
			["server2", [{ name: "tool1", inputSchema: {} }]],
		]);

		const result = convertToolsForLLM(tools);
		expect(result.length).toBe(2);
		expect(result[0].function.name).toBe("server1.tool1");
		expect(result[1].function.name).toBe("server2.tool1");
	});

	it("should use default description when not provided", () => {
		const tools = new Map([
			["server", [{ name: "my_tool", inputSchema: {} }]],
		]);

		const result = convertToolsForLLM(tools);
		expect(result[0].function.description).toBe("Tool: my_tool");
	});

	it("should handle empty tools map", () => {
		const result = convertToolsForLLM(new Map());
		expect(result).toEqual([]);
	});

	it("should handle servers with no tools", () => {
		const tools = new Map([["empty-server", []]]);
		const result = convertToolsForLLM(tools);
		expect(result).toEqual([]);
	});
});
