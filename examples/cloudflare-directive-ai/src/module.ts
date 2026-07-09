import { createModule, createSystem } from "@directive-run/core";
import { sourceFromDOAlarm } from "@directive-run/sources/cloudflare";
import { schema, type PublishingStatus } from "./schema.js";
import type { AuditLog, Broadcaster } from "./deps.js";
import { createPublishingChain, type PublishingChain } from "./agents.js";

export interface PublishingDeps {
  auditLog: AuditLog;
  broadcaster: Broadcaster;
  anthropicApiKey: string;
  storage: DurableObjectStorage;
  intervalMs?: number;
}

export interface PublishingModuleHandle {
  alarmTick: () => void;
}

export function createPublishingSystem(deps: PublishingDeps) {
  const chain = createPublishingChain(deps.anthropicApiKey);
  const handle: PublishingModuleHandle = {
    alarmTick: () => {},
  };

  const alarmSource = sourceFromDOAlarm({
    storage: deps.storage,
    intervalMs: deps.intervalMs ?? 5 * 60 * 1000,
    eventName: "tick",
    payload: () => ({}),
    onTickRegistered: (tick) => {
      handle.alarmTick = tick;
    },
  });

  const publishingModule = createModule("publishing", {
    schema,

    init: (facts) => {
      facts.status = "idle" satisfies PublishingStatus;
      facts.currentArticle = {};
      facts.ingestQueue = [];
      facts.reviewQueue = [];
      facts.errorLog = [];
    },

    derive: {
      queueDepth: (facts) => facts.ingestQueue.length,
      reviewDepth: (facts) => facts.reviewQueue.length,
      isReadyToAggregate: (facts) =>
        facts.ingestQueue.length >= 3 && facts.status === "idle",
    },

    events: {
      ingest: (facts, payload) => {
        facts.ingestQueue = [
          ...facts.ingestQueue,
          { url: payload.url, capturedAt: new Date().toISOString() },
        ];
      },
      tick: (facts) => {
        if (facts.status === "failed" || facts.status === "published") {
          facts.status = "idle";
        }
      },
    },

    sources: {
      alarm: alarmSource,
    },

    constraints: {
      startAggregation: {
        priority: 100,
        when: (facts) =>
          facts.ingestQueue.length >= 3 && facts.status === "idle",
        require: (facts) => ({
          type: "RUN_PUBLISHING_CHAIN",
          sources: facts.ingestQueue.slice(0, 8),
        }),
      },

      routeArticle: {
        priority: 90,
        when: (facts) => facts.status === "reviewing",
        require: (facts) => ({
          type: "ROUTE_ARTICLE",
          article: facts.currentArticle,
        }),
      },
    },

    resolvers: {
      runChain: {
        requirement: "RUN_PUBLISHING_CHAIN",
        key: (req) => `chain-${req.sources.map((s) => s.url).join("|")}`,
        resolve: async (req, context) => {
          context.facts.status = "aggregating";
          context.facts.ingestQueue = context.facts.ingestQueue.slice(
            req.sources.length,
          );

          try {
            const result = await chain.run(req.sources, "demo");

            context.facts.currentArticle = result;
            context.facts.status = "reviewing";
            await deps.auditLog.append({
              event: "chain-completed",
              at: new Date().toISOString(),
              sources: req.sources.length,
              confidence: result.confidence,
              slug: result.slug,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            context.facts.errorLog = [
              ...context.facts.errorLog,
              {
                at: new Date().toISOString(),
                source: "publishing-chain",
                message,
              },
            ];
            context.facts.status = "failed";
            await deps.auditLog.append({
              event: "chain-failed",
              at: new Date().toISOString(),
              error: message,
            });
          }
        },
      },

      routeArticle: {
        requirement: "ROUTE_ARTICLE",
        key: (req) => `route-${req.article.slug ?? "unknown"}`,
        resolve: async (req, context) => {
          const confidence = req.article.confidence ?? 0;
          const slug = req.article.slug ?? "unknown";

          if (confidence >= 0.85) {
            await deps.broadcaster.send(req.article);
            context.facts.status = "published";
            await deps.auditLog.append({
              event: "auto-published",
              at: new Date().toISOString(),
              slug,
              confidence,
            });
          } else {
            context.facts.reviewQueue = [
              ...context.facts.reviewQueue,
              { articleId: slug, confidence },
            ];
            context.facts.status = "idle";
            await deps.auditLog.append({
              event: "routed-to-review",
              at: new Date().toISOString(),
              slug,
              confidence,
            });
          }
        },
      },
    },
  });

  const system = createSystem({ module: publishingModule });

  return { system, handle };
}

export type PublishingSystem = ReturnType<typeof createPublishingSystem>;
export type { PublishingChain };
