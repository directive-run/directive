import { describe, expect, it, vi } from "vitest";
import {
  createAgentMemory,
  createHybridStrategy,
  createKeyPointsSummarizer,
  createLLMSummarizer,
  createSlidingWindowStrategy,
  createTokenBasedStrategy,
  createTruncationSummarizer,
  estimateTokens,
  estimateTotalTokens,
} from "../memory.js";
import type { Message } from "../memory.js";

// ============================================================================
// Helpers
// ============================================================================

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

function msgs(count: number, prefix = "msg"): Message[] {
  return Array.from({ length: count }, (_, i) =>
    msg("user", `${prefix}-${i}`),
  );
}

// ============================================================================
// estimateTokens / estimateTotalTokens
// ============================================================================

describe("estimateTokens", () => {
  it("estimates tokens using default heuristic (~4 chars per token)", () => {
    const tokens = estimateTokens(msg("user", "Hello world!"));
    // "Hello world!" = 12 chars → ceil(12/4) = 3
    expect(tokens).toBe(3);
  });

  it("uses custom tokenizer when provided", () => {
    const tokenizer = vi.fn(() => 42);
    const tokens = estimateTokens(msg("user", "anything"), tokenizer);
    expect(tokens).toBe(42);
    expect(tokenizer).toHaveBeenCalledWith("anything");
  });
});

describe("estimateTotalTokens", () => {
  it("sums token estimates across messages", () => {
    const messages = [
      msg("user", "abcd"), // 4 chars → 1 token
      msg("assistant", "abcdefgh"), // 8 chars → 2 tokens
    ];
    expect(estimateTotalTokens(messages)).toBe(3);
  });

  it("passes custom tokenizer to each message", () => {
    const tokenizer = vi.fn(() => 10);
    const total = estimateTotalTokens(msgs(3), tokenizer);
    expect(total).toBe(30);
    expect(tokenizer).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// createSlidingWindowStrategy
// ============================================================================

describe("createSlidingWindowStrategy", () => {
  it("keeps all messages when under maxMessages", () => {
    const strategy = createSlidingWindowStrategy({ maxMessages: 10 });
    const result = strategy(msgs(5), {});
    expect(result.keep).toHaveLength(5);
    expect(result.toSummarize).toHaveLength(0);
  });

  it("trims oldest messages when over maxMessages", () => {
    const strategy = createSlidingWindowStrategy({
      maxMessages: 5,
      preserveRecentCount: 3,
    });
    const messages = msgs(10);
    const result = strategy(messages, {});
    expect(result.keep).toHaveLength(5);
    expect(result.toSummarize).toHaveLength(5);
    // Kept = 2 older + 3 recent
    expect(result.keep.map((m) => m.content)).toEqual([
      "msg-5",
      "msg-6",
      "msg-7",
      "msg-8",
      "msg-9",
    ]);
  });

  it("always preserves preserveRecentCount most recent messages", () => {
    const strategy = createSlidingWindowStrategy({
      maxMessages: 4,
      preserveRecentCount: 3,
    });
    const messages = msgs(8);
    const result = strategy(messages, {});
    // Recent 3 always kept, plus 1 more older to reach maxMessages=4
    const keptContents = result.keep.map((m) => m.content);
    expect(keptContents).toContain("msg-7");
    expect(keptContents).toContain("msg-6");
    expect(keptContents).toContain("msg-5");
    expect(result.keep).toHaveLength(4);
  });

  it("allows config override at call time", () => {
    const strategy = createSlidingWindowStrategy({
      maxMessages: 100,
      preserveRecentCount: 2,
    });
    const result = strategy(msgs(10), { maxMessages: 5 });
    expect(result.keep).toHaveLength(5);
    expect(result.toSummarize).toHaveLength(5);
  });
});

// ============================================================================
// createTokenBasedStrategy
// ============================================================================

describe("createTokenBasedStrategy", () => {
  it("keeps all messages when under token limit", () => {
    const strategy = createTokenBasedStrategy({ maxTokens: 10000 });
    const result = strategy(msgs(3), {});
    expect(result.keep).toHaveLength(3);
    expect(result.toSummarize).toHaveLength(0);
  });

  it("trims oldest messages when tokens exceed limit", () => {
    // Each "x".repeat(40) message = 40 chars → 10 tokens
    const messages = Array.from({ length: 10 }, () =>
      msg("user", "x".repeat(40)),
    );
    const strategy = createTokenBasedStrategy({
      maxTokens: 50,
      preserveRecentCount: 2,
    });
    const result = strategy(messages, {});
    // Recent 2 = 20 tokens, room for 3 more older = 50 tokens total
    expect(result.keep.length).toBeLessThanOrEqual(5);
    expect(result.toSummarize.length).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThanOrEqual(50);
  });

  it("always preserves preserveRecentCount messages", () => {
    const messages = Array.from({ length: 10 }, () =>
      msg("user", "x".repeat(40)),
    );
    const strategy = createTokenBasedStrategy({
      maxTokens: 20, // Only room for recent messages
      preserveRecentCount: 2,
    });
    const result = strategy(messages, {});
    // The 2 most recent must always be kept
    expect(result.keep.length).toBeGreaterThanOrEqual(2);
    const lastTwo = messages.slice(-2);
    expect(result.keep.slice(-2)).toEqual(lastTwo);
  });

  it("excludes system messages from token count when countSystemMessages is false", () => {
    const messages = [
      msg("system", "x".repeat(400)), // 100 tokens if counted
      msg("user", "x".repeat(40)), // 10 tokens
      msg("user", "x".repeat(40)), // 10 tokens
      msg("user", "x".repeat(40)), // 10 tokens
      msg("user", "x".repeat(40)), // 10 tokens
      msg("user", "x".repeat(40)), // 10 tokens
      msg("user", "x".repeat(40)), // 10 tokens
    ];
    const strategy = createTokenBasedStrategy({
      maxTokens: 60,
      preserveRecentCount: 2,
      countSystemMessages: false,
    });
    const result = strategy(messages, {});
    // System message tokens not counted, so more messages fit
    expect(result.keep.some((m) => m.role === "system")).toBe(true);
  });
});

// ============================================================================
// createHybridStrategy
// ============================================================================

describe("createHybridStrategy", () => {
  it("picks the more restrictive strategy", () => {
    // maxMessages=100 is lenient, maxTokens=20 is restrictive
    const strategy = createHybridStrategy({
      maxMessages: 100,
      maxTokens: 20,
      preserveRecentCount: 2,
    });
    const messages = Array.from({ length: 10 }, () =>
      msg("user", "x".repeat(40)),
    );
    const result = strategy(messages, {});
    // Token-based should be more restrictive than sliding window
    expect(result.keep.length).toBeLessThan(10);
  });

  it("uses sliding window when it is more restrictive", () => {
    const strategy = createHybridStrategy({
      maxMessages: 3,
      maxTokens: 100000,
      preserveRecentCount: 2,
    });
    const messages = msgs(10);
    const result = strategy(messages, {});
    // Sliding window (3 messages) should be more restrictive than token-based
    expect(result.keep).toHaveLength(3);
  });
});

// ============================================================================
// createAgentMemory
// ============================================================================

describe("createAgentMemory", () => {
  it("adds and retrieves a single message", () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory.addMessage(msg("user", "hello"));
    const state = memory.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.totalMessagesProcessed).toBe(1);
  });

  it("adds multiple messages at once", () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory.addMessages(msgs(5));
    expect(memory.getState().messages).toHaveLength(5);
    expect(memory.getState().totalMessagesProcessed).toBe(5);
  });

  it("getState returns copies (mutations do not affect internal state)", () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory.addMessage(msg("user", "hello"));
    const state = memory.getState();
    state.messages.push(msg("user", "injected"));
    expect(memory.getState().messages).toHaveLength(1);
  });

  it("getContextMessages includes summaries as system messages", async () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
      summarizer: async () => "summary of old messages",
    });
    memory.addMessages(msgs(6));
    await memory.manage();

    const context = memory.getContextMessages();
    expect(context[0]!.role).toBe("system");
    expect(context[0]!.content).toContain("summary of old messages");
    // Remaining messages follow the summary
    expect(context.length).toBeGreaterThan(1);
  });

  it("manage() trims messages and calls summarizer", async () => {
    const summarizer = vi.fn(async () => "condensed");
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
      summarizer,
    });
    memory.addMessages(msgs(8));
    const result = await memory.manage();

    expect(result.messagesBefore).toBe(8);
    expect(result.messagesAfter).toBe(3);
    expect(result.messagesSummarized).toBeGreaterThan(0);
    expect(result.summary).toBe("condensed");
    expect(summarizer).toHaveBeenCalledOnce();
  });

  it("manage() without summarizer still trims but produces no summary", async () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
    });
    memory.addMessages(msgs(8));
    const result = await memory.manage();

    expect(result.messagesAfter).toBe(3);
    expect(result.summary).toBeUndefined();
    expect(memory.getState().summaries).toHaveLength(0);
  });

  it("manage() is a no-op when nothing to trim", async () => {
    const summarizer = vi.fn(async () => "nope");
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 100 }),
      summarizer,
    });
    memory.addMessages(msgs(3));
    const result = await memory.manage();

    expect(result.messagesSummarized).toBe(0);
    expect(summarizer).not.toHaveBeenCalled();
  });

  it("auto-manage triggers when messages exceed strategy threshold", async () => {
    const summarizer = vi.fn(async () => "auto-summary");
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
      summarizer,
      autoManage: true,
    });

    // Add enough messages to trigger auto-manage
    memory.addMessages(msgs(6));

    // Wait for the async manage() to settle
    await vi.waitFor(() => {
      expect(summarizer).toHaveBeenCalled();
    });
  });

  it("concurrent manage() calls are prevented (isManaging guard)", async () => {
    let resolveManage: () => void;
    const slowSummarizer = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveManage = () => resolve("done");
        }),
    );

    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
      summarizer: slowSummarizer,
    });
    memory.addMessages(msgs(8));

    const first = memory.manage();
    // Second call should be a no-op while first is in progress
    expect(memory.isManaging()).toBe(true);
    const second = await memory.manage();
    expect(second.messagesSummarized).toBe(0);

    resolveManage!();
    await first;
    expect(memory.isManaging()).toBe(false);
  });

  it("clear resets all state", () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory.addMessages(msgs(5));
    memory.clear();
    const state = memory.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.summaries).toHaveLength(0);
    expect(state.totalMessagesProcessed).toBe(0);
    expect(state.estimatedTokens).toBe(0);
  });

  it("export/import round-trip preserves state", () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory.addMessages(msgs(4));
    const exported = memory.export();

    const memory2 = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory2.import(exported);
    const state = memory2.getState();
    expect(state.messages).toHaveLength(4);
    expect(state.totalMessagesProcessed).toBe(4);
  });

  it("export returns copies (mutations do not affect internal state)", () => {
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 10 }),
    });
    memory.addMessage(msg("user", "hello"));
    const exported = memory.export();
    exported.messages.push(msg("user", "injected"));
    expect(memory.getState().messages).toHaveLength(1);
  });

  it("maxContextTokens triggers console.warn when exceeded", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({ maxMessages: 100 }),
      maxContextTokens: 5,
    });
    // Add a long message that exceeds 5 tokens
    memory.addMessage(msg("user", "x".repeat(100)));
    memory.getContextMessages();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceed maxContextTokens"),
    );
    warnSpy.mockRestore();
  });

  it("onMemoryManaged callback fires after manage()", async () => {
    const onManaged = vi.fn();
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
      summarizer: async () => "summary",
      onMemoryManaged: onManaged,
    });
    memory.addMessages(msgs(8));
    await memory.manage();

    expect(onManaged).toHaveBeenCalledOnce();
    expect(onManaged).toHaveBeenCalledWith(
      expect.objectContaining({
        messagesSummarized: expect.any(Number),
        summary: "summary",
      }),
    );
  });

  it("onManageError callback fires when auto-manage fails", async () => {
    const onError = vi.fn();
    const memory = createAgentMemory({
      strategy: createSlidingWindowStrategy({
        maxMessages: 3,
        preserveRecentCount: 2,
      }),
      summarizer: async () => {
        throw new Error("summarizer boom");
      },
      autoManage: true,
      onManageError: onError,
    });
    memory.addMessages(msgs(8));

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    expect(onError.mock.calls[0]![0]!.message).toBe("summarizer boom");
  });
});

// ============================================================================
// createTruncationSummarizer
// ============================================================================

describe("createTruncationSummarizer", () => {
  it("truncates content exceeding maxLength", async () => {
    const summarizer = createTruncationSummarizer(20);
    const result = await summarizer([
      msg("user", "a".repeat(200)),
      msg("assistant", "b".repeat(200)),
    ]);
    expect(result.length).toBeLessThanOrEqual(20 + "\n[truncated]".length);
    expect(result).toContain("[truncated]");
  });

  it("returns content unchanged when short enough", async () => {
    const summarizer = createTruncationSummarizer(5000);
    const result = await summarizer([msg("user", "hello")]);
    expect(result).toBe("user: hello");
    expect(result).not.toContain("[truncated]");
  });

  it("filters out system messages", async () => {
    const summarizer = createTruncationSummarizer(5000);
    const result = await summarizer([
      msg("system", "you are a bot"),
      msg("user", "hello"),
    ]);
    expect(result).not.toContain("system");
    expect(result).toBe("user: hello");
  });
});

// ============================================================================
// createKeyPointsSummarizer
// ============================================================================

describe("createKeyPointsSummarizer", () => {
  it("extracts questions from user messages", async () => {
    const summarizer = createKeyPointsSummarizer();
    const result = await summarizer([
      msg("user", "What is TypeScript? How does it work?"),
      msg("assistant", "TypeScript is a typed superset of JavaScript."),
    ]);
    expect(result).toContain("Key topics discussed:");
    expect(result).toContain("Q: What is TypeScript?");
    expect(result).toContain("Q: How does it work?");
  });

  it("returns fallback when no questions found", async () => {
    const summarizer = createKeyPointsSummarizer();
    const result = await summarizer([
      msg("user", "Tell me about TypeScript."),
      msg("assistant", "Sure, it is great."),
    ]);
    expect(result).toContain("no key questions found");
    expect(result).toContain("2 messages processed");
  });
});

// ============================================================================
// createLLMSummarizer
// ============================================================================

describe("createLLMSummarizer", () => {
  it("passes formatted prompt to the LLM function", async () => {
    const llmCall = vi.fn(async () => "LLM summary result");
    const summarizer = createLLMSummarizer(llmCall);
    const result = await summarizer([
      msg("user", "What is Directive?"),
      msg("assistant", "A constraint-driven runtime."),
    ]);

    expect(result).toBe("LLM summary result");
    expect(llmCall).toHaveBeenCalledOnce();
    const prompt = (llmCall.mock.calls[0] as unknown as [string])[0];
    expect(prompt).toContain("USER: What is Directive?");
    expect(prompt).toContain("ASSISTANT: A constraint-driven runtime.");
    expect(prompt).toContain("Preserve key facts");
    expect(prompt).toContain("SUMMARY:");
  });

  it("respects preserveKeyFacts=false", async () => {
    const llmCall = vi.fn(async () => "short");
    const summarizer = createLLMSummarizer(llmCall, {
      preserveKeyFacts: false,
    });
    await summarizer([msg("user", "hi")]);

    const prompt = (llmCall.mock.calls[0] as unknown as [string])[0];
    expect(prompt).not.toContain("Preserve key facts");
  });

  it("includes maxSummaryLength in prompt", async () => {
    const llmCall = vi.fn(async () => "ok");
    const summarizer = createLLMSummarizer(llmCall, {
      maxSummaryLength: 200,
    });
    await summarizer([msg("user", "hi")]);

    const prompt = (llmCall.mock.calls[0] as unknown as [string])[0];
    expect(prompt).toContain("200 characters");
  });

  it("filters out system messages from conversation text", async () => {
    const llmCall = vi.fn(async () => "ok");
    const summarizer = createLLMSummarizer(llmCall);
    await summarizer([
      msg("system", "secret instructions"),
      msg("user", "hello"),
    ]);

    const prompt = (llmCall.mock.calls[0] as unknown as [string])[0];
    expect(prompt).not.toContain("secret instructions");
    expect(prompt).toContain("USER: hello");
  });
});
