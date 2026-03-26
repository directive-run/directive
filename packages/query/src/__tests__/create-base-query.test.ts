import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBaseQuery } from "../index.js";

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  } as unknown as Response;
}

// ============================================================================
// createBaseQuery
// ============================================================================

describe("createBaseQuery", () => {
  it("creates a fetcher function", () => {
    const api = createBaseQuery({ baseUrl: "/api" });

    expect(api).toBeTypeOf("function");
  });

  it("makes a GET request with baseUrl + path", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ id: 1 }));
    const api = createBaseQuery({ baseUrl: "/api/v1" });
    const signal = new AbortController().signal;

    const result = await api({ url: "/users" }, signal);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe("/api/v1/users");
    expect(opts.method).toBe("GET");
    expect(result).toEqual({ id: 1 });
  });

  it("appends query params to the URL", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse([]));
    const api = createBaseQuery({ baseUrl: "/api" });
    const signal = new AbortController().signal;

    await api({ url: "/users", params: { page: 1, limit: 10 } }, signal);

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain("?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=10");
  });

  it("sends JSON body with POST", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ id: 1 }));
    const api = createBaseQuery({ baseUrl: "/api" });
    const signal = new AbortController().signal;

    await api(
      { url: "/users", method: "POST", body: { name: "John" } },
      signal,
    );

    const [, opts] = mockFetch.mock.calls[0]!;
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe('{"name":"John"}');
    expect(opts.headers.get("Content-Type")).toBe("application/json");
  });

  it("calls prepareHeaders before each request", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));
    const prepareHeaders = vi.fn((headers: Headers) => {
      headers.set("Authorization", "Bearer token123");

      return headers;
    });
    const api = createBaseQuery({ baseUrl: "/api", prepareHeaders });
    const signal = new AbortController().signal;

    await api({ url: "/me" }, signal);

    expect(prepareHeaders).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0]!;
    expect(opts.headers.get("Authorization")).toBe("Bearer token123");
  });

  it("uses text responseHandler when specified", async () => {
    const textResponse = {
      ok: true,
      status: 200,
      text: () => Promise.resolve("plain text"),
      headers: new Headers(),
    } as unknown as Response;
    mockFetch.mockResolvedValue(textResponse);

    const api = createBaseQuery({ baseUrl: "/api", responseHandler: "text" });
    const signal = new AbortController().signal;

    const result = await api({ url: "/readme" }, signal);

    expect(result).toBe("plain text");
  });

  it("supports custom responseHandler function", async () => {
    const blobResponse = {
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(["data"])),
      headers: new Headers(),
    } as unknown as Response;
    mockFetch.mockResolvedValue(blobResponse);

    const api = createBaseQuery({
      baseUrl: "/api",
      responseHandler: (res) => res.blob(),
    });
    const signal = new AbortController().signal;

    const result = await api({ url: "/file" }, signal);

    expect(result).toBeInstanceOf(Blob);
  });

  it("throws on bad status when validateStatus fails", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: "Not found" }, 404));
    const api = createBaseQuery({ baseUrl: "/api" });
    const signal = new AbortController().signal;

    await expect(api({ url: "/missing" }, signal)).rejects.toThrow(
      "Request failed with status 404",
    );
  });

  it("custom validateStatus can allow 404", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse(null, 404));
    const api = createBaseQuery({
      baseUrl: "/api",
      validateStatus: (res) => res.status === 200 || res.status === 404,
    });
    const signal = new AbortController().signal;

    const result = await api({ url: "/maybe" }, signal);

    expect(result).toBeNull();
  });

  it("calls transformError on validation failure", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ detail: "bad" }, 400));
    const transformError = vi.fn((_error, response) => ({
      status: response?.status,
      message: "Custom error",
    }));
    const api = createBaseQuery({ baseUrl: "/api", transformError });
    const signal = new AbortController().signal;

    await expect(api({ url: "/bad" }, signal)).rejects.toEqual({
      status: 400,
      message: "Custom error",
    });
    expect(transformError).toHaveBeenCalledTimes(1);
  });

  it("per-request responseHandler overrides config", async () => {
    const textResponse = {
      ok: true,
      status: 200,
      text: () => Promise.resolve("override"),
      json: () => Promise.resolve({ nope: true }),
      headers: new Headers(),
    } as unknown as Response;
    mockFetch.mockResolvedValue(textResponse);

    const api = createBaseQuery({ baseUrl: "/api", responseHandler: "json" });
    const signal = new AbortController().signal;

    const result = await api({ url: "/text", responseHandler: "text" }, signal);

    expect(result).toBe("override");
  });

  it("per-request headers merge with prepareHeaders", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));
    const api = createBaseQuery({
      baseUrl: "/api",
      prepareHeaders: (headers) => {
        headers.set("X-Global", "yes");

        return headers;
      },
    });
    const signal = new AbortController().signal;

    await api({ url: "/test", headers: { "X-Custom": "value" } }, signal);

    const [, opts] = mockFetch.mock.calls[0]!;
    expect(opts.headers.get("X-Custom")).toBe("value");
    expect(opts.headers.get("X-Global")).toBe("yes");
  });
});
