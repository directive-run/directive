import { describe, expect, it, vi } from "vitest";
import {
	estimateTokens,
	estimateTotalTokens,
	createSlidingWindowStrategy,
	createTokenBasedStrategy,
	createHybridStrategy,
	createAgentMemory,
	createTruncationSummarizer,
	createKeyPointsSummarizer,
	createLLMSummarizer,
	type Message,
} from "../adapters/openai-agents-memory.js";

// ============================================================================
// Token Estimation
// ============================================================================

describe("Token Estimation", () => {
	it("should estimate tokens using default heuristic (~4 chars/token)", () => {
		const tokens = estimateTokens({ role: "user", content: "Hello world" }); // 11 chars
		expect(tokens).toBe(Math.ceil(11 / 4));
	});

	it("should use custom tokenizer when provided", () => {
		const tokenizer = (text: string) => text.split(" ").length;
		const tokens = estimateTokens({ role: "user", content: "Hello world" }, tokenizer);
		expect(tokens).toBe(2);
	});

	it("should estimate total tokens for multiple messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello!" },
		];
		const total = estimateTotalTokens(messages);
		expect(total).toBe(Math.ceil(2 / 4) + Math.ceil(6 / 4));
	});
});

// ============================================================================
// Sliding Window Strategy
// ============================================================================

describe("Sliding Window Strategy", () => {
	const makeMessages = (count: number): Message[] =>
		Array.from({ length: count }, (_, i) => ({
			role: "user" as const,
			content: `Message ${i}`,
		}));

	it("should keep all messages when under limit", () => {
		const strategy = createSlidingWindowStrategy({ maxMessages: 10 });
		const messages = makeMessages(5);
		const result = strategy(messages, {});

		expect(result.keep.length).toBe(5);
		expect(result.toSummarize.length).toBe(0);
	});

	it("should summarize oldest messages when over limit", () => {
		const strategy = createSlidingWindowStrategy({
			maxMessages: 5,
			preserveRecentCount: 3,
		});
		const messages = makeMessages(10);
		const result = strategy(messages, {});

		expect(result.keep.length).toBe(5);
		expect(result.toSummarize.length).toBe(5);
		// Recent 3 are always preserved
		expect(result.keep[4].content).toBe("Message 9");
		expect(result.keep[3].content).toBe("Message 8");
		expect(result.keep[2].content).toBe("Message 7");
	});

	it("should respect config override", () => {
		const strategy = createSlidingWindowStrategy({ maxMessages: 100 });
		const messages = makeMessages(10);
		// Override with maxMessages: 7, preserveRecentCount: 3
		const result = strategy(messages, { maxMessages: 7, preserveRecentCount: 3 });

		expect(result.keep.length).toBe(7);
		expect(result.toSummarize.length).toBe(3);
	});
});

// ============================================================================
// Token-Based Strategy
// ============================================================================

describe("Token-Based Strategy", () => {
	it("should keep messages within token budget", () => {
		const strategy = createTokenBasedStrategy({
			maxTokens: 10,
			preserveRecentCount: 2,
		});

		const messages: Message[] = [
			{ role: "user", content: "A".repeat(40) }, // 10 tokens
			{ role: "user", content: "B".repeat(40) }, // 10 tokens
			{ role: "user", content: "C".repeat(8) }, // 2 tokens
			{ role: "user", content: "D".repeat(8) }, // 2 tokens
		];

		const result = strategy(messages, {});

		// Recent 2 (C and D) = 4 tokens. Remaining budget = 6 tokens.
		// B = 10 tokens, won't fit. A = 10 tokens, won't fit.
		expect(result.keep.length).toBe(2); // Only recent 2 fit
		expect(result.toSummarize.length).toBe(2);
	});

	it("should skip system messages from token count when configured", () => {
		const strategy = createTokenBasedStrategy({
			maxTokens: 5,
			preserveRecentCount: 1,
			countSystemMessages: false,
		});

		const messages: Message[] = [
			{ role: "system", content: "A".repeat(100) }, // Excluded from count
			{ role: "user", content: "B".repeat(8) }, // 2 tokens
			{ role: "user", content: "C".repeat(8) }, // 2 tokens (recent)
		];

		const result = strategy(messages, {});
		// Recent = C (2 tokens). Budget left = 3. B (2 tokens) fits. System excluded.
		expect(result.keep.length).toBe(3);
	});
});

// ============================================================================
// Hybrid Strategy
// ============================================================================

describe("Hybrid Strategy", () => {
	it("should use the more restrictive strategy", () => {
		const strategy = createHybridStrategy({
			maxMessages: 3,
			maxTokens: 1000, // Generous token budget
			preserveRecentCount: 2,
		});

		const messages: Message[] = Array.from({ length: 5 }, (_, i) => ({
			role: "user" as const,
			content: `Msg ${i}`,
		}));

		const result = strategy(messages, {});
		// Message count is more restrictive (3 vs all fit in token budget)
		expect(result.keep.length).toBe(3);
	});
});

// ============================================================================
// Agent Memory
// ============================================================================

describe("Agent Memory", () => {
	it("should add and retrieve messages", () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
		});

		memory.addMessage({ role: "user", content: "Hello" });
		memory.addMessage({ role: "assistant", content: "Hi there" });

		const state = memory.getState();
		expect(state.messages.length).toBe(2);
		expect(state.totalMessagesProcessed).toBe(2);
	});

	it("should add multiple messages at once", () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
		});

		memory.addMessages([
			{ role: "user", content: "Q1" },
			{ role: "assistant", content: "A1" },
			{ role: "user", content: "Q2" },
		]);

		expect(memory.getState().messages.length).toBe(3);
		expect(memory.getState().totalMessagesProcessed).toBe(3);
	});

	it("should track estimated tokens", () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
		});

		memory.addMessage({ role: "user", content: "Hello world" }); // ~3 tokens
		expect(memory.getState().estimatedTokens).toBeGreaterThan(0);
	});

	it("should manage memory and summarize", async () => {
		const summarizer = vi.fn(async () => "Summary of old messages");

		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({
				maxMessages: 3,
				preserveRecentCount: 2,
			}),
			summarizer,
		});

		for (let i = 0; i < 5; i++) {
			memory.addMessage({ role: "user", content: `Message ${i}` });
		}

		const result = await memory.manage();
		expect(result.messagesSummarized).toBeGreaterThan(0);
		expect(result.summary).toBe("Summary of old messages");
		expect(summarizer).toHaveBeenCalled();

		const state = memory.getState();
		expect(state.summaries.length).toBe(1);
		expect(state.summaries[0].content).toBe("Summary of old messages");
	});

	it("should include summaries in context messages", async () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 3, preserveRecentCount: 2 }),
			summarizer: async () => "Previous conversation summary",
		});

		for (let i = 0; i < 5; i++) {
			memory.addMessage({ role: "user", content: `Msg ${i}` });
		}

		await memory.manage();

		const context = memory.getContextMessages();
		expect(context[0].role).toBe("system");
		expect(context[0].content).toContain("Previous conversation summary");
	});

	it("should prevent concurrent management", async () => {
		let resolveFirst: (() => void) | undefined;
		const summarizer = vi.fn(
			() => new Promise<string>((resolve) => {
				resolveFirst = () => resolve("summary");
			})
		);

		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 3, preserveRecentCount: 2 }),
			summarizer,
		});

		for (let i = 0; i < 5; i++) {
			memory.addMessage({ role: "user", content: `Msg ${i}` });
		}

		const first = memory.manage();
		expect(memory.isManaging()).toBe(true);

		const second = await memory.manage();
		expect(second.messagesSummarized).toBe(0); // Skipped due to concurrent management

		resolveFirst!();
		await first;
	});

	it("should clear memory", () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
		});

		memory.addMessage({ role: "user", content: "Hello" });
		memory.clear();

		const state = memory.getState();
		expect(state.messages.length).toBe(0);
		expect(state.totalMessagesProcessed).toBe(0);
	});

	it("should export and import state with deep copies", () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
		});

		memory.addMessage({ role: "user", content: "Hello" });
		const exported = memory.export();

		// Mutating export should not affect internal state
		exported.messages.push({ role: "user", content: "Extra" });
		expect(memory.getState().messages.length).toBe(1);

		// Import into new memory
		const memory2 = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
		});
		memory2.import(exported);

		// Mutating imported state should not affect memory2
		exported.messages.push({ role: "user", content: "Another" });
		expect(memory2.getState().messages.length).toBe(2); // "Hello" + "Extra"
	});

	it("should auto-manage when configured", async () => {
		const onManaged = vi.fn();
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy({ maxMessages: 3, preserveRecentCount: 2 }),
			summarizer: async () => "auto summary",
			autoManage: true,
			onMemoryManaged: onManaged,
		});

		for (let i = 0; i < 5; i++) {
			memory.addMessage({ role: "user", content: `Msg ${i}` });
		}

		// Auto-manage is async, wait for it
		await new Promise((r) => setTimeout(r, 50));
		expect(onManaged).toHaveBeenCalled();
	});
});

// ============================================================================
// Built-in Summarizers
// ============================================================================

describe("Summarizers", () => {
	it("createTruncationSummarizer should truncate long content", async () => {
		const summarizer = createTruncationSummarizer(50);
		const messages: Message[] = [
			{ role: "user", content: "A".repeat(200) },
			{ role: "assistant", content: "B".repeat(200) },
		];

		const result = await summarizer(messages);
		// 50 chars + "\n[truncated]" (12 chars) = 62
		expect(result.length).toBeLessThanOrEqual(62);
		expect(result).toContain("[truncated]");
	});

	it("createTruncationSummarizer should not truncate short content", async () => {
		const summarizer = createTruncationSummarizer(500);
		const messages: Message[] = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello" },
		];

		const result = await summarizer(messages);
		expect(result).not.toContain("[truncated]");
	});

	it("createTruncationSummarizer should skip system messages", async () => {
		const summarizer = createTruncationSummarizer(500);
		const messages: Message[] = [
			{ role: "system", content: "You are helpful" },
			{ role: "user", content: "Hi" },
		];

		const result = await summarizer(messages);
		expect(result).not.toContain("system");
		expect(result).toContain("user");
	});

	it("createKeyPointsSummarizer should extract questions", async () => {
		const summarizer = createKeyPointsSummarizer();
		const messages: Message[] = [
			{ role: "user", content: "What is TypeScript? How does it work?" },
			{ role: "assistant", content: "TypeScript is a superset of JavaScript." },
		];

		const result = await summarizer(messages);
		expect(result).toContain("What is TypeScript?");
		expect(result).toContain("How does it work?");
	});

	it("createKeyPointsSummarizer should handle no questions", async () => {
		const summarizer = createKeyPointsSummarizer();
		const messages: Message[] = [
			{ role: "user", content: "Do this." },
			{ role: "assistant", content: "Done." },
		];

		const result = await summarizer(messages);
		expect(result).toContain("no key questions found");
	});

	it("createLLMSummarizer should call the LLM function", async () => {
		const llmCall = vi.fn(async () => "LLM summary here");
		const summarizer = createLLMSummarizer(llmCall);

		const messages: Message[] = [
			{ role: "user", content: "Tell me about AI" },
			{ role: "assistant", content: "AI is fascinating" },
		];

		const result = await summarizer(messages);
		expect(result).toBe("LLM summary here");
		expect(llmCall).toHaveBeenCalledOnce();
		expect(llmCall.mock.calls[0][0]).toContain("Summarize");
		expect(llmCall.mock.calls[0][0]).toContain("Tell me about AI");
	});
});
