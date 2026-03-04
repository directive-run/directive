/**
 * Agent Memory System
 *
 * Provides sliding window message management and automatic summarization
 * for long-running agent conversations.
 *
 * @example
 * ```typescript
 * import { createAgentMemory, createSlidingWindowStrategy } from '@directive-run/ai';
 *
 * const memory = createAgentMemory({
 *   strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
 *   summarizer: async (messages) => {
 *     // Call LLM to summarize older messages
 *     return await summarizeWithLLM(messages);
 *   },
 * });
 *
 * // Use with orchestrator
 * const orchestrator = createAgentOrchestrator({
 *   memory,
 *   runner: run,
 * });
 * ```
 */

// ============================================================================
// Message Types
// ============================================================================

/**
 * Memory-compatible message type.
 * Extends the standard Message type to include system messages for summaries.
 */
export interface MemoryMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCallId?: string;
}

// Alias for compatibility
export type Message = MemoryMessage;

// ============================================================================
// Memory Strategy Types
// ============================================================================

/** Configuration for memory management strategies */
export interface MemoryStrategyConfig {
  /** Maximum number of messages to keep in active memory */
  maxMessages?: number;
  /** Maximum total tokens to keep in active memory */
  maxTokens?: number;
  /** Number of recent messages to always keep (protected from summarization) */
  preserveRecentCount?: number;
  /** Whether to include system messages in token count */
  countSystemMessages?: boolean;
}

/** Result of a memory strategy evaluation */
export interface MemoryStrategyResult {
  /** Messages to keep in active memory */
  keep: Message[];
  /** Messages to summarize or discard */
  toSummarize: Message[];
  /** Estimated token count of kept messages */
  estimatedTokens: number;
}

/** Memory management strategy function */
export type MemoryStrategy = (
  messages: Message[],
  config: MemoryStrategyConfig,
) => MemoryStrategyResult;

/** Summarizer function to compress older messages */
export type MessageSummarizer = (messages: Message[]) => Promise<string>;

// ============================================================================
// Memory Instance Types
// ============================================================================

/** Agent memory configuration */
export interface AgentMemoryConfig {
  /** Memory management strategy */
  strategy: MemoryStrategy;
  /** Optional summarizer for compressing old messages */
  summarizer?: MessageSummarizer;
  /** Strategy configuration */
  strategyConfig?: MemoryStrategyConfig;
  /** Whether to auto-manage memory after each interaction */
  autoManage?: boolean;
  /** Callback when memory is managed */
  onMemoryManaged?: (result: MemoryManageResult) => void;
  /** Callback when auto-manage encounters an error */
  onManageError?: (error: Error) => void;
  /** Maximum context window tokens (triggers additional summarization if exceeded) */
  maxContextTokens?: number;
}

/** Result of memory management */
export interface MemoryManageResult {
  /** Number of messages before management */
  messagesBefore: number;
  /** Number of messages after management */
  messagesAfter: number;
  /** Number of messages summarized */
  messagesSummarized: number;
  /** The summary that was generated (if any) */
  summary?: string;
  /** Estimated tokens before */
  estimatedTokensBefore: number;
  /** Estimated tokens after */
  estimatedTokensAfter: number;
}

/** Memory state for a conversation */
export interface MemoryState {
  /** Active messages in memory */
  messages: Message[];
  /** Summaries of older messages */
  summaries: Array<{
    content: string;
    messagesCount: number;
    createdAt: number;
  }>;
  /** Total messages ever processed */
  totalMessagesProcessed: number;
  /** Estimated current token count */
  estimatedTokens: number;
}

/** Agent memory instance */
export interface AgentMemory {
  /** Get current memory state */
  getState(): MemoryState;
  /** Add a message to memory */
  addMessage(message: Message): void;
  /** Check if memory management is currently in progress */
  isManaging(): boolean;
  /** Add multiple messages to memory */
  addMessages(messages: Message[]): void;
  /** Get messages for context (includes summaries as system messages) */
  getContextMessages(): Message[];
  /** Manually trigger memory management */
  manage(): Promise<MemoryManageResult>;
  /** Clear all memory */
  clear(): void;
  /** Export memory state for persistence */
  export(): MemoryState;
  /** Import memory state from persistence */
  import(state: MemoryState): void;
}

// ============================================================================
// Token Estimation
// ============================================================================

/** Approximate characters per token (default heuristic) */
const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a message.
 * Uses a simple heuristic: ~4 characters per token.
 * For more accurate counts, use a tokenizer like tiktoken.
 *
 * @example
 * ```typescript
 * // Default heuristic
 * const tokens = estimateTokens({ role: 'user', content: 'Hello world' });
 *
 * // Custom tokenizer (e.g., tiktoken)
 * const tokens = estimateTokens(msg, (text) => tiktoken.encode(text).length);
 * ```
 */
export function estimateTokens(
  message: Message,
  tokenizer?: (text: string) => number,
): number {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  if (tokenizer) {
    return tokenizer(content);
  }

  return Math.ceil(content.length / APPROX_CHARS_PER_TOKEN);
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateTotalTokens(
  messages: Message[],
  tokenizer?: (text: string) => number,
): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg, tokenizer), 0);
}

// ============================================================================
// Built-in Strategies
// ============================================================================

/**
 * Create a sliding window memory strategy.
 *
 * Keeps the most recent N messages, moving older ones to summarization.
 *
 * @example
 * ```typescript
 * const strategy = createSlidingWindowStrategy({
 *   maxMessages: 50,
 *   preserveRecentCount: 10,
 * });
 * ```
 */
export function createSlidingWindowStrategy(
  defaultConfig: MemoryStrategyConfig = {},
): MemoryStrategy {
  return (messages: Message[], configOverride: MemoryStrategyConfig = {}) => {
    const config = { ...defaultConfig, ...configOverride };
    const maxMessages = config.maxMessages ?? 100;
    const preserveRecentCount = config.preserveRecentCount ?? 5;

    if (messages.length <= maxMessages) {
      return {
        keep: [...messages],
        toSummarize: [],
        estimatedTokens: estimateTotalTokens(messages),
      };
    }

    // Always keep the most recent messages
    const recentMessages = messages.slice(-preserveRecentCount);
    const olderMessages = messages.slice(0, -preserveRecentCount);

    // Calculate how many older messages we can keep
    const olderToKeep = Math.max(0, maxMessages - preserveRecentCount);
    const keptOlder = olderMessages.slice(-olderToKeep);
    const toSummarize = olderMessages.slice(0, -olderToKeep || undefined);

    const keep = [...keptOlder, ...recentMessages];

    return {
      keep,
      toSummarize: toSummarize.length > 0 ? toSummarize : [],
      estimatedTokens: estimateTotalTokens(keep),
    };
  };
}

/**
 * Create a token-based memory strategy.
 *
 * Keeps messages until a token limit is reached, then moves older ones to summarization.
 *
 * @example
 * ```typescript
 * const strategy = createTokenBasedStrategy({
 *   maxTokens: 4000,
 *   preserveRecentCount: 5,
 * });
 * ```
 */
export function createTokenBasedStrategy(
  defaultConfig: MemoryStrategyConfig = {},
): MemoryStrategy {
  return (messages: Message[], configOverride: MemoryStrategyConfig = {}) => {
    const config = { ...defaultConfig, ...configOverride };
    const maxTokens = config.maxTokens ?? 4000;
    const preserveRecentCount = config.preserveRecentCount ?? 5;
    const countSystemMessages = config.countSystemMessages ?? true;

    // Always keep recent messages
    const recentMessages = messages.slice(-preserveRecentCount);
    const olderMessages = messages.slice(0, -preserveRecentCount);

    const recentTokens = recentMessages.reduce((sum, msg) => {
      if (!countSystemMessages && msg.role === "system") return sum;
      return sum + estimateTokens(msg);
    }, 0);

    // Add older messages from newest to oldest until we hit the limit
    const keep: Message[] = [];
    const toSummarize: Message[] = [];
    let currentTokens = recentTokens;

    for (let i = olderMessages.length - 1; i >= 0; i--) {
      const msg = olderMessages[i]!; // Safe: i is within bounds
      const msgTokens =
        !countSystemMessages && msg.role === "system" ? 0 : estimateTokens(msg);

      if (currentTokens + msgTokens <= maxTokens) {
        keep.unshift(msg);
        currentTokens += msgTokens;
      } else {
        // All remaining older messages go to summarization
        toSummarize.push(...olderMessages.slice(0, i + 1));
        break;
      }
    }

    return {
      keep: [...keep, ...recentMessages],
      toSummarize,
      estimatedTokens: currentTokens,
    };
  };
}

/**
 * Create a hybrid strategy that combines message count and token limits.
 *
 * @example
 * ```typescript
 * const strategy = createHybridStrategy({
 *   maxMessages: 50,
 *   maxTokens: 4000,
 *   preserveRecentCount: 5,
 * });
 * ```
 */
export function createHybridStrategy(
  defaultConfig: MemoryStrategyConfig = {},
): MemoryStrategy {
  const slidingWindow = createSlidingWindowStrategy(defaultConfig);
  const tokenBased = createTokenBasedStrategy(defaultConfig);

  return (messages: Message[], configOverride: MemoryStrategyConfig = {}) => {
    const config = { ...defaultConfig, ...configOverride };

    // Apply both strategies and use the more restrictive result
    const windowResult = slidingWindow(messages, config);
    const tokenResult = tokenBased(messages, config);

    // Use the strategy that keeps fewer messages
    if (windowResult.keep.length <= tokenResult.keep.length) {
      return windowResult;
    }
    return tokenResult;
  };
}

// ============================================================================
// Agent Memory Factory
// ============================================================================

/**
 * Create an agent memory instance.
 *
 * @example
 * ```typescript
 * const memory = createAgentMemory({
 *   strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
 *   summarizer: async (messages) => {
 *     const response = await openai.chat.completions.create({
 *       model: 'gpt-4o-mini',
 *       messages: [
 *         { role: 'system', content: 'Summarize the following conversation concisely.' },
 *         ...messages.map(m => ({ role: m.role, content: m.content })),
 *       ],
 *     });
 *     return response.choices[0].message.content;
 *   },
 *   autoManage: true,
 * });
 * ```
 */
export function createAgentMemory(config: AgentMemoryConfig): AgentMemory {
  const {
    strategy,
    summarizer,
    strategyConfig = {},
    autoManage = false,
    onMemoryManaged,
    onManageError,
    maxContextTokens,
  } = config;

  let state: MemoryState = {
    messages: [],
    summaries: [],
    totalMessagesProcessed: 0,
    estimatedTokens: 0,
  };

  // Flag to prevent concurrent management operations
  let isManaging = false;

  async function manage(): Promise<MemoryManageResult> {
    // Prevent concurrent management
    if (isManaging) {
      return {
        messagesBefore: state.messages.length,
        messagesAfter: state.messages.length,
        messagesSummarized: 0,
        estimatedTokensBefore: state.estimatedTokens,
        estimatedTokensAfter: state.estimatedTokens,
      };
    }

    isManaging = true;

    try {
      const messagesBefore = state.messages.length;
      const estimatedTokensBefore = state.estimatedTokens;

      const result = strategy(state.messages, strategyConfig);

      if (result.toSummarize.length === 0) {
        return {
          messagesBefore,
          messagesAfter: messagesBefore,
          messagesSummarized: 0,
          estimatedTokensBefore,
          estimatedTokensAfter: result.estimatedTokens,
        };
      }

      let summary: string | undefined;

      if (summarizer && result.toSummarize.length > 0) {
        summary = await summarizer(result.toSummarize);
        state.summaries.push({
          content: summary,
          messagesCount: result.toSummarize.length,
          createdAt: Date.now(),
        });
      }

      state.messages = result.keep;
      state.estimatedTokens = result.estimatedTokens;

      const manageResult: MemoryManageResult = {
        messagesBefore,
        messagesAfter: state.messages.length,
        messagesSummarized: result.toSummarize.length,
        summary,
        estimatedTokensBefore,
        estimatedTokensAfter: result.estimatedTokens,
      };

      onMemoryManaged?.(manageResult);

      return manageResult;
    } finally {
      isManaging = false;
    }
  }

  // Safe auto-manage that handles errors properly
  function triggerAutoManage(): void {
    if (isManaging) return;

    const check = strategy(state.messages, strategyConfig);
    if (check.toSummarize.length > 0) {
      manage().catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (onManageError) {
          onManageError(err);
        } else {
          console.error("[Directive Memory] Auto-manage error:", err);
        }
      });
    }
  }

  return {
    getState() {
      return {
        ...state,
        messages: [...state.messages],
        summaries: state.summaries.map((s) => ({ ...s })),
      };
    },

    addMessage(message: Message) {
      state.messages.push(message);
      state.totalMessagesProcessed++;
      state.estimatedTokens += estimateTokens(message);

      if (autoManage) {
        triggerAutoManage();
      }
    },

    addMessages(messages: Message[]) {
      for (const message of messages) {
        state.messages.push(message);
        state.totalMessagesProcessed++;
        state.estimatedTokens += estimateTokens(message);
      }

      if (autoManage) {
        triggerAutoManage();
      }
    },

    getContextMessages(): Message[] {
      const contextMessages: Message[] = [];

      // Add summaries as system messages at the beginning
      if (state.summaries.length > 0) {
        const summaryContent = state.summaries
          .map((s) => s.content)
          .join("\n\n---\n\n");

        contextMessages.push({
          role: "system",
          content: `[Previous conversation summary]\n\n${summaryContent}`,
        });
      }

      // Add current messages
      contextMessages.push(...state.messages);

      // Check if context exceeds max tokens and warn
      if (maxContextTokens) {
        const totalTokens = estimateTotalTokens(contextMessages);
        if (totalTokens > maxContextTokens) {
          console.warn(
            `[Directive Memory] Context messages (${totalTokens} tokens) exceed maxContextTokens (${maxContextTokens}). ` +
              "Consider calling manage() or reducing message count.",
          );
        }
      }

      return contextMessages;
    },

    manage,

    /** Check if memory management is currently in progress */
    isManaging() {
      return isManaging;
    },

    clear() {
      state = {
        messages: [],
        summaries: [],
        totalMessagesProcessed: 0,
        estimatedTokens: 0,
      };
    },

    export() {
      return {
        ...state,
        messages: [...state.messages],
        summaries: state.summaries.map((s) => ({ ...s })),
      };
    },

    import(importedState: MemoryState) {
      state = {
        ...importedState,
        messages: [...importedState.messages],
        summaries: importedState.summaries.map((s) => ({ ...s })),
      };
    },
  };
}

// ============================================================================
// Built-in Summarizers
// ============================================================================

/**
 * Create a simple truncation "summarizer" that just returns key points.
 * Useful for testing or when LLM summarization isn't needed.
 */
export function createTruncationSummarizer(maxLength = 500): MessageSummarizer {
  return async (messages: Message[]) => {
    const content = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const text =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `${m.role}: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`;
      })
      .join("\n");

    if (content.length <= maxLength) {
      return content;
    }

    return content.slice(0, maxLength) + "\n[truncated]";
  };
}

/**
 * Create a summarizer that extracts only user questions and key assistant answers.
 */
export function createKeyPointsSummarizer(): MessageSummarizer {
  return async (messages: Message[]) => {
    const keyPoints: string[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        // Extract questions (sentences ending with ?)
        const questions = content.match(/[^.!?]*\?/g);
        if (questions) {
          keyPoints.push(...questions.map((q) => `Q: ${q.trim()}`));
        }
      }
    }

    if (keyPoints.length === 0) {
      return `[${messages.length} messages processed - no key questions found]`;
    }

    return `Key topics discussed:\n${keyPoints.join("\n")}`;
  };
}

/**
 * Create a summarizer factory for LLM-based summarization.
 * You provide the LLM call function, this handles the prompt.
 *
 * @example
 * ```typescript
 * const summarizer = createLLMSummarizer(async (prompt) => {
 *   const response = await openai.chat.completions.create({
 *     model: 'gpt-4o-mini',
 *     messages: [{ role: 'user', content: prompt }],
 *   });
 *   return response.choices[0].message.content ?? '';
 * });
 * ```
 */
export function createLLMSummarizer(
  llmCall: (prompt: string) => Promise<string>,
  options: {
    maxSummaryLength?: number;
    preserveKeyFacts?: boolean;
  } = {},
): MessageSummarizer {
  const { maxSummaryLength = 500, preserveKeyFacts = true } = options;

  return async (messages: Message[]) => {
    const conversationText = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const content =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `${m.role.toUpperCase()}: ${content}`;
      })
      .join("\n\n");

    const prompt = `Summarize the following conversation in ${maxSummaryLength} characters or less.
${preserveKeyFacts ? "Preserve key facts, decisions, and action items." : ""}
Focus on information that would be useful context for continuing the conversation.

CONVERSATION:
${conversationText}

SUMMARY:`;

    return llmCall(prompt);
  };
}
