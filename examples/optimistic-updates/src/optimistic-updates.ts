/**
 * Optimistic Updates — Directive Module
 *
 * Demonstrates optimistic mutations via events (instant UI), server sync via
 * constraint-resolver pattern, per-operation rollback from a sync queue,
 * resolver key deduplication, toast notifications, and context.snapshot().
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { mockServerSync } from "./mock-server.js";

// ============================================================================
// Types
// ============================================================================

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export type OpType = "toggle" | "delete" | "add";

export interface SyncQueueEntry {
  opId: string;
  itemId: string;
  op: OpType;
  undoItems: TodoItem[];
}

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// ID Generation
// ============================================================================

let nextId = 6; // items are pre-seeded 1-5
let nextOpId = 1;

// ============================================================================
// Schema
// ============================================================================

export const optimisticUpdatesSchema = {
  facts: {
    items: t.array<TodoItem>(),
    syncQueue: t.array<SyncQueueEntry>(),
    syncingOpId: t.string(),
    newItemText: t.string(),
    serverDelay: t.number(),
    failRate: t.number(),
    toastMessage: t.string(),
    toastType: t.string(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    totalCount: t.number(),
    doneCount: t.number(),
    pendingCount: t.number(),
    canAdd: t.boolean(),
    isSyncing: t.boolean(),
  },
  events: {
    toggleItem: { id: t.string() },
    deleteItem: { id: t.string() },
    addItem: {},
    setNewItemText: { value: t.string() },
    setServerDelay: { value: t.number() },
    setFailRate: { value: t.number() },
    dismissToast: {},
  },
  requirements: {
    SYNC_TODO: {
      opId: t.string(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...(facts.eventLog as EventLogEntry[])];
  log.push({ timestamp: Date.now(), event, detail });
  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const optimisticUpdatesModule = createModule("optimistic-updates", {
  schema: optimisticUpdatesSchema,

  init: (facts) => {
    facts.items = [
      { id: "1", text: "Buy groceries", done: false },
      { id: "2", text: "Learn Directive", done: true },
      { id: "3", text: "Walk the dog", done: false },
      { id: "4", text: "Read a book", done: false },
      { id: "5", text: "Fix the bug", done: true },
    ];
    facts.syncQueue = [];
    facts.syncingOpId = "";
    facts.newItemText = "";
    facts.serverDelay = 800;
    facts.failRate = 30;
    facts.toastMessage = "";
    facts.toastType = "";
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    totalCount: (facts) => facts.items.length,

    doneCount: (facts) => facts.items.filter((i) => i.done).length,

    pendingCount: (facts) => facts.syncQueue.length,

    canAdd: (facts) => facts.newItemText.trim() !== "",

    isSyncing: (facts) => facts.syncingOpId !== "",
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    toggleItem: (facts, { id }) => {
      const undoItems = facts.items.map((i) => ({ ...i }));

      facts.items = facts.items.map((i) =>
        i.id === id ? { ...i, done: !i.done } : i,
      );

      const opId = String(nextOpId++);
      const queue = [...facts.syncQueue];
      queue.push({ opId, itemId: id, op: "toggle", undoItems });
      facts.syncQueue = queue;

      addLogEntry(facts, "optimistic", `Toggle item ${id}`);
    },

    deleteItem: (facts, { id }) => {
      const undoItems = facts.items.map((i) => ({ ...i }));

      facts.items = facts.items.filter((i) => i.id !== id);

      const opId = String(nextOpId++);
      const queue = [...facts.syncQueue];
      queue.push({ opId, itemId: id, op: "delete", undoItems });
      facts.syncQueue = queue;

      addLogEntry(facts, "optimistic", `Delete item ${id}`);
    },

    addItem: (facts) => {
      const text = facts.newItemText.trim();
      if (!text) {
        return;
      }

      const undoItems = facts.items.map((i) => ({ ...i }));

      const itemId = String(nextId++);
      facts.items = [...facts.items, { id: itemId, text, done: false }];
      facts.newItemText = "";

      const opId = String(nextOpId++);
      const queue = [...facts.syncQueue];
      queue.push({ opId, itemId, op: "add", undoItems });
      facts.syncQueue = queue;

      addLogEntry(facts, "optimistic", `Add item "${text}"`);
    },

    setNewItemText: (facts, { value }) => {
      facts.newItemText = value;
    },

    setServerDelay: (facts, { value }) => {
      facts.serverDelay = value;
    },

    setFailRate: (facts, { value }) => {
      facts.failRate = value;
    },

    dismissToast: (facts) => {
      facts.toastMessage = "";
      facts.toastType = "";
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsSync: {
      priority: 100,
      when: (facts) => {
        return facts.syncQueue.length > 0 && facts.syncingOpId === "";
      },
      require: (facts) => {
        return {
          type: "SYNC_TODO",
          opId: facts.syncQueue[0].opId,
        };
      },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    syncTodo: {
      requirement: "SYNC_TODO",
      key: (req) => `sync-${req.opId}`,
      timeout: 10000,
      resolve: async (req, context) => {
        const entry = context.facts.syncQueue.find((e) => e.opId === req.opId);
        if (!entry) {
          return;
        }

        context.facts.syncingOpId = req.opId;
        addLogEntry(
          context.facts,
          "syncing",
          `Syncing ${entry.op} for item ${entry.itemId}...`,
        );

        const serverDelay = context.facts.serverDelay;
        const failRate = context.facts.failRate;

        try {
          await mockServerSync(entry.op, entry.itemId, serverDelay, failRate);

          addLogEntry(
            context.facts,
            "success",
            `${entry.op} item ${entry.itemId} synced`,
          );
          context.facts.toastMessage = `${entry.op} synced successfully`;
          context.facts.toastType = "success";
        } catch {
          context.facts.items = entry.undoItems;
          addLogEntry(
            context.facts,
            "rollback",
            `Failed to ${entry.op} item ${entry.itemId} — rolled back`,
          );
          context.facts.toastMessage = `Failed to ${entry.op} — rolled back`;
          context.facts.toastType = "error";
        }

        // Remove entry from queue
        context.facts.syncQueue = context.facts.syncQueue.filter(
          (e) => e.opId !== req.opId,
        );
        context.facts.syncingOpId = "";
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logSyncChange: {
      deps: ["syncingOpId"],
      run: (facts, prev) => {
        if (prev) {
          if (prev.syncingOpId === "" && facts.syncingOpId !== "") {
            addLogEntry(
              facts,
              "status",
              `Sync started: op ${facts.syncingOpId}`,
            );
          } else if (prev.syncingOpId !== "" && facts.syncingOpId === "") {
            addLogEntry(
              facts,
              "status",
              `Sync completed: op ${prev.syncingOpId}`,
            );
          }
        }
      },
    },
  },
});
