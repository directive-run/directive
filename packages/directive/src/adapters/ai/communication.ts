/**
 * Agent-to-Agent Communication Protocol
 *
 * Provides structured communication channels between agents for coordination,
 * delegation, and knowledge sharing without central orchestration.
 *
 * @example
 * ```typescript
 * import { createAgentNetwork, createMessageBus } from 'directive/openai-agents';
 *
 * const messageBus = createMessageBus();
 *
 * const network = createAgentNetwork({
 *   bus: messageBus,
 *   agents: {
 *     researcher: { capabilities: ['search', 'analyze'] },
 *     writer: { capabilities: ['draft', 'edit'] },
 *     reviewer: { capabilities: ['review', 'approve'] },
 *   },
 * });
 *
 * // Agents can send messages to each other
 * await network.send('researcher', 'writer', {
 *   type: 'DELEGATION',
 *   task: 'Draft an article based on this research',
 *   context: { findings: [...] },
 * });
 * ```
 */

// ============================================================================
// Message Types
// ============================================================================

/** Base message structure */
export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  from: string;
  to: string | string[] | "*"; // Single agent, multiple agents, or broadcast
  timestamp: number;
  correlationId?: string; // For request-response patterns
  replyTo?: string; // Message ID this is replying to
  priority?: "low" | "normal" | "high" | "urgent";
  ttlMs?: number; // Time-to-live
  metadata?: Record<string, unknown>;
}

/** Message types for agent communication */
export type AgentMessageType =
  | "REQUEST" // Request another agent to do something
  | "RESPONSE" // Response to a request
  | "DELEGATION" // Delegate a task to another agent
  | "DELEGATION_RESULT" // Result of a delegated task
  | "QUERY" // Ask for information
  | "INFORM" // Share information without expecting response
  | "SUBSCRIBE" // Subscribe to updates
  | "UNSUBSCRIBE" // Unsubscribe from updates
  | "UPDATE" // Push update to subscribers
  | "ACK" // Acknowledgment
  | "NACK" // Negative acknowledgment (rejection)
  | "PING" // Health check
  | "PONG" // Health check response
  | "CUSTOM"; // Custom message type

/** Request message */
export interface RequestMessage extends AgentMessage {
  type: "REQUEST";
  action: string;
  payload: Record<string, unknown>;
  timeout?: number;
}

/** Response message */
export interface ResponseMessage extends AgentMessage {
  type: "RESPONSE";
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Delegation message */
export interface DelegationMessage extends AgentMessage {
  type: "DELEGATION";
  task: string;
  context: Record<string, unknown>;
  constraints?: {
    deadline?: number;
    maxCost?: number;
    requiredCapabilities?: string[];
  };
}

/** Delegation result message */
export interface DelegationResultMessage extends AgentMessage {
  type: "DELEGATION_RESULT";
  success: boolean;
  result?: unknown;
  error?: string;
  metrics?: {
    durationMs: number;
    tokensUsed?: number;
    cost?: number;
  };
}

/** Query message */
export interface QueryMessage extends AgentMessage {
  type: "QUERY";
  question: string;
  context?: Record<string, unknown>;
}

/** Inform message */
export interface InformMessage extends AgentMessage {
  type: "INFORM";
  topic: string;
  content: unknown;
}

/** Subscribe message */
export interface SubscribeMessage extends AgentMessage {
  type: "SUBSCRIBE";
  topics: string[];
}

/** Update message */
export interface UpdateMessage extends AgentMessage {
  type: "UPDATE";
  topic: string;
  content: unknown;
}

/** Union of all message types */
export type TypedAgentMessage =
  | RequestMessage
  | ResponseMessage
  | DelegationMessage
  | DelegationResultMessage
  | QueryMessage
  | InformMessage
  | SubscribeMessage
  | UpdateMessage
  | (AgentMessage & { type: "UNSUBSCRIBE" | "ACK" | "NACK" | "PING" | "PONG" | "CUSTOM" });

// ============================================================================
// Message Bus Types
// ============================================================================

/** Message handler function */
export type MessageHandler = (message: TypedAgentMessage) => void | Promise<void>;

/** Subscription to messages */
export interface Subscription {
  id: string;
  agentId: string;
  handler: MessageHandler;
  filter?: MessageFilter;
  unsubscribe: () => void;
}

/** Message filter criteria */
export interface MessageFilter {
  types?: AgentMessageType[];
  from?: string | string[];
  topics?: string[];
  priority?: ("low" | "normal" | "high" | "urgent")[];
  custom?: (message: TypedAgentMessage) => boolean;
}

/** Message bus configuration */
export interface MessageBusConfig {
  /** Maximum messages to retain in history */
  maxHistory?: number;
  /** Default TTL for messages */
  defaultTtlMs?: number;
  /** Maximum pending messages per offline agent (prevents unbounded queue growth) */
  maxPendingPerAgent?: number;
  /** Enable message persistence */
  persistence?: MessagePersistence;
  /** Callback when message is delivered */
  onDelivery?: (message: TypedAgentMessage, recipients: string[]) => void;
  /** Callback when message delivery fails */
  onDeliveryError?: (message: TypedAgentMessage, error: Error) => void;
}

/** Message persistence interface */
export interface MessagePersistence {
  save(message: TypedAgentMessage): Promise<void>;
  load(agentId: string, since?: number): Promise<TypedAgentMessage[]>;
  delete(messageId: string): Promise<void>;
  clear(agentId?: string): Promise<void>;
}

/** Message bus instance */
export interface MessageBus {
  /** Publish a message */
  publish(message: Omit<TypedAgentMessage, "id" | "timestamp">): string;
  /** Subscribe to messages */
  subscribe(agentId: string, handler: MessageHandler, filter?: MessageFilter): Subscription;
  /** Get message history */
  getHistory(filter?: MessageFilter, limit?: number): TypedAgentMessage[];
  /** Get a specific message by ID */
  getMessage(id: string): TypedAgentMessage | undefined;
  /** Get pending messages for an agent */
  getPending(agentId: string): TypedAgentMessage[];
  /** Clear all messages and data */
  clear(): void;
  /** Dispose of the message bus, clearing all data and subscriptions */
  dispose(): void;
}

// ============================================================================
// Message Bus Factory
// ============================================================================

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a message bus for agent communication.
 *
 * @example
 * ```typescript
 * const bus = createMessageBus({ maxHistory: 1000 });
 *
 * // Subscribe to messages
 * bus.subscribe('writer', (msg) => {
 *   console.log(`Writer received: ${msg.type}`);
 * });
 *
 * // Publish a message
 * bus.publish({
 *   type: 'DELEGATION',
 *   from: 'researcher',
 *   to: 'writer',
 *   task: 'Write summary',
 *   context: { data: '...' },
 * });
 * ```
 */
/**
 * Note: `publish()` is fire-and-forget -- it returns the message ID synchronously
 * before delivery completes. Use `onDelivery` / `onDeliveryError` callbacks in
 * config to track delivery status if needed.
 */
export function createMessageBus(config: MessageBusConfig = {}): MessageBus {
  const {
    maxHistory = 1000,
    defaultTtlMs = 3600000, // 1 hour
    maxPendingPerAgent = 100,
    persistence,
    onDelivery,
    onDeliveryError,
  } = config;

  const subscriptions = new Map<string, Subscription[]>();
  const messageHistory: TypedAgentMessage[] = [];
  const messageIndex = new Map<string, TypedAgentMessage>(); // O(1) lookup by ID
  const pendingMessages = new Map<string, TypedAgentMessage[]>();

  function matchesFilter(message: TypedAgentMessage, filter: MessageFilter): boolean {
    if (filter.types && !filter.types.includes(message.type)) {
      return false;
    }
    if (filter.from) {
      const fromList = Array.isArray(filter.from) ? filter.from : [filter.from];
      if (!fromList.includes(message.from)) {
        return false;
      }
    }
    if (filter.topics) {
      const topic = (message as InformMessage | UpdateMessage).topic;
      if (topic && !filter.topics.includes(topic)) {
        return false;
      }
    }
    if (filter.priority && message.priority && !filter.priority.includes(message.priority)) {
      return false;
    }
    if (filter.custom && !filter.custom(message)) {
      return false;
    }
    return true;
  }

  function isExpired(message: TypedAgentMessage): boolean {
    if (!message.ttlMs) return false;
    return Date.now() - message.timestamp > message.ttlMs;
  }

  function getRecipients(message: TypedAgentMessage): string[] {
    if (message.to === "*") {
      return Array.from(subscriptions.keys());
    }
    if (Array.isArray(message.to)) {
      return message.to;
    }
    return [message.to];
  }

  async function deliverMessage(message: TypedAgentMessage): Promise<void> {
    // Skip expired messages
    if (isExpired(message)) return;

    const recipients = getRecipients(message);
    const deliveredTo: string[] = [];

    // Build delivery promises for all recipients in parallel
    const deliveryPromises: Promise<void>[] = [];

    for (const recipientId of recipients) {
      const recipientSubs = subscriptions.get(recipientId) ?? [];

      if (recipientSubs.length === 0) {
        // Queue message for offline agent (bounded)
        const pending = pendingMessages.get(recipientId) ?? [];
        pending.push(message);
        // Drop oldest if over limit
        while (pending.length > maxPendingPerAgent) {
          pending.shift();
        }
        pendingMessages.set(recipientId, pending);
        continue;
      }

      for (const sub of recipientSubs) {
        if (!sub.filter || matchesFilter(message, sub.filter)) {
          deliveryPromises.push(
            Promise.resolve(sub.handler(message)).then(
              () => { deliveredTo.push(recipientId); },
              (error) => { onDeliveryError?.(message, error instanceof Error ? error : new Error(String(error))); }
            )
          );
        }
      }
    }

    // Wait for all deliveries to settle in parallel
    if (deliveryPromises.length > 0) {
      await Promise.allSettled(deliveryPromises);
    }

    if (deliveredTo.length > 0) {
      onDelivery?.(message, deliveredTo);
    }

    // Persist if configured
    if (persistence) {
      await persistence.save(message);
    }
  }

  return {
    publish(partial: Omit<TypedAgentMessage, "id" | "timestamp">): string {
      const message: TypedAgentMessage = {
        ...partial,
        id: generateId(),
        timestamp: Date.now(),
        priority: partial.priority ?? "normal",
        ttlMs: partial.ttlMs ?? defaultTtlMs,
      } as TypedAgentMessage;

      // Add to history and index
      messageHistory.push(message);
      messageIndex.set(message.id, message);

      // Trim old messages (remove from both history and index)
      while (messageHistory.length > maxHistory) {
        const removed = messageHistory.shift();
        if (removed) {
          messageIndex.delete(removed.id);
        }
      }

      // Deliver asynchronously
      deliverMessage(message).catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (onDeliveryError) {
          onDeliveryError(message, err);
        } else {
          console.error("[Directive MessageBus] Delivery error:", err);
        }
      });

      return message.id;
    },

    subscribe(agentId: string, handler: MessageHandler, filter?: MessageFilter): Subscription {
      const subId = generateId();

      const subscription: Subscription = {
        id: subId,
        agentId,
        handler,
        filter,
        unsubscribe: () => {
          const subs = subscriptions.get(agentId) ?? [];
          const index = subs.findIndex((s) => s.id === subId);
          if (index >= 0) {
            subs.splice(index, 1);
          }
        },
      };

      const existing = subscriptions.get(agentId) ?? [];
      existing.push(subscription);
      subscriptions.set(agentId, existing);

      // Deliver pending messages
      const pending = pendingMessages.get(agentId) ?? [];
      pendingMessages.delete(agentId);
      for (const msg of pending) {
        if (!filter || matchesFilter(msg, filter)) {
          const result = handler(msg);
          if (result instanceof Promise) {
            result.catch((error) => {
              const err = error instanceof Error ? error : new Error(String(error));
              if (onDeliveryError) {
                onDeliveryError(msg, err);
              } else {
                console.error("[Directive MessageBus] Pending delivery error:", err);
              }
            });
          }
        }
      }

      return subscription;
    },

    getHistory(filter?: MessageFilter, limit = 100): TypedAgentMessage[] {
      let messages = messageHistory.filter((m) => !isExpired(m));

      if (filter) {
        messages = messages.filter((m) => matchesFilter(m, filter));
      }

      return messages.slice(-limit);
    },

    getMessage(id: string): TypedAgentMessage | undefined {
      const msg = messageIndex.get(id);
      if (msg && isExpired(msg)) return undefined;
      return msg;
    },

    getPending(agentId: string): TypedAgentMessage[] {
      const pending = pendingMessages.get(agentId) ?? [];
      return pending.filter((m) => !isExpired(m));
    },

    clear(): void {
      messageHistory.length = 0;
      messageIndex.clear();
      pendingMessages.clear();
    },

    dispose(): void {
      messageHistory.length = 0;
      messageIndex.clear();
      pendingMessages.clear();
      subscriptions.clear();
    },
  };
}

// ============================================================================
// Agent Network Types
// ============================================================================

/** Agent registration info */
export interface AgentInfo {
  id: string;
  capabilities: string[];
  status: "online" | "offline" | "busy";
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

/** Agent network configuration */
export interface AgentNetworkConfig {
  /** Message bus to use */
  bus: MessageBus;
  /** Registered agents */
  agents?: Record<string, Omit<AgentInfo, "id" | "lastSeen" | "status">>;
  /** Timeout for request-response patterns */
  defaultTimeout?: number;
  /** Callback when agent comes online */
  onAgentOnline?: (agentId: string) => void;
  /** Callback when agent goes offline */
  onAgentOffline?: (agentId: string) => void;
}

/** Agent network instance */
export interface AgentNetwork {
  /** Register an agent */
  register(id: string, info: Omit<AgentInfo, "id" | "lastSeen" | "status">): void;
  /** Unregister an agent */
  unregister(id: string): void;
  /** Get agent info */
  getAgent(id: string): AgentInfo | undefined;
  /** Get all agents */
  getAgents(): AgentInfo[];
  /** Find agents by capability */
  findByCapability(capability: string): AgentInfo[];
  /** Send a message */
  send(from: string, to: string | string[], message: Partial<TypedAgentMessage>): string;
  /** Send a request and wait for response */
  request(from: string, to: string, action: string, payload: Record<string, unknown>, timeout?: number): Promise<ResponseMessage>;
  /** Delegate a task */
  delegate(from: string, to: string, task: string, context: Record<string, unknown>): Promise<DelegationResultMessage>;
  /** Query an agent */
  query(from: string, to: string, question: string, context?: Record<string, unknown>): Promise<ResponseMessage>;
  /** Broadcast to all agents */
  broadcast(from: string, message: Partial<TypedAgentMessage>): string;
  /** Subscribe an agent to messages */
  listen(agentId: string, handler: MessageHandler, filter?: MessageFilter): Subscription;
  /** Get the message bus */
  getBus(): MessageBus;
  /** Dispose of the network, clearing pending waiters and timers */
  dispose(): void;
}

// ============================================================================
// Agent Network Factory
// ============================================================================

/**
 * Create an agent network for coordinated communication.
 *
 * @example
 * ```typescript
 * const network = createAgentNetwork({
 *   bus: createMessageBus(),
 *   agents: {
 *     researcher: { capabilities: ['search', 'summarize'] },
 *     writer: { capabilities: ['draft', 'edit'] },
 *     reviewer: { capabilities: ['review', 'approve'] },
 *   },
 * });
 *
 * // Delegate a task
 * const result = await network.delegate(
 *   'researcher',
 *   'writer',
 *   'Write an article about AI safety',
 *   { research: findingsData }
 * );
 *
 * // Query for information
 * const answer = await network.query(
 *   'writer',
 *   'reviewer',
 *   'Is this paragraph technically accurate?',
 *   { text: '...' }
 * );
 * ```
 */
export function createAgentNetwork(config: AgentNetworkConfig): AgentNetwork {
  const {
    bus,
    agents: initialAgents = {},
    defaultTimeout = 30000,
    onAgentOnline,
    onAgentOffline,
  } = config;

  const agents = new Map<string, AgentInfo>();
  const responseWaiters = new Map<string, {
    resolve: (msg: ResponseMessage | DelegationResultMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // Initialize agents
  for (const [id, info] of Object.entries(initialAgents)) {
    agents.set(id, {
      ...info,
      id,
      status: "offline",
      lastSeen: Date.now(),
    });
  }

  // Handle response messages
  function handleResponse(message: TypedAgentMessage): void {
    if (message.type !== "RESPONSE" && message.type !== "DELEGATION_RESULT") {
      return;
    }

    const correlationId = message.correlationId ?? message.replyTo;
    if (!correlationId) return;

    const waiter = responseWaiters.get(correlationId);
    if (waiter) {
      clearTimeout(waiter.timer);
      responseWaiters.delete(correlationId);
      waiter.resolve(message as ResponseMessage | DelegationResultMessage);
    }
  }

  return {
    register(id: string, info: Omit<AgentInfo, "id" | "lastSeen" | "status">): void {
      const wasOffline = !agents.has(id) || agents.get(id)?.status === "offline";

      agents.set(id, {
        ...info,
        id,
        status: "online",
        lastSeen: Date.now(),
      });

      if (wasOffline) {
        onAgentOnline?.(id);
      }
    },

    unregister(id: string): void {
      const agent = agents.get(id);
      if (agent) {
        agent.status = "offline";
        onAgentOffline?.(id);
      }
    },

    getAgent(id: string): AgentInfo | undefined {
      return agents.get(id);
    },

    getAgents(): AgentInfo[] {
      return Array.from(agents.values());
    },

    findByCapability(capability: string): AgentInfo[] {
      return Array.from(agents.values()).filter(
        (agent) => agent.capabilities.includes(capability) && agent.status === "online"
      );
    },

    send(from: string, to: string | string[], message: Partial<TypedAgentMessage>): string {
      // Update sender's lastSeen
      const sender = agents.get(from);
      if (sender) {
        sender.lastSeen = Date.now();
        sender.status = "online";
      }

      return bus.publish({
        ...message,
        from,
        to,
        type: message.type ?? "CUSTOM",
      } as Omit<TypedAgentMessage, "id" | "timestamp">);
    },

    async request(
      from: string,
      to: string,
      action: string,
      payload: Record<string, unknown>,
      timeout = defaultTimeout
    ): Promise<ResponseMessage> {
      return new Promise((resolve, reject) => {
        // Generate a correlation ID upfront so subscription can listen before publish
        const correlationId = generateId();

        // Subscribe BEFORE publishing to avoid race condition with fast responders
        const sub = bus.subscribe(from, (msg) => {
          if (msg.correlationId === correlationId || msg.replyTo === correlationId) {
            sub.unsubscribe();
            handleResponse(msg);
          }
        }, { types: ["RESPONSE"] });

        const timer = setTimeout(() => {
          sub.unsubscribe(); // Clean up subscription on timeout
          responseWaiters.delete(correlationId);
          reject(new Error(`[Directive Communication] Request timeout after ${timeout}ms`));
        }, timeout);

        responseWaiters.set(correlationId, { resolve: resolve as (msg: ResponseMessage | DelegationResultMessage) => void, reject, timer });

        bus.publish({
          type: "REQUEST",
          from,
          to,
          action,
          payload,
          timeout,
          correlationId,
        } as Omit<RequestMessage, "id" | "timestamp"> & { correlationId: string });
      });
    },

    async delegate(
      from: string,
      to: string,
      task: string,
      context: Record<string, unknown>
    ): Promise<DelegationResultMessage> {
      return new Promise((resolve, reject) => {
        const correlationId = generateId();

        // Subscribe BEFORE publishing to avoid race condition
        const sub = bus.subscribe(from, (msg) => {
          if (msg.correlationId === correlationId || msg.replyTo === correlationId) {
            sub.unsubscribe();
            handleResponse(msg);
          }
        }, { types: ["DELEGATION_RESULT"] });

        const timer = setTimeout(() => {
          sub.unsubscribe();
          responseWaiters.delete(correlationId);
          reject(new Error(`[Directive Communication] Delegation timeout after ${defaultTimeout}ms`));
        }, defaultTimeout);

        responseWaiters.set(correlationId, { resolve: resolve as (msg: ResponseMessage | DelegationResultMessage) => void, reject, timer });

        bus.publish({
          type: "DELEGATION",
          from,
          to,
          task,
          context,
          correlationId,
        } as Omit<DelegationMessage, "id" | "timestamp"> & { correlationId: string });
      });
    },

    async query(
      from: string,
      to: string,
      question: string,
      context?: Record<string, unknown>
    ): Promise<ResponseMessage> {
      return new Promise((resolve, reject) => {
        const correlationId = generateId();

        // Subscribe BEFORE publishing to avoid race condition
        const sub = bus.subscribe(from, (msg) => {
          if (msg.correlationId === correlationId || msg.replyTo === correlationId) {
            sub.unsubscribe();
            handleResponse(msg);
          }
        }, { types: ["RESPONSE"] });

        const timer = setTimeout(() => {
          sub.unsubscribe();
          responseWaiters.delete(correlationId);
          reject(new Error(`[Directive Communication] Query timeout after ${defaultTimeout}ms`));
        }, defaultTimeout);

        responseWaiters.set(correlationId, { resolve: resolve as (msg: ResponseMessage | DelegationResultMessage) => void, reject, timer });

        bus.publish({
          type: "QUERY",
          from,
          to,
          question,
          context,
          correlationId,
        } as Omit<QueryMessage, "id" | "timestamp"> & { correlationId: string });
      });
    },

    broadcast(from: string, message: Partial<TypedAgentMessage>): string {
      return bus.publish({
        ...message,
        from,
        to: "*",
        type: message.type ?? "INFORM",
      } as Omit<TypedAgentMessage, "id" | "timestamp">);
    },

    listen(agentId: string, handler: MessageHandler, filter?: MessageFilter): Subscription {
      // Mark agent as online
      const agent = agents.get(agentId);
      if (agent) {
        agent.status = "online";
        agent.lastSeen = Date.now();
        onAgentOnline?.(agentId);
      }

      return bus.subscribe(agentId, handler, filter);
    },

    getBus(): MessageBus {
      return bus;
    },

    dispose(): void {
      // Clear all pending response waiters and their timers
      for (const [, waiter] of responseWaiters) {
        clearTimeout(waiter.timer);
      }
      responseWaiters.clear();
      agents.clear();
    },
  };
}

// ============================================================================
// Communication Patterns
// ============================================================================

/**
 * Create a request-response helper for handling incoming requests.
 *
 * @example
 * ```typescript
 * const responder = createResponder(network, 'writer');
 *
 * responder.onRequest('draft', async (payload) => {
 *   const draft = await generateDraft(payload.topic);
 *   return { success: true, result: draft };
 * });
 * ```
 */
export function createResponder(network: AgentNetwork, agentId: string) {
  const handlers = new Map<string, (payload: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>>();

  const subscription = network.listen(agentId, async (message) => {
    if (message.type === "REQUEST") {
      const request = message as RequestMessage;
      const handler = handlers.get(request.action);

      let response: Partial<ResponseMessage>;
      if (handler) {
        try {
          const result = await handler(request.payload);
          response = {
            type: "RESPONSE",
            success: result.success,
            result: result.result,
            error: result.error,
          };
        } catch (error) {
          response = {
            type: "RESPONSE",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      } else {
        response = {
          type: "RESPONSE",
          success: false,
          error: `Unknown action: ${request.action}`,
        };
      }

      network.send(agentId, message.from, {
        ...response,
        correlationId: message.correlationId ?? message.id,
        replyTo: message.correlationId ?? message.id,
      });
    }
  }, { types: ["REQUEST"] });

  return {
    onRequest(
      action: string,
      handler: (payload: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>
    ): void {
      handlers.set(action, handler);
    },

    /** Remove a request handler */
    offRequest(action: string): void {
      handlers.delete(action);
    },

    /** Dispose of this responder, unsubscribing from network */
    dispose(): void {
      subscription.unsubscribe();
      handlers.clear();
    },
  };
}

/**
 * Create a task delegator for handling incoming delegations.
 *
 * @example
 * ```typescript
 * const delegator = createDelegator(network, 'writer');
 *
 * delegator.onDelegation(async (task, context) => {
 *   const result = await executeTask(task, context);
 *   return {
 *     success: true,
 *     result,
 *     metrics: { durationMs: 1500, tokensUsed: 500 },
 *   };
 * });
 * ```
 */
export function createDelegator(network: AgentNetwork, agentId: string) {
  let delegationHandler: ((task: string, context: Record<string, unknown>) => Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    metrics?: { durationMs: number; tokensUsed?: number; cost?: number };
  }>) | null = null;

  const subscription = network.listen(agentId, async (message) => {
    if (message.type === "DELEGATION" && delegationHandler) {
      const delegation = message as DelegationMessage;
      const start = Date.now();

      let result: Partial<DelegationResultMessage>;
      try {
        const response = await delegationHandler(delegation.task, delegation.context);
        result = {
          type: "DELEGATION_RESULT",
          success: response.success,
          result: response.result,
          error: response.error,
          metrics: response.metrics ?? { durationMs: Date.now() - start },
        };
      } catch (error) {
        result = {
          type: "DELEGATION_RESULT",
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metrics: { durationMs: Date.now() - start },
        };
      }

      network.send(agentId, message.from, {
        ...result,
        correlationId: message.correlationId ?? message.id,
        replyTo: message.correlationId ?? message.id,
      });
    }
  }, { types: ["DELEGATION"] });

  return {
    onDelegation(
      handler: (task: string, context: Record<string, unknown>) => Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
        metrics?: { durationMs: number; tokensUsed?: number; cost?: number };
      }>
    ): void {
      delegationHandler = handler;
    },

    /** Remove the delegation handler */
    offDelegation(): void {
      delegationHandler = null;
    },

    /** Dispose of this delegator, unsubscribing from network */
    dispose(): void {
      subscription.unsubscribe();
      delegationHandler = null;
    },
  };
}

/**
 * Create a pub/sub helper for topic-based communication.
 *
 * @example
 * ```typescript
 * const pubsub = createPubSub(network, 'analyst');
 *
 * // Subscribe to topics
 * pubsub.subscribe(['market-updates', 'alerts'], (topic, content) => {
 *   console.log(`Received ${topic}:`, content);
 * });
 *
 * // Publish to topics
 * pubsub.publish('market-updates', { price: 100, change: 5 });
 * ```
 */
export function createPubSub(network: AgentNetwork, agentId: string) {
  const topicHandlers = new Map<string, Array<(content: unknown) => void>>();

  const subscription = network.listen(agentId, (message) => {
    if (message.type === "UPDATE") {
      const update = message as UpdateMessage;
      const handlers = topicHandlers.get(update.topic) ?? [];
      for (const handler of handlers) {
        handler(update.content);
      }
    }
  }, { types: ["UPDATE"] });

  return {
    subscribe(topics: string[], handler: (topic: string, content: unknown) => void): () => void {
      // Track wrapped handlers per-subscribe call for proper cleanup
      const wrappedHandlers = new Map<string, (content: unknown) => void>();

      for (const topic of topics) {
        const handlers = topicHandlers.get(topic) ?? [];
        const wrappedHandler = (content: unknown) => handler(topic, content);
        wrappedHandlers.set(topic, wrappedHandler);
        handlers.push(wrappedHandler);
        topicHandlers.set(topic, handlers);
      }

      // Announce subscription
      network.broadcast(agentId, {
        type: "SUBSCRIBE",
        topics,
      } as Partial<SubscribeMessage>);

      return () => {
        // Only remove this subscription's handlers, not all handlers for the topic
        for (const [topic, wrappedHandler] of wrappedHandlers) {
          const handlers = topicHandlers.get(topic);
          if (handlers) {
            const idx = handlers.indexOf(wrappedHandler);
            if (idx >= 0) handlers.splice(idx, 1);
            if (handlers.length === 0) topicHandlers.delete(topic);
          }
        }
        wrappedHandlers.clear();
        network.broadcast(agentId, {
          type: "UNSUBSCRIBE",
          topics,
        } as Partial<AgentMessage & { type: "UNSUBSCRIBE"; topics: string[] }>);
      };
    },

    publish(topic: string, content: unknown): void {
      network.broadcast(agentId, {
        type: "UPDATE",
        topic,
        content,
      } as Partial<UpdateMessage>);
    },

    /** Dispose of this pub/sub, unsubscribing from network and clearing handlers */
    dispose(): void {
      subscription.unsubscribe();
      topicHandlers.clear();
    },
  };
}
