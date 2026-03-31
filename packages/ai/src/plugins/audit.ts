/**
 * Audit Plugin - Immutable Audit Trail with Hash Chain
 *
 * Provides enterprise-grade audit logging with:
 * - Cryptographic hash chain for tamper detection
 * - Bounded storage with FIFO eviction
 * - PII masking with configurable redaction
 * - Optional signing for non-repudiation
 * - Async export to external systems
 *
 * @example
 * ```typescript
 * import { createAuditTrail } from '@directive-run/ai';
 *
 * const audit = createAuditTrail({
 *   maxEntries: 10000,
 *   retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
 *   piiMasking: {
 *     enabled: true,
 *     types: ['ssn', 'credit_card', 'email'],
 *     redactionStyle: 'typed',
 *   },
 *   exporter: async (entries) => {
 *     await sendToSIEM(entries);
 *   },
 * });
 *
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [audit.createPlugin()],
 * });
 * ```
 */

import type { ModuleSchema, Plugin } from "@directive-run/core";
import type { PIIType, RedactionStyle } from "../guardrails/pii-enhanced.js";
import { detectPII, redactPII } from "../guardrails/pii-enhanced.js";

// ============================================================================
// Types
// ============================================================================

/** Audit event types - 22 total covering all system operations */
export type AuditEventType =
  // Agent lifecycle
  | "agent.run.start"
  | "agent.run.complete"
  | "agent.run.error"
  // Tool operations
  | "tool.call.start"
  | "tool.call.complete"
  | "tool.call.error"
  // Human-in-the-loop
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  // Requirement lifecycle
  | "requirement.created"
  | "requirement.met"
  // Resolver operations
  | "resolver.start"
  | "resolver.complete"
  | "resolver.error"
  // Fact mutations
  | "fact.set"
  | "fact.batch"
  // Error handling
  | "error.occurred"
  | "error.recovery"
  // Checkpoint operations
  | "checkpoint.save"
  | "checkpoint.restore"
  | "checkpoint.fork"
  | "checkpoint.replay";

/** Single audit entry with hash chain linking */
export interface AuditEntry {
  /** Unique identifier for this entry */
  id: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Type of event */
  eventType: AuditEventType;
  /** SHA-256 hash of previous entry (empty string for genesis) */
  previousHash: string;
  /** SHA-256 hash of this entry's content */
  hash: string;
  /** Event payload data */
  payload: Record<string, unknown>;
  /** PII-redacted version of payload (if masking enabled) */
  maskedPayload?: Record<string, unknown>;
  /** Actor identifier (user, agent, or system) */
  actorId?: string;
  /** Session identifier for correlation */
  sessionId?: string;
  /** Cryptographic signature (if signing enabled) */
  signature?: string;
}

/** Filter options for querying audit entries */
export interface AuditEntryFilter {
  /** Filter by event types */
  eventTypes?: AuditEventType[];
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Start of time range */
  since?: number;
  /** End of time range */
  until?: number;
  /** Maximum entries to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/** Result of chain verification */
export interface AuditVerificationResult {
  /** Whether the chain is valid */
  valid: boolean;
  /** Number of entries verified */
  entriesVerified: number;
  /** First broken link (if any) */
  brokenAt?: {
    index: number;
    entryId: string;
    expectedHash: string;
    actualHash: string;
  };
  /** Verification timestamp */
  verifiedAt: number;
}

/** Audit statistics */
export interface AuditStats {
  /** Total entries in trail */
  totalEntries: number;
  /** Entries by event type */
  byEventType: Partial<Record<AuditEventType, number>>;
  /** Oldest entry timestamp */
  oldestEntry?: number;
  /** Newest entry timestamp */
  newestEntry?: number;
  /** Number of entries pruned */
  entriesPruned: number;
  /** Number of entries exported */
  entriesExported: number;
  /** Chain integrity (true if verified valid) */
  chainIntegrity: boolean;
}

/** PII masking configuration */
export interface PIIMaskingConfig {
  /** Enable PII masking */
  enabled: boolean;
  /** PII types to detect and mask */
  types: PIIType[];
  /** Redaction style */
  redactionStyle: RedactionStyle;
  /** Custom allowlist (values to skip) */
  allowlist?: string[];
  /** Minimum confidence threshold */
  minConfidence?: number;
}

/** Signing configuration for non-repudiation */
export interface SigningConfig {
  /** Function to sign a hash value */
  signFn: (hash: string) => Promise<string>;
  /** Function to verify a signature */
  verifyFn?: (hash: string, signature: string) => Promise<boolean>;
}

/** Audit plugin configuration */
export interface AuditPluginConfig {
  /** Maximum entries to retain (default: 10000) */
  maxEntries?: number;
  /** Retention period in milliseconds (default: 7 days) */
  retentionMs?: number;
  /** Export interval in milliseconds (default: 60000) */
  exportInterval?: number;
  /** Async exporter function */
  exporter?: (entries: AuditEntry[]) => Promise<void>;
  /** PII masking configuration */
  piiMasking?: PIIMaskingConfig;
  /** Signing configuration for non-repudiation */
  signing?: SigningConfig;
  /** Session ID for all entries */
  sessionId?: string;
  /** Actor ID for all entries */
  actorId?: string;
  /** Event callbacks */
  events?: {
    onEntryAdded?: (entry: AuditEntry) => void;
    onChainBroken?: (result: AuditVerificationResult) => void;
    onExportError?: (error: Error, entries: AuditEntry[]) => void;
  };
}

/** Audit trail instance */
export interface AuditInstance {
  /** Get entries with optional filtering */
  getEntries(filter?: AuditEntryFilter): AuditEntry[];
  /** Verify the integrity of the hash chain */
  verifyChain(): Promise<AuditVerificationResult>;
  /** Export entries since timestamp */
  export(since?: number): Promise<AuditEntry[]>;
  /** Prune old entries based on retention policy */
  prune(): number;
  /** Get audit statistics */
  getStats(): AuditStats;
  /** Destroy the instance (clears timers, flushes exports) */
  destroy(): Promise<void>;
  /** Create a plugin for a directive system */
  createPlugin<M extends ModuleSchema>(): Plugin<M>;
  /** Add a custom audit entry */
  addEntry(
    eventType: AuditEventType,
    payload: Record<string, unknown>,
  ): Promise<AuditEntry>;
}

// ============================================================================
// Constants
// ============================================================================

/** Default maximum entries */
const DEFAULT_MAX_ENTRIES = 10000;

/** Default retention period (7 days) */
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Default export interval (60 seconds) */
const DEFAULT_EXPORT_INTERVAL = 60000;

/** Genesis block previous hash */
const GENESIS_PREVIOUS_HASH = "0".repeat(64);

// ============================================================================
// Utility Functions
// ============================================================================

/** Generate a unique ID */
function generateId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
  );
}

/** Convert string to Uint8Array */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert Uint8Array to hex string */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Calculate SHA-256 hash of content */
async function sha256(content: string): Promise<string> {
  const bytes = stringToBytes(content);
  const hashBuffer = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return bytesToHex(new Uint8Array(hashBuffer));
}

/** Create hash content from entry (deterministic serialization) */
function createHashContent(
  entry: Omit<AuditEntry, "hash" | "signature">,
): string {
  const {
    id,
    timestamp,
    eventType,
    previousHash,
    payload,
    actorId,
    sessionId,
  } = entry;
  return JSON.stringify({
    id,
    timestamp,
    eventType,
    previousHash,
    payload,
    actorId,
    sessionId,
  });
}

/** Deep clone an object */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Mask PII in a payload object */
async function maskPayload(
  payload: Record<string, unknown>,
  config: PIIMaskingConfig,
): Promise<Record<string, unknown>> {
  const masked = deepClone(payload);

  // Recursively process all string values
  async function processValue(value: unknown): Promise<unknown> {
    if (typeof value === "string") {
      const result = await detectPII(value, {
        types: config.types,
        minConfidence: config.minConfidence ?? 0.7,
      });

      if (result.detected) {
        // Filter by allowlist
        const itemsToRedact = config.allowlist
          ? result.items.filter(
              (item) => !config.allowlist!.includes(item.value.toLowerCase()),
            )
          : result.items;

        if (itemsToRedact.length > 0) {
          return redactPII(value, itemsToRedact, config.redactionStyle);
        }
      }
      return value;
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map(processValue));
    }

    if (value && typeof value === "object") {
      const processed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        processed[k] = await processValue(v);
      }
      return processed;
    }

    return value;
  }

  for (const [key, value] of Object.entries(masked)) {
    masked[key] = await processValue(value);
  }

  return masked;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an audit trail instance for enterprise-grade audit logging.
 *
 * Features:
 * - Immutable hash chain for tamper detection
 * - Bounded storage with automatic FIFO eviction
 * - PII masking with configurable redaction styles
 * - Optional cryptographic signing for non-repudiation
 * - Async export to external SIEM/logging systems
 *
 * @example
 * ```typescript
 * const audit = createAuditTrail({
 *   maxEntries: 10000,
 *   piiMasking: {
 *     enabled: true,
 *     types: ['ssn', 'credit_card'],
 *     redactionStyle: 'typed',
 *   },
 *   exporter: async (entries) => {
 *     await fetch('/api/audit', {
 *       method: 'POST',
 *       body: JSON.stringify(entries),
 *     });
 *   },
 * });
 *
 * // Use with directive system
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [audit.createPlugin()],
 * });
 *
 * // Query audit entries
 * const recentErrors = audit.getEntries({
 *   eventTypes: ['error.occurred', 'error.recovery'],
 *   since: Date.now() - 3600000, // Last hour
 * });
 *
 * // Verify chain integrity
 * const verification = await audit.verifyChain();
 * if (!verification.valid) {
 *   console.error('Audit chain tampered!', verification.brokenAt);
 * }
 * ```
 */
export function createAuditTrail(
  config: AuditPluginConfig = {},
): AuditInstance {
  const {
    maxEntries = DEFAULT_MAX_ENTRIES,
    retentionMs = DEFAULT_RETENTION_MS,
    exportInterval = DEFAULT_EXPORT_INTERVAL,
    exporter,
    piiMasking,
    signing,
    sessionId,
    actorId,
    events = {},
  } = config;

  // State
  const entries: AuditEntry[] = [];
  let lastExportIndex = 0;
  let entriesPruned = 0;
  let entriesExported = 0;
  let chainVerified = true;
  let exportTimer: ReturnType<typeof setInterval> | undefined;

  // Get the hash of the last entry (or genesis hash)
  function getLastHash(): string {
    if (entries.length === 0) {
      return GENESIS_PREVIOUS_HASH;
    }
    return entries[entries.length - 1]!.hash;
  }

  // Add a new entry to the trail
  async function addEntry(
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    overrides?: { actorId?: string; sessionId?: string },
  ): Promise<AuditEntry> {
    const entry: Omit<AuditEntry, "hash" | "signature"> = {
      id: generateId(),
      timestamp: Date.now(),
      eventType,
      previousHash: getLastHash(),
      payload,
      actorId: overrides?.actorId ?? actorId,
      sessionId: overrides?.sessionId ?? sessionId,
    };

    // Apply PII masking if enabled
    if (piiMasking?.enabled) {
      entry.maskedPayload = await maskPayload(payload, piiMasking);
    }

    // Calculate hash
    const hashContent = createHashContent(entry);
    const hash = await sha256(hashContent);

    const fullEntry: AuditEntry = {
      ...entry,
      hash,
    };

    // Apply signing if configured
    if (signing) {
      fullEntry.signature = await signing.signFn(hash);
    }

    // Add to trail
    entries.push(fullEntry);

    // Enforce max entries (FIFO eviction)
    while (entries.length > maxEntries) {
      entries.shift();
      entriesPruned++;
      // Adjust export index if entries were evicted
      if (lastExportIndex > 0) {
        lastExportIndex--;
      }
    }

    events.onEntryAdded?.(fullEntry);

    return fullEntry;
  }

  // Start export timer if configured
  if (exporter && exportInterval > 0) {
    exportTimer = setInterval(async () => {
      try {
        const toExport = entries.slice(lastExportIndex);
        if (toExport.length > 0) {
          await exporter(toExport);
          entriesExported += toExport.length;
          lastExportIndex = entries.length;
        }
      } catch (error) {
        events.onExportError?.(
          error instanceof Error ? error : new Error(String(error)),
          entries.slice(lastExportIndex),
        );
      }
    }, exportInterval);
  }

  return {
    getEntries(filter?: AuditEntryFilter): AuditEntry[] {
      let result = [...entries];

      if (filter) {
        if (filter.eventTypes?.length) {
          const typeSet = new Set(filter.eventTypes);
          result = result.filter((e) => typeSet.has(e.eventType));
        }

        if (filter.actorId) {
          result = result.filter((e) => e.actorId === filter.actorId);
        }

        if (filter.sessionId) {
          result = result.filter((e) => e.sessionId === filter.sessionId);
        }

        if (filter.since !== undefined) {
          result = result.filter((e) => e.timestamp >= filter.since!);
        }

        if (filter.until !== undefined) {
          result = result.filter((e) => e.timestamp <= filter.until!);
        }

        if (filter.offset !== undefined) {
          result = result.slice(filter.offset);
        }

        if (filter.limit !== undefined) {
          result = result.slice(0, filter.limit);
        }
      }

      return result;
    },

    async verifyChain(): Promise<AuditVerificationResult> {
      if (entries.length === 0) {
        return {
          valid: true,
          entriesVerified: 0,
          verifiedAt: Date.now(),
        };
      }

      // Verify first entry links to genesis
      const firstEntry = entries[0]!;
      if (firstEntry.previousHash !== GENESIS_PREVIOUS_HASH) {
        // First entry doesn't link to genesis - this could happen after pruning
        // We verify the chain is internally consistent instead
      }

      // Verify each entry's hash and link
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;

        // Recalculate hash
        const hashContent = createHashContent({
          id: entry.id,
          timestamp: entry.timestamp,
          eventType: entry.eventType,
          previousHash: entry.previousHash,
          payload: entry.payload,
          actorId: entry.actorId,
          sessionId: entry.sessionId,
        });
        const expectedHash = await sha256(hashContent);

        if (entry.hash !== expectedHash) {
          chainVerified = false;
          const result: AuditVerificationResult = {
            valid: false,
            entriesVerified: i,
            brokenAt: {
              index: i,
              entryId: entry.id,
              expectedHash,
              actualHash: entry.hash,
            },
            verifiedAt: Date.now(),
          };
          events.onChainBroken?.(result);
          return result;
        }

        // Verify chain linkage (except for first entry after pruning)
        if (i > 0) {
          const prevEntry = entries[i - 1]!;
          if (entry.previousHash !== prevEntry.hash) {
            chainVerified = false;
            const result: AuditVerificationResult = {
              valid: false,
              entriesVerified: i,
              brokenAt: {
                index: i,
                entryId: entry.id,
                expectedHash: prevEntry.hash,
                actualHash: entry.previousHash,
              },
              verifiedAt: Date.now(),
            };
            events.onChainBroken?.(result);
            return result;
          }
        }

        // Verify signature if signing is configured
        if (signing?.verifyFn && entry.signature) {
          const signatureValid = await signing.verifyFn(
            entry.hash,
            entry.signature,
          );
          if (!signatureValid) {
            chainVerified = false;
            const result: AuditVerificationResult = {
              valid: false,
              entriesVerified: i,
              brokenAt: {
                index: i,
                entryId: entry.id,
                expectedHash: "signature-invalid",
                actualHash: entry.signature,
              },
              verifiedAt: Date.now(),
            };
            events.onChainBroken?.(result);
            return result;
          }
        }
      }

      chainVerified = true;
      return {
        valid: true,
        entriesVerified: entries.length,
        verifiedAt: Date.now(),
      };
    },

    async export(since?: number): Promise<AuditEntry[]> {
      let toExport = [...entries];

      if (since !== undefined) {
        toExport = toExport.filter((e) => e.timestamp >= since);
      }

      if (exporter && toExport.length > 0) {
        await exporter(toExport);
        entriesExported += toExport.length;
      }

      return toExport;
    },

    prune(): number {
      const cutoff = Date.now() - retentionMs;
      const initialLength = entries.length;

      // Remove entries older than retention period
      while (entries.length > 0 && entries[0]!.timestamp < cutoff) {
        entries.shift();
        if (lastExportIndex > 0) {
          lastExportIndex--;
        }
      }

      const pruned = initialLength - entries.length;
      entriesPruned += pruned;
      return pruned;
    },

    getStats(): AuditStats {
      const byEventType: Partial<Record<AuditEventType, number>> = {};

      for (const entry of entries) {
        byEventType[entry.eventType] = (byEventType[entry.eventType] ?? 0) + 1;
      }

      return {
        totalEntries: entries.length,
        byEventType,
        oldestEntry: entries[0]?.timestamp,
        newestEntry: entries[entries.length - 1]?.timestamp,
        entriesPruned,
        entriesExported,
        chainIntegrity: chainVerified,
      };
    },

    async destroy(): Promise<void> {
      // Clear export timer
      if (exportTimer) {
        clearInterval(exportTimer);
        exportTimer = undefined;
      }

      // Flush remaining entries to exporter
      if (exporter) {
        try {
          const toExport = entries.slice(lastExportIndex);
          if (toExport.length > 0) {
            await exporter(toExport);
            entriesExported += toExport.length;
          }
        } catch (error) {
          events.onExportError?.(
            error instanceof Error ? error : new Error(String(error)),
            entries.slice(lastExportIndex),
          );
        }
      }
    },

    addEntry(
      eventType: AuditEventType,
      payload: Record<string, unknown>,
    ): Promise<AuditEntry> {
      return addEntry(eventType, payload);
    },

    createPlugin<M extends ModuleSchema>(): Plugin<M> {
      return {
        name: "audit-trail",

        // Fact operations
        onFactSet: (key, value, prev) => {
          addEntry("fact.set", { key, value, prev }).catch(console.error);
        },

        onFactsBatch: (changes) => {
          addEntry("fact.batch", {
            changes: changes.map((c) => ({
              key: c.key,
              value: c.value,
              prev: c.prev,
            })),
          }).catch(console.error);
        },

        // Requirement lifecycle
        onRequirementCreated: (req) => {
          addEntry("requirement.created", {
            id: req.id,
            type: req.requirement.type,
            payload: req.requirement,
          }).catch(console.error);
        },

        onRequirementMet: (req, byResolver) => {
          addEntry("requirement.met", {
            id: req.id,
            type: req.requirement.type,
            byResolver,
          }).catch(console.error);
        },

        // Resolver operations
        onResolverStart: (resolver, req) => {
          addEntry("resolver.start", {
            resolver,
            requirementId: req.id,
            requirementType: req.requirement.type,
          }).catch(console.error);
        },

        onResolverComplete: (resolver, req, duration) => {
          addEntry("resolver.complete", {
            resolver,
            requirementId: req.id,
            requirementType: req.requirement.type,
            duration,
          }).catch(console.error);
        },

        onResolverError: (resolver, req, error) => {
          addEntry("resolver.error", {
            resolver,
            requirementId: req.id,
            requirementType: req.requirement.type,
            error: error instanceof Error ? error.message : String(error),
          }).catch(console.error);
        },

        // Error handling
        onError: (error) => {
          addEntry("error.occurred", {
            source: error.source,
            sourceId: error.sourceId,
            message: error.message,
            context: error.context,
          }).catch(console.error);
        },

        onErrorRecovery: (error, strategy) => {
          addEntry("error.recovery", {
            source: error.source,
            message: error.message,
            strategy,
          }).catch(console.error);
        },
      };
    },
  };
}

// ============================================================================
// Agent Orchestrator Integration
// ============================================================================

/**
 * Create audit event handlers for agent orchestrator integration.
 * Use this to audit agent operations when using the agent orchestrator.
 *
 * @example
 * ```typescript
 * const audit = createAuditTrail({ ... });
 * const handlers = createAgentAuditHandlers(audit);
 *
 * // Use in orchestrator callbacks
 * orchestrator.run(agent, input, {
 *   onStart: handlers.onAgentStart,
 *   onComplete: handlers.onAgentComplete,
 *   // ...
 * });
 * ```
 */
export function createAgentAuditHandlers(audit: AuditInstance) {
  return {
    onAgentStart: (agentName: string, input: string) => {
      audit.addEntry("agent.run.start", { agentName, input });
    },

    onAgentComplete: (
      agentName: string,
      output: unknown,
      tokens: number,
      cost: number,
    ) => {
      audit.addEntry("agent.run.complete", { agentName, output, tokens, cost });
    },

    onAgentError: (agentName: string, error: Error) => {
      audit.addEntry("agent.run.error", {
        agentName,
        error: error.message,
        stack: error.stack,
      });
    },

    onToolStart: (toolName: string, toolCallId: string, args: unknown) => {
      audit.addEntry("tool.call.start", { toolName, toolCallId, args });
    },

    onToolComplete: (toolName: string, toolCallId: string, result: unknown) => {
      audit.addEntry("tool.call.complete", { toolName, toolCallId, result });
    },

    onToolError: (toolName: string, toolCallId: string, error: Error) => {
      audit.addEntry("tool.call.error", {
        toolName,
        toolCallId,
        error: error.message,
      });
    },

    onApprovalRequested: (
      toolName: string,
      toolCallId: string,
      args: unknown,
    ) => {
      audit.addEntry("approval.requested", { toolName, toolCallId, args });
    },

    onApprovalGranted: (toolName: string, toolCallId: string) => {
      audit.addEntry("approval.granted", { toolName, toolCallId });
    },

    onApprovalDenied: (
      toolName: string,
      toolCallId: string,
      reason?: string,
    ) => {
      audit.addEntry("approval.denied", { toolName, toolCallId, reason });
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  createAuditTrail as create,
  createAgentAuditHandlers as createHandlers,
};
