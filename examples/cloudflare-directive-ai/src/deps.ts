import type { ArticleFrontmatter } from './schema.js';

export interface AuditLogEvent {
  event: string;
  at: string;
  [key: string]: unknown;
}

export interface AuditLog {
  append: (event: AuditLogEvent) => Promise<void>;
}

export interface Broadcaster {
  send: (article: Partial<ArticleFrontmatter>) => Promise<void>;
}

export interface Deps {
  auditLog: AuditLog;
  broadcaster: Broadcaster;
}

export function createR2AuditLog(bucket: R2Bucket): AuditLog {
  return {
    append: async (event) => {
      const stampedEvent = { ...event, at: event.at ?? new Date().toISOString() };
      const key = `audit/${Date.now()}-${crypto.randomUUID()}.json`;
      await bucket.put(key, JSON.stringify(stampedEvent));
    },
  };
}

export function createBroadcaster(endpoint: string, token: string): Broadcaster {
  return {
    send: async (article) => {
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(article),
      });
    },
  };
}

export function createNoopBroadcaster(): Broadcaster {
  return {
    send: async (article) => {
      console.log('[noop-broadcaster]', article.slug);
    },
  };
}
