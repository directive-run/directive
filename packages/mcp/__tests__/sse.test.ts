import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSseServer } from "../src/sse.js";

describe("startSseServer", () => {
  let server: Server;
  let baseUrl: string;
  const silent = { log: () => {}, warn: () => {}, error: () => {} };

  beforeEach(async () => {
    server = await startSseServer({
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("responds 200 ok on /healthz", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("responds 404 on unknown routes", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it("rejects POST /messages without sessionId", async () => {
    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/sessionId/);
  });

  it("rejects POST /messages with unknown sessionId", async () => {
    const res = await fetch(`${baseUrl}/messages?sessionId=ghost`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/unknown session/);
  });
});
