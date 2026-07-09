import { DurableObject } from "cloudflare:workers";
import {
  createPublishingSystem,
  type PublishingModuleHandle,
} from "./module.js";
import { createR2AuditLog, createNoopBroadcaster } from "./deps.js";

export interface Env {
  AGENT_ROOM: DurableObjectNamespace;
  AUDIT_LOG: R2Bucket;
  ANTHROPIC_API_KEY: string;
}

export class AgentRoom extends DurableObject<Env> {
  private system: ReturnType<typeof createPublishingSystem>["system"];
  private handle: PublishingModuleHandle;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const { system, handle } = createPublishingSystem({
      auditLog: createR2AuditLog(env.AUDIT_LOG),
      broadcaster: createNoopBroadcaster(),
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      storage: ctx.storage,
    });

    this.system = system;
    this.handle = handle;
    this.system.start();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ingest" && request.method === "POST") {
      const body = (await request.json()) as { url: string };
      this.system.dispatch({ type: "ingest", url: body.url });
      return new Response("queued", { status: 202 });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return Response.json({
        status: this.system.facts.status,
        queueDepth: this.system.derive.queueDepth,
        reviewDepth: this.system.derive.reviewDepth,
        errorCount: this.system.facts.errorLog.length,
      });
    }

    if (url.pathname === "/ws") {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade === "websocket") {
        const pair = new WebSocketPair();
        this.attachStreamingSocket(pair[1]);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    this.handle.alarmTick();
  }

  private attachStreamingSocket(server: WebSocket): void {
    server.accept();
    server.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { url?: unknown };
        if (typeof parsed.url === "string") {
          this.system.dispatch({ type: "ingest", url: parsed.url });
        }
      } catch {
        // Ignore malformed frames.
      }
    });
  }
}
