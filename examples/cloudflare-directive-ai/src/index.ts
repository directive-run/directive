import { Hono } from 'hono';
import type { Env } from './agent-room.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.text(
    [
      'Cloudflare Workers + Directive AI end-to-end example',
      '',
      'Endpoints:',
      '  POST /tenants/:tenantId/ingest — enqueue an ingest signal',
      '  GET  /tenants/:tenantId/status — inspect Directive facts',
      '  GET  /tenants/:tenantId/ws — attach WebSocket streaming ingest',
      '',
      'See docs/recipes/cloudflare-directive-ai-end-to-end.md',
    ].join('\n')
  )
);

app.post('/tenants/:tenantId/ingest', async (c) => {
  const tenantId = c.req.param('tenantId');
  const id = c.env.AGENT_ROOM.idFromName(tenantId);
  const stub = c.env.AGENT_ROOM.get(id);

  return stub.fetch(
    new Request('https://internal/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await c.req.text(),
    })
  );
});

app.get('/tenants/:tenantId/status', async (c) => {
  const tenantId = c.req.param('tenantId');
  const id = c.env.AGENT_ROOM.idFromName(tenantId);
  const stub = c.env.AGENT_ROOM.get(id);

  return stub.fetch(new Request('https://internal/status'));
});

app.get('/tenants/:tenantId/ws', async (c) => {
  const tenantId = c.req.param('tenantId');
  const id = c.env.AGENT_ROOM.idFromName(tenantId);
  const stub = c.env.AGENT_ROOM.get(id);

  return stub.fetch(
    new Request('https://internal/ws', {
      headers: c.req.raw.headers,
    })
  );
});

export default app;
export { AgentRoom } from './agent-room.js';
