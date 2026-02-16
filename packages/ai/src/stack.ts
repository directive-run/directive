/**
 * Agent Stack — Composition API for AI Adapters
 *
 * One factory that wires orchestrator, memory, circuit breaker, rate limiter,
 * streaming, multi-agent patterns, semantic cache, observability, OTLP export,
 * and communication bus with sensible defaults.
 *
 * @example Basic usage
 * ```typescript
 * import { createAgentStack, parallel } from '@directive-run/ai';
 *
 * const stack = createAgentStack({
 *   runner: myAgentRunner,
 *   agents: { move: { agent: moveAgent, capabilities: ["move"] } },
 *   memory: { maxMessages: 30 },
 *   circuitBreaker: { failureThreshold: 3 },
 *   cache: { threshold: 0.98, maxSize: 200, ttlMs: 600_000 },
 *   observability: { serviceName: "my-app" },
 * });
 *
 * const result = await stack.run("move", input);
 * ```
 *
 * @example Streaming
 * ```typescript
 * const stack = createAgentStack({
 *   runner: myAgentRunner,
 *   streaming: { runner: myStreamingAgentRunner },
 *   agents: { chat: { agent: chatAgent, capabilities: ["chat"] } },
 * });
 *
 * const tokenStream = stack.stream("chat", "Hello!");
 * for await (const token of tokenStream) { process.stdout.write(token); }
 * const finalResult = await tokenStream.result;
 * ```
 */

import type {
  AgentRunner,
  RunResult,
  AgentLike,
  Message,
  GuardrailFn,
  InputGuardrailData,
  OutputGuardrailData,
  NamedGuardrail,
  OrchestratorConstraint,
  OrchestratorResolver,
  OrchestratorLifecycleHooks,
  AgentRetryConfig,
  ApprovalRequest,
} from "./types.js";
import type { RunCallOptions, AgentOrchestrator } from "./index.js";
import type { Requirement } from "@directive-run/core";
import type { StreamingGuardrail, StreamChunk, StreamRunner, StreamingRunResult } from "./streaming.js";
import type { AgentMemory, MemoryStrategyConfig } from "./memory.js";
import type { CircuitBreaker, CircuitState, CircuitBreakerConfig } from "@directive-run/core/plugins";
import type { ObservabilityInstance, AlertConfig, TraceSpan, AggregatedMetric } from "@directive-run/core/plugins";
import type { OTLPExporter } from "@directive-run/core/plugins";
import type { SemanticCache, CacheStats, EmbedderFn } from "./guardrails/semantic-cache.js";
import type { MessageBus, TypedAgentMessage } from "./communication.js";
import type { AgentRegistry, ExecutionPattern, MultiAgentOrchestrator } from "./multi.js";
import type { StreamChannel } from "./stream-channel.js";
import type { RetryConfig } from "./retry.js";
import type { FallbackConfig } from "./fallback.js";
import type { BudgetConfig } from "./budget.js";
import type { ModelRule } from "./model-selector.js";
import type { StructuredOutputConfig } from "./structured-output.js";

import { createAgentOrchestrator } from "./index.js";
import { estimateCost } from "./helpers.js";
import { GuardrailError } from "./types.js";
import { createAgentMemory, createSlidingWindowStrategy } from "./memory.js";
import { createCircuitBreaker as createCB } from "@directive-run/core/plugins";
import { createObservability as createObs, createAgentMetrics } from "@directive-run/core/plugins";
import { createOTLPExporter } from "@directive-run/core/plugins";
import { createSemanticCache, createTestEmbedder } from "./guardrails/semantic-cache.js";
import { createMessageBus as createBus } from "./communication.js";
import { createMultiAgentOrchestrator } from "./multi.js";
import { createStreamingRunner } from "./streaming.js";
import { createStreamChannel, pipeThrough } from "./stream-channel.js";
import { withRetry } from "./retry.js";
import { withFallback } from "./fallback.js";
import { withBudget } from "./budget.js";
import { withModelSelection } from "./model-selector.js";
import { withStructuredOutput } from "./structured-output.js";

// ============================================================================
// Config Types
// ============================================================================

/** Callback-based streaming run function (e.g. for SSE-based LLM APIs) */
export type StreamingCallbackRunner = (
	agent: AgentLike,
	input: string,
	callbacks: {
		onToken?: (token: string) => void;
		onToolStart?: (tool: string, id: string, args: string) => void;
		onToolEnd?: (tool: string, id: string, result: string) => void;
		onMessage?: (message: Message) => void;
		signal?: AbortSignal;
	},
) => Promise<RunResult<unknown>>;

export interface AgentStackConfig {
	/** Required: base runner for agent execution */
	runner: AgentRunner;
	/** Enables stack.stream() when provided */
	streaming?: { runner: StreamingCallbackRunner };
	/** Agent registry — required for multi-agent patterns */
	agents?: AgentRegistry;
	/** Named execution patterns (parallel, sequential, supervisor) */
	patterns?: Record<string, ExecutionPattern>;

	// Features — each auto-wires when present. Accepts shorthand config OR pre-built instance.
	memory?: { maxMessages?: number; preserveRecentCount?: number } | AgentMemory;
	circuitBreaker?: CircuitBreakerConfig | CircuitBreaker;
	rateLimit?: { maxPerMinute: number };
	cache?:
		| { threshold?: number; maxSize?: number; ttlMs?: number; embedder?: EmbedderFn }
		| SemanticCache;
	observability?: { serviceName: string; alerts?: AlertConfig[] } | ObservabilityInstance;
	otlp?: {
		endpoint: string;
		intervalMs?: number;
		onError?: (err: Error, type: "metrics" | "traces") => void;
	};
	/** Message bus for agent communication */
	messageBus?: { maxHistory?: number } | MessageBus;

	guardrails?: {
		input?: Array<GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>>;
		output?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
		streaming?: StreamingGuardrail[];
	};
	maxTokenBudget?: number;
	/** Cost per million tokens for cost estimation */
	costPerMillionTokens?: number;
	debug?: boolean;

	// Directive constraint-driven orchestration
	constraints?: Record<string, OrchestratorConstraint<Record<string, unknown>>>;
	resolvers?: Record<string, OrchestratorResolver<Record<string, unknown>, Requirement>>;

	// Approval workflows
	approvals?: {
		/** @default true */
		autoApproveToolCalls?: boolean;
		onRequest?: (request: ApprovalRequest) => void;
		/** @default 300_000 */
		timeoutMs?: number;
	};

	// Agent retry policy
	retry?: AgentRetryConfig;

	// Lifecycle hooks for observability
	hooks?: OrchestratorLifecycleHooks;

	// --- Advanced AI features (P0–P6) ---

	/** P2: Intelligent retry config for the base runner. */
	intelligentRetry?: RetryConfig;
	/** P0: Fallback runners (tried in order on failure). */
	fallback?: { runners: AgentRunner[]; config?: FallbackConfig };
	/** P1: Cost budget guards. */
	budget?: BudgetConfig;
	/** P3: Model selection rules (first match wins). */
	modelSelection?: ModelRule[];
	/** P6: Structured output config (applied per-agent via agents map, or globally here). */
	structuredOutput?: StructuredOutputConfig;
}

// ============================================================================
// Return Types
// ============================================================================

export interface StackRunOptions {
	/** Override output guardrails for this call */
	guardrails?: {
		output?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
	};
	/** Set to false to skip cache for this call */
	cache?: false;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
}

export interface StackStreamOptions {
	signal?: AbortSignal;
}

export interface TokenStream<T = string> extends AsyncIterable<string> {
	/** Resolves to the final run result after the stream completes */
	result: Promise<RunResult<T>>;
	/** Abort the stream */
	abort: () => void;
}

export interface AgentStackState {
	totalTokens: number;
	estimatedCost: number;
	circuitState: CircuitState;
	cacheStats: CacheStats;
	memoryMessageCount: number;
	busMessageCount: number;
	rateLimitRemaining: number | null;
}

/** Options for runStructured() */
export interface StructuredRunOptions<_T = unknown> extends StackRunOptions {
	/** Validate the output. Return `true` or `{ valid: true }` on success. */
	validate: (value: unknown) => boolean | { valid: boolean; errors?: string[] };
	/** Number of retry attempts on validation failure @default 1 */
	retries?: number;
}

export interface AgentStack {
	/** Run a single registered agent by ID */
	run<T = unknown>(agentId: string, input: string, options?: StackRunOptions): Promise<RunResult<T>>;
	/** Run and validate output against a schema, retrying on failure */
	runStructured<T>(agentId: string, input: string, options: StructuredRunOptions<T>): Promise<RunResult<T>>;
	/** Run a named execution pattern */
	runPattern<T = unknown>(patternId: string, input: string, options?: StackRunOptions): Promise<T>;
	/** Stream tokens from a single agent */
	stream<T = string>(agentId: string, input: string, options?: StackStreamOptions): TokenStream<T>;
	/** Stream full rich chunks (token, tool_start, tool_end, etc.) from a single agent */
	streamChunks<T = unknown>(agentId: string, input: string, options?: StackStreamOptions): StreamingRunResult<T>;
	/** Approve a pending approval request */
	approve(requestId: string): void;
	/** Reject a pending approval request */
	reject(requestId: string, reason?: string): void;
	/** Aggregate state across all features */
	getState(): AgentStackState;
	/** Reset all feature state */
	reset(): void;
	/** Dispose all resources */
	dispose(): Promise<void>;

	// Escape hatches
	readonly orchestrator: AgentOrchestrator<Record<string, unknown>>;
	readonly observability: ObservabilityInstance | null;
	readonly messageBus: MessageBus | null;
	readonly coordinator: MultiAgentOrchestrator | null;
	readonly cache: SemanticCache | null;
	readonly memory: AgentMemory | null;

	/** Get observability timeline (spans + metrics) for debugging */
	getTimeline(limit?: number): { spans: readonly TraceSpan[]; metrics: Record<string, AggregatedMetric> };
}

// ============================================================================
// Expand Helpers — detect pre-built instances vs shorthand config
// ============================================================================

function isPreBuiltMemory(v: unknown): v is AgentMemory {
	if (v == null || typeof v !== "object") return false;
	const obj = v as Record<string, unknown>;
	return typeof obj.getState === "function" && typeof obj.addMessage === "function" && typeof obj.clear === "function";
}

function expandMemory(
	cfg: AgentStackConfig["memory"],
): AgentMemory | null {
	if (!cfg) return null;
	if (isPreBuiltMemory(cfg)) return cfg;
	return createAgentMemory({
		strategy: createSlidingWindowStrategy(),
		strategyConfig: {
			maxMessages: cfg.maxMessages ?? 50,
			preserveRecentCount: cfg.preserveRecentCount ?? 6,
		} as MemoryStrategyConfig,
		autoManage: true,
	});
}

function isPreBuiltCircuitBreaker(v: unknown): v is CircuitBreaker {
	if (v == null || typeof v !== "object") return false;
	const obj = v as Record<string, unknown>;
	return typeof obj.execute === "function" && typeof obj.getState === "function" && typeof obj.reset === "function";
}

function expandCircuitBreaker(
	cfg: AgentStackConfig["circuitBreaker"],
): CircuitBreaker | null {
	if (!cfg) return null;
	if (isPreBuiltCircuitBreaker(cfg)) return cfg;
	const castCfg = cfg as CircuitBreakerConfig;
	if (castCfg.failureThreshold != null && castCfg.failureThreshold < 1) {
		throw new Error("[AgentStack] circuitBreaker.failureThreshold must be at least 1.");
	}
	if (castCfg.recoveryTimeMs != null && castCfg.recoveryTimeMs < 0) {
		throw new Error("[AgentStack] circuitBreaker.recoveryTimeMs must be non-negative.");
	}
	return createCB(castCfg);
}

function isPreBuiltObs(v: unknown): v is ObservabilityInstance {
	if (v == null || typeof v !== "object") return false;
	const obj = v as Record<string, unknown>;
	return typeof obj.startSpan === "function" && typeof obj.endSpan === "function" && typeof obj.getDashboard === "function";
}

function expandObservability(
	cfg: AgentStackConfig["observability"],
): ObservabilityInstance | null {
	if (!cfg) return null;
	if (isPreBuiltObs(cfg)) return cfg;
	return createObs({
		serviceName: cfg.serviceName,
		metrics: { enabled: true },
		tracing: { enabled: true, sampleRate: 1.0 },
		alerts: cfg.alerts,
	});
}

function isPreBuiltCache(v: unknown): v is SemanticCache {
	if (v == null || typeof v !== "object") return false;
	const obj = v as Record<string, unknown>;
	return typeof obj.lookup === "function" && typeof obj.store === "function" && typeof obj.getStats === "function";
}

function expandCache(
	cfg: AgentStackConfig["cache"],
): SemanticCache | null {
	if (!cfg) return null;
	if (isPreBuiltCache(cfg)) return cfg;
	if (cfg.threshold != null && (cfg.threshold < 0 || cfg.threshold > 1)) {
		throw new Error("[AgentStack] cache.threshold must be between 0 and 1.");
	}
	if (cfg.maxSize != null && cfg.maxSize < 1) {
		throw new Error("[AgentStack] cache.maxSize must be at least 1.");
	}
	if (!cfg.embedder) {
		console.warn("[AgentStack] No cache embedder provided — using test embedder (character frequency). Provide a real embedder for production use.");
	}
	return createSemanticCache({
		embedder: cfg.embedder ?? createTestEmbedder(),
		similarityThreshold: cfg.threshold ?? 0.95,
		maxCacheSize: cfg.maxSize ?? 500,
		ttlMs: cfg.ttlMs ?? 300_000,
	});
}

function isPreBuiltBus(v: unknown): v is MessageBus {
	if (v == null || typeof v !== "object") return false;
	const obj = v as Record<string, unknown>;
	return typeof obj.publish === "function" && typeof obj.getHistory === "function" && typeof obj.clear === "function";
}

function expandBus(cfg: AgentStackConfig["messageBus"]): MessageBus | null {
	if (!cfg) return null;
	if (isPreBuiltBus(cfg)) return cfg;
	return createBus({ maxHistory: cfg.maxHistory ?? 100 });
}

// ============================================================================
// TokenStreamImpl
// ============================================================================

class TokenStreamImpl<T = string> implements TokenStream<T> {
	result: Promise<RunResult<T>>;
	abort: () => void;

	private _channel: StreamChannel<string>;

	constructor(
		channel: StreamChannel<string>,
		result: Promise<RunResult<T>>,
		abort: () => void,
	) {
		this._channel = channel;
		this.result = result;
		this.abort = abort;
	}

	[Symbol.asyncIterator](): AsyncIterator<string> {
		return this._channel[Symbol.asyncIterator]();
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an agent stack that composes all AI adapter features.
 *
 * Only `runner` is required. Every other feature activates when its config key
 * is present. Pass a pre-built instance to reuse existing objects, or pass
 * shorthand config to let the stack create them.
 */
export function createAgentStack(config: AgentStackConfig): AgentStack {
	const {
		streaming: streamingConfig,
		agents: agentRegistry,
		patterns,
		guardrails = {},
		maxTokenBudget,
		debug = false,
	} = config;
	const costRatePerMillion = config.costPerMillionTokens ?? 0;

	// Warn when both retry systems are configured
	if (config.retry && config.intelligentRetry) {
		console.warn(
			"[AgentStack] Both 'retry' (orchestrator-level) and 'intelligentRetry' (HTTP-aware) are configured. " +
			"This causes double-retry behavior. Use 'intelligentRetry' for HTTP status-aware retry, or 'retry' for orchestrator-level retry, but not both.",
		);
	}

	// --- Compose runner pipeline (innermost → outermost) ---
	// Order: Model Selection → Fallback → Retry → Budget → Structured Output
	// The outermost wrapper executes first on each call.
	let runner: AgentRunner = config.runner;

	// P3: Model Selection (innermost — runs just before the provider)
	if (config.modelSelection && config.modelSelection.length > 0) {
		runner = withModelSelection(runner, config.modelSelection);
	}

	// P0: Fallback (wraps model-selected runner)
	if (config.fallback) {
		runner = withFallback([runner, ...config.fallback.runners], config.fallback.config);
	}

	// P2: Intelligent Retry (wraps fallback chain)
	if (config.intelligentRetry) {
		runner = withRetry(runner, config.intelligentRetry);
	}

	// P1: Budget (wraps retry — budget check happens before any retries)
	if (config.budget) {
		runner = withBudget(runner, config.budget);
	}

	// P6: Structured Output (outermost — validates after everything else)
	if (config.structuredOutput) {
		runner = withStructuredOutput(runner, config.structuredOutput);
	}

	// --- Expand features ---
	const memory = expandMemory(config.memory);
	const circuitBreaker = expandCircuitBreaker(config.circuitBreaker);
	const obsInstance = expandObservability(config.observability);
	const cacheInstance = expandCache(config.cache);
	const busInstance = expandBus(config.messageBus);

	// --- Agent metrics helper ---
	const metrics = obsInstance ? createAgentMetrics(obsInstance) : null;

	// --- Rate limiter (built into orchestrator guardrails) ---
	let rateLimitGuardrail: NamedGuardrail<InputGuardrailData> | null = null;
	let rateLimitTimestamps: number[] | null = null;
	let rateLimitStartIdx = 0;
	if (config.rateLimit) {
		const { maxPerMinute } = config.rateLimit;
		if (maxPerMinute < 1 || !Number.isFinite(maxPerMinute)) {
			throw new Error("[AgentStack] rateLimit.maxPerMinute must be a positive finite number.");
		}
		rateLimitTimestamps = [];
		const timestamps = rateLimitTimestamps;
		rateLimitGuardrail = {
			name: "rate-limit",
			fn: () => {
				const now = Date.now();
				const windowStart = now - 60_000;
				// Advance start index past expired entries (O(1) amortized)
				while (rateLimitStartIdx < timestamps.length && timestamps[rateLimitStartIdx]! < windowStart) {
					rateLimitStartIdx++;
				}
				// Compact when half the array is dead entries
				if (rateLimitStartIdx > timestamps.length / 2 && rateLimitStartIdx > 100) {
					timestamps.splice(0, rateLimitStartIdx);
					rateLimitStartIdx = 0;
				}
				const active = timestamps.length - rateLimitStartIdx;
				if (active >= maxPerMinute) {
					return { passed: false, reason: `Rate limit exceeded (${maxPerMinute}/min)` };
				}
				timestamps.push(now);
				return { passed: true };
			},
		};
	}

	// --- Build orchestrator input guardrails ---
	const inputGuardrails: Array<GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>> = [
		...(rateLimitGuardrail ? [rateLimitGuardrail] : []),
		...(guardrails.input ?? []),
	];

	// --- Core orchestrator ---
	const orchestrator = createAgentOrchestrator({
		runner,
		maxTokenBudget,
		memory: memory ?? undefined,
		circuitBreaker: circuitBreaker ?? undefined,
		guardrails: {
			input: inputGuardrails.length > 0 ? inputGuardrails : undefined,
			output: guardrails.output,
		},
		constraints: config.constraints,
		resolvers: config.resolvers,
		autoApproveToolCalls: config.approvals?.autoApproveToolCalls,
		onApprovalRequest: config.approvals?.onRequest,
		approvalTimeoutMs: config.approvals?.timeoutMs,
		agentRetry: config.retry,
		hooks: config.hooks,
		debug,
	});

	// --- Multi-agent (only when agents are registered) ---
	let multi: MultiAgentOrchestrator | null = null;
	if (agentRegistry) {
		multi = createMultiAgentOrchestrator({
			runner,
			agents: agentRegistry,
			patterns,
			debug,
		});
	}

	// --- Streaming runner (only when streaming config is provided) ---
	let streamingAgentRunner: StreamRunner | null = null;
	if (streamingConfig) {
		streamingAgentRunner = createStreamingRunner(streamingConfig.runner, {
			streamingGuardrails: guardrails.streaming,
		});
	}

	// --- OTLP export interval ---
	let otlpExporter: OTLPExporter | null = null;
	let otlpInterval: ReturnType<typeof setInterval> | null = null;
	if (config.otlp && obsInstance) {
		if (config.otlp.intervalMs != null && (!Number.isFinite(config.otlp.intervalMs) || config.otlp.intervalMs < 1000)) {
			throw new Error("[AgentStack] otlp.intervalMs must be at least 1000ms.");
		}
		otlpExporter = createOTLPExporter({
			endpoint: config.otlp.endpoint,
			serviceName:
				(config.observability && !isPreBuiltObs(config.observability))
					? (config.observability as { serviceName: string }).serviceName
					: "directive-agents",
			onError: config.otlp.onError,
		});
		const otlpOnError = config.otlp.onError;
		const intervalMs = config.otlp.intervalMs ?? 15_000;
		otlpInterval = setInterval(() => {
			if (!obsInstance || !otlpExporter) return;
			try {
				const data = obsInstance.export();
				if (data.metrics.length > 0) otlpExporter.exportMetrics(data.metrics);
				if (data.traces.length > 0) otlpExporter.exportTraces(data.traces);
			} catch (err) {
				otlpOnError?.(err instanceof Error ? err : new Error(String(err)), "metrics");
			}
		}, intervalMs);
	}

	// --- Internal token counter ---
	let totalTokens = 0;

	// --- Resolve agent from registry ---
	function resolveAgent(agentId: string): AgentLike {
		if (!agentRegistry) {
			throw new Error(
			`[AgentStack] No agents registered.\n` +
			`Add to config: agents: { myAgent: { agent: myAgentDef, description: '...' } }`,
		);
		}
		const reg = agentRegistry[agentId];
		if (!reg) {
			const available = Object.keys(agentRegistry).join(", ");
			throw new Error(`[AgentStack] Agent "${agentId}" not found in registry. Available: ${available}`);
		}
		return reg.agent;
	}

	// ============================================================================
	// run()
	// ============================================================================

	async function run<T = unknown>(
		agentId: string,
		input: string,
		options: StackRunOptions = {},
	): Promise<RunResult<T>> {
		const agent = resolveAgent(agentId);
		const skipCache = options.cache === false;

		// 1. Cache check
		if (cacheInstance && !skipCache) {
			try {
				const cached = await cacheInstance.lookup(input, agentId);
				if (cached.hit && cached.entry) {
					obsInstance?.incrementCounter("cache.hits");
					try {
						const parsed = JSON.parse(cached.entry.response) as T;
						return {
							output: parsed,
							messages: [],
							toolCalls: [],
							totalTokens: 0,
							isCached: true,
						};
					} catch {
						if (debug) console.debug(`[AgentStack] Cache hit for "${agentId}" contained invalid JSON — falling through to fresh run.`);
					}
				}
				obsInstance?.incrementCounter("cache.misses");
			} catch {
				// Cache lookup failed (e.g., embedder error) — treat as miss
				obsInstance?.incrementCounter("cache.lookup.errors");
			}
		}

		// 2. Start span
		const span = obsInstance?.startSpan(`agent.${agentId}`);
		const startTime = Date.now();

		try {
			// 3. Run agent — merge per-call overrides with per-agent guardrails
			const callOpts: RunCallOptions = {};
			if (options.guardrails?.output) {
				// Per-call overrides replace stack-level guardrails
				callOpts.outputGuardrails = options.guardrails.output;
			} else if (agentRegistry?.[agentId]?.guardrails?.output) {
				// Per-agent guardrails supplement stack-level guardrails
				callOpts.outputGuardrails = [
					...(guardrails.output ?? []),
					...agentRegistry[agentId]!.guardrails!.output!,
				];
			}
			if (options.signal) {
				callOpts.signal = options.signal;
			}

			const result = await orchestrator.run<T>(agent, input, callOpts);
			const latencyMs = Date.now() - startTime;
			totalTokens += result.totalTokens;

			// 4. Cache store
			if (cacheInstance && !skipCache && result.output != null) {
				try {
					const serialized = typeof result.output === "string"
						? result.output
						: JSON.stringify(result.output);
					await cacheInstance.store(input, serialized, agentId);
				} catch {
					// Cache store failed (e.g., circular ref in JSON) — non-fatal
					obsInstance?.incrementCounter("cache.store.errors");
				}
			}

			// 5. Bus publish
			if (busInstance) {
				busInstance.publish({
					type: "INFORM",
					from: agentId,
					to: "*",
					topic: `${agentId}.completed`,
					content: { tokenCount: result.totalTokens },
				} as Omit<TypedAgentMessage, "id" | "timestamp">);
			}

			// 6. Track metrics
			if (metrics) {
				metrics.trackRun(agentId, {
					success: true,
					latencyMs,
					cost: costRatePerMillion > 0 ? estimateCost(result.totalTokens, costRatePerMillion) : undefined,
				});
			}

			// 7. End span
			if (span) obsInstance?.endSpan(span.spanId, "ok");

			return result;
		} catch (err) {
			const latencyMs = Date.now() - startTime;
			if (span) obsInstance?.endSpan(span.spanId, "error");
			if (metrics) metrics.trackRun(agentId, { success: false, latencyMs });
			throw err;
		}
	}

	// ============================================================================
	// runStructured()
	// ============================================================================

	async function runStructured<T>(
		agentId: string,
		input: string,
		options: StructuredRunOptions<T>,
	): Promise<RunResult<T>> {
		const { validate, retries = 1, ...runOpts } = options;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			// Skip cache on retries to get a fresh result
			const attemptOpts = attempt > 0 ? { ...runOpts, cache: false as const } : runOpts;
			const result = await run<T>(agentId, input, attemptOpts);
			const validation = validate(result.output);
			const isValid = typeof validation === "boolean" ? validation : validation.valid;

			if (isValid) {
				return result;
			}

			const errors = typeof validation === "object" && validation.errors
				? validation.errors.join("; ")
				: "Validation failed";
			lastError = new GuardrailError({
				message: `Output validation failed (attempt ${attempt + 1}/${retries + 1}): ${errors}`,
				code: "OUTPUT_GUARDRAIL_FAILED",
				guardrailName: "runStructured",
				guardrailType: "output",
				agentName: agentId,
				input,
				data: result.output,
			});

			if (debug) console.debug(`[AgentStack] runStructured validation failed (attempt ${attempt + 1}):`, errors);
		}

		throw lastError;
	}

	// ============================================================================
	// runPattern()
	// ============================================================================

	async function runPattern<T = unknown>(
		patternId: string,
		input: string,
		options: StackRunOptions = {},
	): Promise<T> {
		if (!multi) {
			throw new Error("[AgentStack] No agents/patterns configured. Provide 'agents' and 'patterns' config.");
		}

		const skipCache = options.cache === false;

		// Cache check
		if (cacheInstance && !skipCache) {
			try {
				const cached = await cacheInstance.lookup(input, patternId);
				if (cached.hit && cached.entry) {
					obsInstance?.incrementCounter("cache.hits");
					try {
						return JSON.parse(cached.entry.response) as T;
					} catch {
						if (debug) console.debug(`[AgentStack] Cache hit for pattern "${patternId}" contained invalid JSON — falling through to fresh run.`);
					}
				}
				obsInstance?.incrementCounter("cache.misses");
			} catch {
				// Cache lookup failed (e.g., embedder error) — treat as miss
				obsInstance?.incrementCounter("cache.lookup.errors");
			}
		}

		// Run input guardrails (same ones wired into orchestrator for run())
		for (const guard of inputGuardrails) {
			const fn = typeof guard === "function" ? guard : guard.fn;
			const name = typeof guard === "function" ? "input-guardrail" : guard.name;
			const guardResult = await fn({ input, agentName: patternId }, { agentName: patternId, input, facts: {} as Record<string, unknown> });
			if (guardResult && !guardResult.passed) {
				throw new GuardrailError({
					message: `Input guardrail "${name}" failed: ${guardResult.reason ?? "unknown"}`,
					code: "INPUT_GUARDRAIL_FAILED",
					guardrailName: name,
					guardrailType: "input",
					agentName: patternId,
					input,
				});
			}
		}

		const span = obsInstance?.startSpan(`pattern.${patternId}`);
		const startTime = Date.now();

		// Snapshot token counts before pattern execution
		const statesBefore = multi.getAllAgentStates();
		let tokensBefore = 0;
		for (const s of Object.values(statesBefore)) tokensBefore += s.totalTokens;

		try {
			const result = await multi.runPattern<T>(patternId, input);
			const latencyMs = Date.now() - startTime;

			// Compute delta (tokens from this pattern only)
			const statesAfter = multi.getAllAgentStates();
			let tokensAfter = 0;
			for (const s of Object.values(statesAfter)) tokensAfter += s.totalTokens;
			const patternTokens = tokensAfter - tokensBefore;
			totalTokens += patternTokens;

			// Cache store
			if (cacheInstance && !skipCache && result != null) {
				try {
					const serialized = typeof result === "string" ? result : JSON.stringify(result);
					await cacheInstance.store(input, serialized, patternId);
				} catch {
					// Cache store failed — non-fatal
					obsInstance?.incrementCounter("cache.store.errors");
				}
			}

			// Bus publish
			if (busInstance) {
				busInstance.publish({
					type: "INFORM",
					from: patternId,
					to: "*",
					topic: `${patternId}.completed`,
					content: { patternTokens },
				} as Omit<TypedAgentMessage, "id" | "timestamp">);
			}

			// Metrics
			if (metrics) {
				metrics.trackRun(patternId, {
					success: true,
					latencyMs,
					cost: costRatePerMillion > 0 ? estimateCost(patternTokens, costRatePerMillion) : undefined,
				});
			}

			if (span) obsInstance?.endSpan(span.spanId, "ok");
			return result;
		} catch (err) {
			const latencyMs = Date.now() - startTime;
			if (span) obsInstance?.endSpan(span.spanId, "error");
			if (metrics) metrics.trackRun(patternId, { success: false, latencyMs });
			throw err;
		}
	}

	// ============================================================================
	// stream()
	// ============================================================================

	function stream<T = string>(
		agentId: string,
		input: string,
		options: StackStreamOptions = {},
	): TokenStream<T> {
		if (!streamingAgentRunner) {
			throw new Error(
			`[AgentStack] Streaming not configured.\n` +
			`Add to config: streaming: { runner: createStreamingCallbackRunner(...) }`,
		);
		}

		// Circuit breaker check
		if (circuitBreaker?.getState() === "OPEN") {
			// Import is already available via the orchestrator, but we throw directly here
			throw new Error("[AgentStack] Circuit breaker is OPEN. Streaming call rejected.");
		}

		const agent = resolveAgent(agentId);
		const channel = createStreamChannel<string>({ bufferSize: 100 });
		const abortController = new AbortController();

		// Combine signals — clean up listener on completion
		const onAbort = () => abortController.abort();
		if (options.signal) {
			options.signal.addEventListener("abort", onAbort, { once: true });
		}

		const span = obsInstance?.startSpan(`stream.${agentId}`);
		const startTime = Date.now();

		const { stream: chunkStream, result, abort: streamAbort } = streamingAgentRunner<T>(agent, input, {
			signal: abortController.signal,
		});

		// Pipe chunks through channel, extracting token strings
		const pipePromise = pipeThrough<StreamChunk, string>(
			chunkStream,
			channel,
			(chunk: StreamChunk) => (chunk.type === "token" ? chunk.data : ""),
		);

		// Track tokens + obs + metrics + bus from result
		const trackedResult = result.then((r) => {
			const latencyMs = Date.now() - startTime;
			totalTokens += r.totalTokens;

			// Clean up abort listener
			options.signal?.removeEventListener("abort", onAbort);

			// Observability span
			if (span) obsInstance?.endSpan(span.spanId, "ok");

			// Bus publish
			if (busInstance) {
				busInstance.publish({
					type: "INFORM",
					from: agentId,
					to: "*",
					topic: `${agentId}.stream.completed`,
					content: { tokenCount: r.totalTokens },
				} as Omit<TypedAgentMessage, "id" | "timestamp">);
			}

			// Metrics
			if (metrics) {
				metrics.trackRun(agentId, {
					success: true,
					latencyMs,
					cost: costRatePerMillion > 0 ? estimateCost(r.totalTokens, costRatePerMillion) : undefined,
				});
			}

			return r;
		}).catch((err) => {
			const latencyMs = Date.now() - startTime;
			options.signal?.removeEventListener("abort", onAbort);
			if (span) obsInstance?.endSpan(span.spanId, "error");
			if (metrics) metrics.trackRun(agentId, { success: false, latencyMs });
			throw err;
		});

		// Ensure pipe errors close channel gracefully
		pipePromise.catch((err) => {
			if (debug) console.debug("[AgentStack] Pipe error:", err);
		});

		return new TokenStreamImpl<T>(
			channel,
			trackedResult,
			() => {
				streamAbort();
				abortController.abort();
				options.signal?.removeEventListener("abort", onAbort);
			},
		);
	}

	// ============================================================================
	// streamChunks()
	// ============================================================================

	function streamChunks<T = unknown>(
		agentId: string,
		input: string,
		options: StackStreamOptions = {},
	): StreamingRunResult<T> {
		if (!streamingAgentRunner) {
			throw new Error(
				`[AgentStack] Streaming not configured.\n` +
				`Add to config: streaming: { runner: createStreamingCallbackRunner(...) }`,
			);
		}

		if (circuitBreaker?.getState() === "OPEN") {
			throw new Error("[AgentStack] Circuit breaker is OPEN. Streaming call rejected.");
		}

		const agent = resolveAgent(agentId);
		const abortController = new AbortController();

		const onAbort = () => abortController.abort();
		if (options.signal) {
			options.signal.addEventListener("abort", onAbort, { once: true });
		}

		const span = obsInstance?.startSpan(`streamChunks.${agentId}`);
		const startTime = Date.now();

		const { stream: chunkStream, result, abort: streamAbort } = streamingAgentRunner<T>(agent, input, {
			signal: abortController.signal,
		});

		// Track result for observability, metrics, and bus
		const trackedResult = result.then((r) => {
			const latencyMs = Date.now() - startTime;
			totalTokens += r.totalTokens;

			options.signal?.removeEventListener("abort", onAbort);
			if (span) obsInstance?.endSpan(span.spanId, "ok");
			if (busInstance) {
				busInstance.publish({
					type: "INFORM",
					from: agentId,
					to: "*",
					topic: `${agentId}.streamChunks.completed`,
					content: { tokenCount: r.totalTokens },
				} as Omit<TypedAgentMessage, "id" | "timestamp">);
			}
			if (metrics) {
				metrics.trackRun(agentId, {
					success: true,
					latencyMs,
					cost: costRatePerMillion > 0 ? estimateCost(r.totalTokens, costRatePerMillion) : undefined,
				});
			}
			return r;
		}).catch((err) => {
			const latencyMs = Date.now() - startTime;
			options.signal?.removeEventListener("abort", onAbort);
			if (span) obsInstance?.endSpan(span.spanId, "error");
			if (metrics) metrics.trackRun(agentId, { success: false, latencyMs });
			throw err;
		});

		let aborted = false;
		return {
			stream: chunkStream,
			result: trackedResult,
			abort: () => {
				if (aborted) return;
				aborted = true;
				streamAbort();
				abortController.abort();
				options.signal?.removeEventListener("abort", onAbort);
			},
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	function getState(): AgentStackState {
		// Compute rate limit remaining using index tracking (O(n) worst case on stale window, but avoids allocation)
		let rateLimitRemaining: number | null = null;
		if (config.rateLimit && rateLimitTimestamps) {
			const now = Date.now();
			const windowStart = now - 60_000;
			// Advance start index past expired entries
			while (rateLimitStartIdx < rateLimitTimestamps.length && rateLimitTimestamps[rateLimitStartIdx]! < windowStart) {
				rateLimitStartIdx++;
			}
			const active = rateLimitTimestamps.length - rateLimitStartIdx;
			rateLimitRemaining = Math.max(0, config.rateLimit.maxPerMinute - active);
		}

		return {
			totalTokens,
			estimatedCost: costRatePerMillion > 0 ? estimateCost(totalTokens, costRatePerMillion) : 0,
			circuitState: circuitBreaker?.getState() ?? "CLOSED",
			cacheStats: cacheInstance?.getStats() ?? { totalEntries: 0, totalHits: 0, totalMisses: 0, hitRate: 0, avgSimilarityOnHit: 0, oldestEntry: null, newestEntry: null },
			memoryMessageCount: memory?.getState()?.messages?.length ?? 0,
			busMessageCount: busInstance?.getHistory()?.length ?? 0,
			rateLimitRemaining,
		};
	}

	function reset(): void {
		memory?.clear();
		circuitBreaker?.reset();
		cacheInstance?.clear();
		obsInstance?.clear();
		busInstance?.clear();
		multi?.reset();
		if (rateLimitTimestamps) {
			rateLimitTimestamps.length = 0;
			rateLimitStartIdx = 0;
		}
		totalTokens = 0;
	}

	let disposed = false;
	async function dispose(): Promise<void> {
		if (disposed) return;
		disposed = true;

		// Flush OTLP one final time before clearing
		if (otlpInterval && obsInstance && otlpExporter) {
			clearInterval(otlpInterval);
			otlpInterval = null;
			try {
				const data = obsInstance.export();
				if (data.metrics.length > 0) otlpExporter.exportMetrics(data.metrics);
				if (data.traces.length > 0) otlpExporter.exportTraces(data.traces);
			} catch {
				// Best-effort flush on dispose
			}
		} else if (otlpInterval) {
			clearInterval(otlpInterval);
			otlpInterval = null;
		}
		orchestrator.dispose();
		multi?.dispose();
		await obsInstance?.dispose();
	}

	return {
		run,
		runStructured,
		runPattern,
		stream,
		streamChunks,
		approve: (requestId: string) => orchestrator.approve(requestId),
		reject: (requestId: string, reason?: string) => orchestrator.reject(requestId, reason),
		getState,
		reset,
		dispose,
		get orchestrator() { return orchestrator; },
		get observability() { return obsInstance; },
		get messageBus() { return busInstance; },
		get coordinator() { return multi; },
		get cache() { return cacheInstance; },
		get memory() { return memory; },
		getTimeline(limit = 50) {
			return {
				spans: obsInstance?.getTraces(limit) ?? [],
				metrics: obsInstance?.getDashboard()?.metrics ?? {},
			};
		},
	};
}
