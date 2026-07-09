import { type ModuleSchema, t } from "@directive-run/core";
import { z } from "zod";

export const sourceCitation = z.object({
  url: z.string().url(),
  publisher: z.string(),
  tier: z.enum(["S", "A", "B", "C", "P"]),
});

export const articleFrontmatter = z.object({
  title: z.string(),
  slug: z.string(),
  publishedAt: z.string().datetime(),
  sources: z.array(sourceCitation).min(3),
  confidence: z.number().min(0).max(1),
  aiTier: z.enum(["1", "2", "3", "4", "5"]).default("5"),
});

export type ArticleFrontmatter = z.infer<typeof articleFrontmatter>;
export type SourceCitation = z.infer<typeof sourceCitation>;

export type PublishingStatus =
  | "idle"
  | "aggregating"
  | "reviewing"
  | "published"
  | "failed";

export interface IngestQueueEntry {
  url: string;
  capturedAt: string;
}

export interface ReviewQueueEntry {
  articleId: string;
  confidence: number;
}

export interface ErrorLogEntry {
  at: string;
  source: string;
  message: string;
}

export const schema = {
  facts: {
    status: t.string<PublishingStatus>(),
    currentArticle: t.object<Partial<ArticleFrontmatter>>(),
    ingestQueue: t.array<IngestQueueEntry>(),
    reviewQueue: t.array<ReviewQueueEntry>(),
    errorLog: t.array<ErrorLogEntry>(),
  },
  derivations: {
    queueDepth: t.number(),
    reviewDepth: t.number(),
    isReadyToAggregate: t.boolean(),
  },
  events: {
    ingest: { url: t.string() },
    tick: {},
  },
  requirements: {
    RUN_PUBLISHING_CHAIN: {
      sources: t.array<IngestQueueEntry>(),
    },
    ROUTE_ARTICLE: {
      article: t.object<Partial<ArticleFrontmatter>>(),
    },
  },
} satisfies ModuleSchema;
