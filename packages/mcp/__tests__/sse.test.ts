import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SseConfigError, startSseServer } from "../src/sse.js";

const silent = { log: () => {}, warn: () => {}, error: () => {} };

async function bindLoopback(token?: string) {
  const server = await startSseServer({
    port: 0,
    host: "127.0.0.1",
    logger: silent,
    token,
  });
  const addr = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

describe("startSseServer (loopback, unauthenticated)", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ({ server, baseUrl } = await bindLoopback());
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

describe("SSE hardening", () => {
  it("refuses to start on non-loopback host without a token", async () => {
    await expect(
      startSseServer({
        port: 0,
        host: "0.0.0.0",
        logger: silent,
      }),
    ).rejects.toThrow(SseConfigError);
  });

  it("accepts a token on loopback and rejects requests without Authorization", async () => {
    const { server, baseUrl } = await bindLoopback("s3cret");
    try {
      const noAuth = await fetch(`${baseUrl}/messages?sessionId=ghost`, {
        method: "POST",
        body: "{}",
      });
      expect(noAuth.status).toBe(401);

      const badAuth = await fetch(`${baseUrl}/messages?sessionId=ghost`, {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
        body: "{}",
      });
      expect(badAuth.status).toBe(401);

      const ok = await fetch(`${baseUrl}/messages?sessionId=ghost`, {
        method: "POST",
        headers: { Authorization: "Bearer s3cret" },
        body: "{}",
      });
      // 404 because the session doesn't exist — auth passed, routing
      // got past the auth gate.
      expect(ok.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects oversized body (Content-Length pre-check)", async () => {
    const { server, baseUrl } = await bindLoopback();
    try {
      const huge = "x".repeat(2_000_000);
      const res = await fetch(`${baseUrl}/messages?sessionId=any`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: huge,
      });
      expect(res.status).toBe(413);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("respects --allow-origin allowlist", async () => {
    const server = await startSseServer({
      port: 0,
      host: "127.0.0.1",
      logger: silent,
      allowOrigins: ["https://app.example.com"],
    });
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    try {
      const blocked = await fetch(`${baseUrl}/messages?sessionId=any`, {
        method: "POST",
        headers: { Origin: "https://attacker.example.com" },
        body: "{}",
      });
      expect(blocked.status).toBe(403);

      const allowed = await fetch(`${baseUrl}/messages?sessionId=any`, {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
        body: "{}",
      });
      // 404 — origin pass, session missing
      expect(allowed.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
